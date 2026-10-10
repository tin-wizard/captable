import { generatePublicId } from "@/common/id";
import { queue } from "@/lib/queue";
import type { TActions } from "@/lib/rbac/actions";
import { SUBJECTS, type TSubjects } from "@/lib/rbac/subjects";
import { db } from "@/server/db";
import { appRouter } from "@/trpc/api/root";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type Tenant,
  callerFor,
  cleanupTenants,
  seedTwoTenants,
} from "../helpers/seed";
import { seedTenantA } from "../helpers/tenant-fixtures";

/**
 * Roles inside one tenant. Every mutation needs an explicit RBAC permission
 * (or a justified exemption): an ADMIN may do it, a member with no role and a
 * member whose custom role only grants reads may not, and the data is left
 * untouched by the refused call.
 */

// @/env snapshots process.env at import. Presigning is a local computation
// (no network): fake bucket config only.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BASE_URL ||= "http://localhost:3000";
  Object.assign(process.env, {
    UPLOAD_ENDPOINT: "https://s3.test.invalid",
    UPLOAD_REGION: "us-east-1",
    UPLOAD_BUCKET_PUBLIC: "public-test",
    UPLOAD_BUCKET_PRIVATE: "private-test",
    UPLOAD_ACCESS_KEY_ID: "test-key",
    UPLOAD_SECRET_ACCESS_KEY: "test-secret",
  });
});

// Mutations that are not subject to roles, each with the reason.
const EXEMPT: Record<string, string> = {
  "auth.signup": "unauthenticated account flow; no tenant",
  "auth.verifyEmail": "unauthenticated account flow; no tenant",
  "auth.resendEmail": "unauthenticated account flow; no tenant",
  "auth.forgotPassword": "unauthenticated account flow; no tenant",
  "auth.newPassword": "unauthenticated account flow; no tenant",
  "onboarding.onboard": "creates the company; no membership exists yet",
  "passkey.create": "the user's own credential, not tenant data",
  "passkey.update": "the user's own credential, not tenant data",
  "passkey.delete": "the user's own credential, not tenant data",
  "passkey.createRegistrationOptions": "WebAuthn challenge for the user",
  "passkey.createAuthenticationOptions": "WebAuthn challenge for the user",
  "passkey.createSigninOptions": "unauthenticated WebAuthn sign-in challenge",
  "security.updatePassword": "the user's own password",
  "member.updateProfile": "the user's own profile",
  "member.acceptMember": "the invitee has no active membership until accepting",
  "company.switchCompany":
    "moves the session to another of the user's own memberships",
  "template.sign": "token-based e-sign by an external recipient; no session",
  "bucket.presignPublicUpload":
    "user-level: logos/avatars under the user's id, needed during onboarding before any membership; creates no Bucket row and touches no company data",
  "accessToken.delete":
    "revokes the caller's own token (user-scoped); only ever reduces access, so it must never be blocked",
};

type Caller = ReturnType<typeof callerFor>;
type Fx = Record<
  | "stakeholderId"
  | "shareClassId"
  | "equityPlanId"
  | "bucketId"
  | "documentId"
  | "updateId"
  | "updatePublicId"
  | "dataRoomId"
  | "dataRoomPublicId"
  | "templateId"
  | "templatePublicId"
  | "resendTemplateId"
  | "resendRecipientId"
  | "shareToDelete"
  | "optionToDelete"
  | "safeToDelete"
  | "updateRecipientId"
  | "dataRoomRecipientId"
  | "bankAccountToDelete"
  | "memberToEdit"
  | "memberToRemove"
  | "pendingToReInvite"
  | "pendingToRevoke"
  | "pendingToRevokeEmail"
  | "roleToEdit"
  | "roleToDelete"
  | "issuedKey"
  | "inviteEmail",
  string
>;
type Case = {
  proc: string;
  perm: [TSubjects, TActions];
  run: (c: Caller, f: Fx) => Promise<unknown>;
  // the handler calls a third party (Stripe) or is flag-gated off in tests:
  // ADMIN is only required to get past the access check
  adminPastAclOnly?: true;
};

const DAY = "2024-01-01";
const date = new Date(DAY);

const shareClassInput = (id?: string) => ({
  id,
  name: "roles class",
  classType: "COMMON" as const,
  initialSharesAuthorized: 1,
  boardApprovalDate: date,
  stockholderApprovalDate: date,
  votesPerShare: 1,
  parValue: 1,
  pricePerShare: 1,
  seniority: 1,
  conversionRights: "CONVERTS_TO_FUTURE_ROUND" as const,
  convertsToShareClassId: null,
  liquidationPreferenceMultiple: 1,
  participationCapMultiple: 1,
});

const equityPlanInput = (id: string | undefined, shareClassId: string) => ({
  id,
  name: "roles plan",
  boardApprovalDate: date,
  initialSharesReserved: 1,
  shareClassId,
  defaultCancellatonBehavior: "RETIRE" as const,
});

const shareInput = (f: Fx) => ({
  stakeholderId: f.stakeholderId,
  shareClassId: f.shareClassId,
  certificateId: nanoid(8),
  quantity: 1,
  pricePerShare: 1,
  capitalContribution: 1,
  ipContribution: 0,
  debtCancelled: 0,
  otherContributions: 0,
  status: "DRAFT" as const,
  cliffYears: 0,
  vestingYears: 0,
  companyLegends: [],
  issueDate: DAY,
  rule144Date: DAY,
  vestingStartDate: DAY,
  boardApprovalDate: DAY,
  documents: [],
});

const optionInput = (f: Fx) => ({
  stakeholderId: f.stakeholderId,
  equityPlanId: f.equityPlanId,
  grantId: nanoid(8),
  quantity: 1,
  exercisePrice: 1,
  type: "ISO" as const,
  status: "DRAFT" as const,
  cliffYears: 0,
  vestingYears: 0,
  issueDate: DAY,
  expirationDate: DAY,
  vestingStartDate: DAY,
  boardApprovalDate: DAY,
  rule144Date: DAY,
  documents: [],
});

const safeTerms = (f: Fx) => ({
  safeId: nanoid(8),
  valuationCap: 1,
  capital: 1,
  issueDate: DAY,
  boardApprovalDate: DAY,
  stakeholderId: f.stakeholderId,
});

const contact = () => {
  const email = `contact-${nanoid(6)}@example.com`;
  return {
    value: email,
    email,
    id: "x",
    name: "contact",
    type: "other" as const,
  };
};

const companyInput = {
  user: { name: "roles admin", email: "roles-admin@example.com" },
  company: {
    name: "roles Inc",
    incorporationType: "c-corp",
    incorporationDate: DAY,
    incorporationCountry: "US",
    incorporationState: "DE",
    streetAddress: "1 Main St",
    city: "Wilmington",
    state: "DE",
    zipcode: "19801",
    country: "US",
  },
};

const pdf = {
  fileName: "roles.pdf",
  contentType: "application/pdf",
  size: 1,
  keyPrefix: "generic-documents" as const,
};

const cases: Case[] = [
  // --- securities ---------------------------------------------------------
  {
    proc: "securities.addShares",
    perm: ["securities", "create"],
    run: (c, f) => c.securities.addShares(shareInput(f)),
  },
  {
    proc: "securities.addOptions",
    perm: ["securities", "create"],
    run: (c, f) => c.securities.addOptions(optionInput(f)),
  },
  {
    proc: "securities.deleteShare",
    perm: ["securities", "delete"],
    run: (c, f) => c.securities.deleteShare({ shareId: f.shareToDelete }),
  },
  {
    proc: "securities.deleteOption",
    perm: ["securities", "delete"],
    run: (c, f) => c.securities.deleteOption({ optionId: f.optionToDelete }),
  },
  {
    proc: "safe.create",
    perm: ["securities", "create"],
    run: (c, f) =>
      c.safe.create({
        safeTemplate: "CUSTOM",
        document: { bucketId: f.bucketId, name: "safe.pdf" },
        recipients: [{ email: "signer@example.com" }],
        orderedDelivery: false,
        ...safeTerms(f),
      }),
  },
  {
    proc: "safe.addExisting",
    perm: ["securities", "create"],
    run: (c, f) => c.safe.addExisting({ documents: [], ...safeTerms(f) }),
  },
  {
    proc: "safe.deleteSafe",
    perm: ["securities", "delete"],
    run: (c, f) => c.safe.deleteSafe({ safeId: f.safeToDelete }),
  },

  // --- cap-table settings -------------------------------------------------
  {
    proc: "shareClass.create",
    perm: ["cap-table-settings", "create"],
    run: (c) => c.shareClass.create(shareClassInput()),
  },
  {
    proc: "shareClass.update",
    perm: ["cap-table-settings", "update"],
    run: (c, f) => c.shareClass.update(shareClassInput(f.shareClassId)),
  },
  {
    proc: "equityPlan.create",
    perm: ["cap-table-settings", "create"],
    run: (c, f) =>
      c.equityPlan.create(equityPlanInput(undefined, f.shareClassId)),
  },
  {
    proc: "equityPlan.update",
    perm: ["cap-table-settings", "update"],
    run: (c, f) =>
      c.equityPlan.update(equityPlanInput(f.equityPlanId, f.shareClassId)),
  },

  // --- stakeholders -------------------------------------------------------
  {
    proc: "stakeholder.addStakeholders",
    perm: ["stakeholder", "create"],
    run: (c) =>
      c.stakeholder.addStakeholders([
        {
          name: "roles holder",
          email: `roles-holder-${nanoid(6)}@example.com`,
          stakeholderType: "INDIVIDUAL",
          currentRelationship: "EMPLOYEE",
        },
      ]),
  },
  {
    proc: "stakeholder.updateStakeholder",
    perm: ["stakeholder", "update"],
    run: (c, f) =>
      c.stakeholder.updateStakeholder({ id: f.stakeholderId, name: "renamed" }),
  },

  // --- investor updates ---------------------------------------------------
  {
    proc: "update.save",
    perm: ["updates", "update"],
    run: (c, f) =>
      c.update.save({
        publicId: f.updatePublicId,
        title: "saved",
        content: [{ x: 1 }],
        html: "saved",
      }),
  },
  {
    proc: "update.clone",
    perm: ["updates", "create"],
    run: (c, f) =>
      c.update.clone({
        id: f.updateId,
        title: "copy",
        content: [{ x: 1 }],
        html: "copy",
      }),
  },
  {
    proc: "update.share",
    perm: ["updates", "update"],
    run: (c, f) =>
      c.update.share({
        updateId: f.updateId,
        others: [],
        selectedContacts: [contact()],
      }),
  },
  {
    proc: "update.unShare",
    perm: ["updates", "update"],
    run: (c, f) =>
      c.update.unShare({
        updateId: f.updateId,
        recipientId: f.updateRecipientId,
      }),
  },
  {
    proc: "update.toggleVisibility",
    perm: ["updates", "update"],
    run: (c, f) => c.update.toggleVisibility({ updateId: f.updateId }),
  },

  // --- data rooms ---------------------------------------------------------
  {
    proc: "dataRoom.save",
    perm: ["data-rooms", "update"],
    run: (c, f) =>
      c.dataRoom.save({ name: "roles room", publicId: f.dataRoomPublicId }),
  },
  {
    proc: "dataRoom.share",
    perm: ["data-rooms", "update"],
    run: (c, f) =>
      c.dataRoom.share({
        dataRoomId: f.dataRoomId,
        others: [],
        selectedContacts: [contact()],
      }),
  },
  {
    proc: "dataRoom.unShare",
    perm: ["data-rooms", "update"],
    run: (c, f) =>
      c.dataRoom.unShare({
        dataRoomId: f.dataRoomId,
        recipientId: f.dataRoomRecipientId,
      }),
  },

  // --- e-sign templates (add fields before the template is cancelled) ----
  {
    proc: "template.create",
    perm: ["templates", "create"],
    run: (c, f) =>
      c.template.create({
        name: "roles template",
        bucketId: f.bucketId,
        recipients: [{ email: "signer@example.com" }],
        orderedDelivery: false,
      }),
  },
  {
    proc: "templateField.add",
    perm: ["templates", "update"],
    run: (c, f) =>
      c.templateField.add({
        status: "DRAFT",
        templatePublicId: f.templatePublicId,
        data: [],
      }),
  },
  {
    proc: "template.resendLink",
    perm: ["templates", "update"],
    run: (c, f) =>
      c.template.resendLink({
        templateId: f.resendTemplateId,
        recipientId: f.resendRecipientId,
      }),
  },
  {
    proc: "template.cancel",
    perm: ["templates", "update"],
    run: (c, f) =>
      c.template.cancel({
        templateId: f.templateId,
        publicId: f.templatePublicId,
      }),
  },

  // --- documents and files ------------------------------------------------
  {
    proc: "document.create",
    perm: ["documents", "create"],
    run: (c, f) =>
      c.document.create({ name: "roles doc", bucketId: f.bucketId }),
  },
  {
    proc: "documentShare.create",
    perm: ["documents", "create"],
    run: (c, f) =>
      c.documentShare.create({
        link: "x",
        linkExpiresAt: new Date("2100-01-01"),
        documentId: f.documentId,
        publicId: generatePublicId(),
      }),
  },
  {
    proc: "bucket.presignUpload",
    perm: ["documents", "create"],
    run: (c) => c.bucket.presignUpload(pdf),
  },
  {
    proc: "bucket.create",
    perm: ["documents", "create"],
    run: (c, f) =>
      c.bucket.create({
        name: "roles.pdf",
        key: f.issuedKey,
        mimeType: "application/pdf",
        size: 1,
        tags: [],
      }),
  },

  // --- members, roles, company --------------------------------------------
  {
    proc: "member.inviteMember",
    perm: ["members", "create"],
    run: (c, f) =>
      c.member.inviteMember({
        email: f.inviteEmail,
        name: "invitee",
        title: "invitee",
      }),
  },
  {
    proc: "member.updateMember",
    perm: ["members", "update"],
    run: (c, f) =>
      c.member.updateMember({ memberId: f.memberToEdit, title: "renamed" }),
  },
  {
    proc: "member.reInvite",
    perm: ["members", "update"],
    run: (c, f) => c.member.reInvite({ memberId: f.pendingToReInvite }),
  },
  {
    proc: "member.toggleActivation",
    perm: ["members", "update"],
    run: (c, f) =>
      c.member.toggleActivation({
        memberId: f.memberToEdit,
        status: "INACTIVE",
      }),
  },
  {
    proc: "member.revokeInvite",
    perm: ["members", "delete"],
    run: (c, f) =>
      c.member.revokeInvite({
        memberId: f.pendingToRevoke,
        email: f.pendingToRevokeEmail,
      }),
  },
  {
    proc: "member.removeMember",
    perm: ["members", "delete"],
    run: (c, f) => c.member.removeMember({ memberId: f.memberToRemove }),
  },
  {
    proc: "rbac.createRole",
    perm: ["roles", "create"],
    run: (c) => c.rbac.createRole({ name: "roles new", permissions: {} }),
  },
  {
    proc: "rbac.updateRole",
    perm: ["roles", "update"],
    run: (c, f) =>
      c.rbac.updateRole({
        roleId: f.roleToEdit,
        name: "roles edited",
        permissions: {},
      }),
  },
  {
    proc: "rbac.deleteRole",
    perm: ["roles", "delete"],
    run: (c, f) => c.rbac.deleteRole({ roleId: f.roleToDelete }),
  },
  {
    proc: "company.updateCompany",
    perm: ["company", "update"],
    run: (c) => c.company.updateCompany(companyInput),
  },
  {
    proc: "domain.rename",
    perm: ["company", "update"],
    // NOT_FOUND past the ACL while DOMAINS_ENABLED is off in tests
    adminPastAclOnly: true,
    run: (c) => c.domain.rename({ label: `roles-${nanoid(6)}` }),
  },
  {
    proc: "bankAccounts.create",
    perm: ["bank-accounts", "create"],
    run: (c) => c.bankAccounts.create(),
  },
  {
    proc: "bankAccounts.delete",
    perm: ["bank-accounts", "delete"],
    run: (c, f) => c.bankAccounts.delete({ id: f.bankAccountToDelete }),
  },
  {
    proc: "accessToken.create",
    perm: ["developer", "create"],
    run: (c) => c.accessToken.create({ typeEnum: "api" }),
  },
  {
    proc: "billing.checkout",
    perm: ["billing", "create"],
    adminPastAclOnly: true,
    run: (c) =>
      c.billing.checkout({ priceId: "price_roles", priceType: "recurring" }),
  },
  {
    proc: "billing.stripePortal",
    perm: ["billing", "update"],
    adminPastAclOnly: true,
    run: (c) =>
      c.billing.stripePortal({ type: "update", subscription: "sub_roles" }),
  },
];

// biome-ignore lint/suspicious/noExplicitAny: tRPC v10 procedure internals
const procedures = appRouter._def.procedures as Record<string, any>;
// `_def.meta` is exactly what tRPC hands the access-control middleware
const policiesOf = (name: string) =>
  procedures[name]?._def.meta?.policies as
    | Partial<Record<TSubjects, { allow?: TActions[] }>>
    | undefined;
const isMutation = (name: string) => procedures[name]?._def.mutation === true;
const hasPolicy = (name: string) =>
  Object.keys(policiesOf(name) ?? {}).length > 0;

// --- tenant A with an admin, a no-role member and two custom-role members --

async function seedMemberOf(
  t: Tenant,
  label: string,
  data: {
    role?: "ADMIN" | "CUSTOM" | null;
    customRoleId?: string;
    status?: "ACTIVE" | "PENDING" | "INACTIVE";
  },
) {
  const user = await db.user.create({
    data: {
      name: label,
      email: `${label.replace(/\W/g, "-")}-${nanoid(8)}@example.com`,
      emailVerified: date,
    },
  });
  const status = data.status ?? "ACTIVE";
  const member = await db.member.create({
    data: {
      userId: user.id,
      companyId: t.companyId,
      role: data.role ?? null,
      customRoleId: data.customRoleId,
      status,
      isOnboarded: status === "ACTIVE",
    },
  });
  const session: Tenant = {
    companyId: t.companyId,
    memberId: member.id,
    userId: user.id,
    session: {
      ...t.session,
      user: {
        ...t.session.user,
        id: user.id,
        name: user.name,
        email: user.email,
        memberId: member.id,
      },
    },
  };
  return { user, member, tenant: session };
}

const readOnly = SUBJECTS.map((subject) => ({
  subject,
  actions: ["read" as const],
}));

let tenants: { a: Tenant; b: Tenant };
let fx: Fx;
let extraUserIds: string[] = [];
let admin: Caller;
let noRole: Caller;
let readOnlyCustom: Caller;
let granted: Caller;
let grantedRoleId: string;

async function snapshotA() {
  const companyId = tenants.a.companyId;
  const own = { where: { companyId }, orderBy: { id: "asc" as const } };
  const userIds = { in: [tenants.a.userId, ...extraUserIds] };
  return {
    company: await db.company.findUnique({ where: { id: companyId } }),
    members: await db.member.findMany(own),
    customRoles: await db.customRole.findMany(own),
    stakeholders: await db.stakeholder.findMany(own),
    shareClasses: await db.shareClass.findMany(own),
    equityPlans: await db.equityPlan.findMany(own),
    shares: await db.share.findMany(own),
    options: await db.option.findMany(own),
    safes: await db.safe.findMany(own),
    documents: await db.document.findMany(own),
    documentShares: await db.documentShare.count({
      where: { document: { companyId } },
    }),
    buckets: await db.bucket.findMany(own),
    updates: await db.update.findMany(own),
    updateRecipients: await db.updateRecipient.count({
      where: { update: { companyId } },
    }),
    dataRooms: await db.dataRoom.findMany(own),
    dataRoomRecipients: await db.dataRoomRecipient.count({
      where: { dataRoom: { companyId } },
    }),
    templates: await db.template.findMany(own),
    templateFields: await db.templateField.count({
      where: { template: { companyId } },
    }),
    audits: await db.audit.count({ where: { companyId } }),
    bankAccounts: await db.bankAccount.findMany(own),
    accessTokens: await db.accessToken.count({ where: { userId: userIds } }),
    verificationTokens: await db.verificationToken.count(),
  };
}

beforeAll(async () => {
  // a queued job's id; null would mean pg-boss dropped a throttled send
  vi.spyOn(queue, "send").mockResolvedValue("job-id");
  vi.spyOn(queue, "insert").mockResolvedValue(undefined as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);

  tenants = await seedTwoTenants();
  const a = tenants.a;
  const { extraUserIds: member2User, ...aIds } = await seedTenantA(a);
  admin = callerFor(a);

  const readRole = await db.customRole.create({
    data: { companyId: a.companyId, name: "read only", permissions: readOnly },
  });
  const grantedRole = await db.customRole.create({
    data: { companyId: a.companyId, name: "granted", permissions: [] },
  });
  grantedRoleId = grantedRole.id;
  const roleToEdit = await db.customRole.create({
    data: { companyId: a.companyId, name: "to edit", permissions: [] },
  });
  const roleToDelete = await db.customRole.create({
    data: { companyId: a.companyId, name: "to delete", permissions: [] },
  });

  const m = {
    noRole: await seedMemberOf(a, "roles no-role", {}),
    readOnly: await seedMemberOf(a, "roles read-only", {
      role: "CUSTOM",
      customRoleId: readRole.id,
    }),
    granted: await seedMemberOf(a, "roles granted", {
      role: "CUSTOM",
      customRoleId: grantedRole.id,
    }),
    toEdit: await seedMemberOf(a, "roles to-edit", {}),
    toRemove: await seedMemberOf(a, "roles to-remove", {}),
    toReInvite: await seedMemberOf(a, "roles reinvite", { status: "PENDING" }),
    toRevoke: await seedMemberOf(a, "roles revoke", { status: "PENDING" }),
  };
  extraUserIds = [...member2User, ...Object.values(m).map((x) => x.user.id)];
  noRole = callerFor(m.noRole.tenant);
  readOnlyCustom = callerFor(m.readOnly.tenant);
  granted = callerFor(m.granted.tenant);

  const { companyId } = a;
  const share = await db.share.create({
    data: {
      companyId,
      stakeholderId: aIds.stakeholderId,
      shareClassId: aIds.shareClassId,
      certificateId: "to-delete",
      quantity: 1,
      issueDate: date,
      boardApprovalDate: date,
    },
  });
  const option = await db.option.create({
    data: {
      companyId,
      stakeholderId: aIds.stakeholderId,
      equityPlanId: aIds.equityPlanId,
      grantId: "to-delete",
      quantity: 1,
      exercisePrice: 1,
      type: "ISO",
      issueDate: date,
      expirationDate: date,
      vestingStartDate: date,
      boardApprovalDate: date,
      rule144Date: date,
    },
  });
  const safe = await db.safe.create({
    data: {
      companyId,
      stakeholderId: aIds.stakeholderId,
      publicId: "SAFE-roles",
      safeId: "to-delete",
      capital: 1,
      issueDate: date,
      boardApprovalDate: date,
    },
  });
  const updateRecipient = await db.updateRecipient.create({
    data: { updateId: aIds.updateId, name: "r", email: "r@example.com" },
  });
  const dataRoomRecipient = await db.dataRoomRecipient.create({
    data: { dataRoomId: aIds.dataRoomId, name: "r", email: "r@example.com" },
  });
  const bankAccount = await db.bankAccount.create({
    data: {
      companyId,
      beneficiaryName: "x",
      beneficiaryAddress: "x",
      bankName: "x",
      bankAddress: "x",
      accountNumber: "x",
      routingNumber: "x",
    },
  });
  const update = await db.update.findUniqueOrThrow({
    where: { id: aIds.updateId },
  });
  // an envelope out for signature, its signer's turn (resendLink)
  const resendTemplate = await db.template.create({
    data: {
      companyId,
      uploaderId: a.memberId,
      bucketId: aIds.bucketId,
      publicId: generatePublicId(),
      name: "roles resend",
      status: "PENDING",
    },
  });
  const resendRecipient = await db.esignRecipient.create({
    data: {
      templateId: resendTemplate.id,
      email: "resend@example.com",
      status: "SENT",
    },
  });
  // a key presignUpload would issue to A (computed with the global helper so
  // the fixture does not depend on the procedure under test)
  const { getPresignedPutUrl } = await import("@/server/file-uploads");
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
  });
  const { key: issuedKey } = await getPresignedPutUrl({
    ...pdf,
    identifier: company.publicId,
    bucketMode: "privateBucket",
  });

  fx = {
    ...aIds,
    updatePublicId: update.publicId,
    resendTemplateId: resendTemplate.id,
    resendRecipientId: resendRecipient.id,
    shareToDelete: share.id,
    optionToDelete: option.id,
    safeToDelete: safe.id,
    updateRecipientId: updateRecipient.id,
    dataRoomRecipientId: dataRoomRecipient.id,
    bankAccountToDelete: bankAccount.id,
    memberToEdit: m.toEdit.member.id,
    memberToRemove: m.toRemove.member.id,
    pendingToReInvite: m.toReInvite.member.id,
    pendingToRevoke: m.toRevoke.member.id,
    pendingToRevokeEmail: m.toRevoke.user.email as string,
    roleToEdit: roleToEdit.id,
    roleToDelete: roleToDelete.id,
    issuedKey,
    inviteEmail: `roles-invitee-${nanoid(8)}@example.com`,
  };
});

afterAll(async () => {
  const { a, b } = tenants;
  const emails = (
    await db.user.findMany({
      where: { id: { in: extraUserIds } },
      select: { email: true },
    })
  ).map((u) => u.email as string);
  emails.push(fx.inviteEmail);
  // CustomRole -> Company and AccessToken -> User have no cascade
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await db.accessToken.deleteMany({ where: { userId: a.userId } });
  await db.verificationToken.deleteMany({
    where: { OR: emails.map((e) => ({ identifier: { startsWith: e } })) },
  });
  await db.passwordResetToken.deleteMany({ where: { email: { in: emails } } });
  await cleanupTenants(a, b);
  await db.bucket.deleteMany({ where: { companyId: a.companyId } });
  await db.user.deleteMany({
    where: { OR: [{ id: { in: extraUserIds } }, { email: { in: emails } }] },
  });
  vi.restoreAllMocks();
});

// many handlers report failure as `{ success: false }` instead of throwing
function expectOk(res: unknown) {
  if (res && typeof res === "object" && "success" in res) {
    expect(res).toMatchObject({ success: true });
  }
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: { code?: string }) => e.code ?? String(e),
  );

describe("roles inside a tenant", () => {
  it.each(cases.map((c) => [c.proc, c] as const))(
    "%s: no-role and read-only members are refused, ADMIN is not",
    async (_name, c) => {
      for (const caller of [noRole, readOnlyCustom]) {
        const before = await snapshotA();
        expect(await code(c.run(caller, fx))).toBe("UNAUTHORIZED");
        expect(await snapshotA()).toEqual(before);
      }

      if (c.adminPastAclOnly) {
        expect(["UNAUTHORIZED", "FORBIDDEN"]).not.toContain(
          await code(c.run(admin, fx)),
        );
        return;
      }
      expectOk(await c.run(admin, fx));
    },
  );

  // a custom role holding exactly the needed grant is enough
  const spotChecks: [string, Case["run"]][] = [
    ["securities.addShares", (c, f) => c.securities.addShares(shareInput(f))],
    ["shareClass.create", (c) => c.shareClass.create(shareClassInput())],
    [
      "update.toggleVisibility",
      (c, f) => c.update.toggleVisibility({ updateId: f.updateId }),
    ],
    [
      "dataRoom.save",
      (c, f) =>
        c.dataRoom.save({ name: "granted room", publicId: f.dataRoomPublicId }),
    ],
    [
      "template.create",
      (c, f) =>
        c.template.create({
          name: "granted template",
          bucketId: f.bucketId,
          recipients: [{ email: "signer@example.com" }],
          orderedDelivery: false,
        }),
    ],
    [
      "template.resendLink",
      (c, f) =>
        c.template.resendLink({
          templateId: f.resendTemplateId,
          recipientId: f.resendRecipientId,
        }),
    ],
  ];

  it.each(spotChecks)(
    "%s: a custom role with exactly its grant is allowed",
    async (proc, run) => {
      const [subject, action] = cases.find((c) => c.proc === proc)
        ?.perm as Case["perm"];
      await db.customRole.update({
        where: { id: grantedRoleId },
        data: { permissions: [{ subject, actions: [action] }] },
      });
      expectOk(await run(granted, fx));
    },
  );

  it("bucket.getUrl needs documents:read", async () => {
    const input = { bucketId: fx.bucketId };
    expect(await code(noRole.bucket.getUrl(input))).toBe("UNAUTHORIZED");
    expect(await code(readOnlyCustom.bucket.getUrl(input))).toBe("resolved");
    expect(await code(admin.bucket.getUrl(input))).toBe("resolved");
  });

  // these reads mint working public-link tokens for every recipient
  it("dataRoom.getDataRoom needs data-rooms:read", async () => {
    const input = {
      dataRoomPublicId: fx.dataRoomPublicId,
      include: { recipients: true },
    };
    expect(await code(noRole.dataRoom.getDataRoom(input))).toBe("UNAUTHORIZED");
    expect(await code(admin.dataRoom.getDataRoom(input))).toBe("resolved");
  });

  it("update.getRecipients needs updates:read", async () => {
    const input = { updateId: fx.updateId };
    expect(await code(noRole.update.getRecipients(input))).toBe("UNAUTHORIZED");
    expect(await code(admin.update.getRecipients(input))).toBe("resolved");
  });

  it("billing.getSubscription needs billing:read", async () => {
    expect(await code(noRole.billing.getSubscription())).toBe("UNAUTHORIZED");
    expect(await code(admin.billing.getSubscription())).toBe("resolved");
    await db.customRole.update({
      where: { id: grantedRoleId },
      data: { permissions: [{ subject: "billing", actions: ["read"] }] },
    });
    expect(await code(granted.billing.getSubscription())).toBe("resolved");
  });

  // share dialogs call it for any member; each half needs its own read grant
  it("common.getContacts returns members only with members:read and stakeholders only with stakeholder:read", async () => {
    const types = async (c: Caller) =>
      new Set((await c.common.getContacts()).map((x) => x.type));
    const grant = (subject: TSubjects) =>
      db.customRole.update({
        where: { id: grantedRoleId },
        data: { permissions: [{ subject, actions: ["read"] }] },
      });

    expect(await noRole.common.getContacts()).toEqual([]);
    await grant("stakeholder");
    expect(await types(granted)).toEqual(new Set(["stakeholder"]));
    await grant("members");
    expect(await types(granted)).toEqual(new Set(["member"]));
    expect(await types(admin)).toEqual(new Set(["member", "stakeholder"]));
  });
});

describe("policy coverage guard", () => {
  it("every mutation has a policy or a justified exemption", () => {
    const missing = Object.keys(procedures).filter(
      (n) => isMutation(n) && !hasPolicy(n) && !EXEMPT[n],
    );
    expect(missing).toEqual([]);
  });

  it("exemptions name existing mutations that have no policy", () => {
    const wrong = Object.keys(EXEMPT).filter(
      (n) => !isMutation(n) || hasPolicy(n),
    );
    expect(wrong).toEqual([]);
  });

  it("every policed mutation has a role case whose grant the policy accepts", () => {
    const tested = new Map(cases.map((c) => [c.proc, c.perm]));
    const wrong = Object.keys(procedures)
      .filter((n) => isMutation(n) && hasPolicy(n))
      .filter((n) => {
        const perm = tested.get(n);
        return !perm || !policiesOf(n)?.[perm[0]]?.allow?.includes(perm[1]);
      });
    expect(wrong).toEqual([]);
  });

  // `.meta()` on a withTenant procedure is silently ignored: prove each policy
  // is enforced. The access check runs before input parsing, so an empty
  // input is refused as UNAUTHORIZED, not BAD_REQUEST.
  it("every policy is enforced (no-role caller, empty input)", async () => {
    const unenforced: string[] = [];
    for (const n of Object.keys(procedures).filter(hasPolicy)) {
      const [router, proc] = n.split(".") as [string, string];
      // biome-ignore lint/suspicious/noExplicitAny: dynamic dispatch by name
      const fn = (noRole as any)[router][proc] as (
        i: unknown,
      ) => Promise<unknown>;
      if ((await code(fn({}))) !== "UNAUTHORIZED") unenforced.push(n);
    }
    expect(unenforced).toEqual([]);
  });
});

describe("last active admin", () => {
  let t: { a: Tenant; b: Tenant };
  let self: Caller;
  const users: string[] = [];

  const addAdmin = async (status: "ACTIVE" | "INACTIVE" = "ACTIVE") => {
    const m = await seedMemberOf(t.a, "roles admin", { role: "ADMIN", status });
    users.push(m.user.id);
    return { id: m.member.id, email: m.user.email as string };
  };
  const member = (id: string) => db.member.findUnique({ where: { id } });

  beforeAll(async () => {
    t = await seedTwoTenants();
    self = callerFor(t.a);
  });

  afterAll(async () => {
    await cleanupTenants(t.a, t.b);
    await db.user.deleteMany({ where: { id: { in: users } } });
  });

  it("refuses removing, deactivating, revoking or demoting the only admin", async () => {
    const id = t.a.memberId;
    const email = t.a.session.user.email as string;
    const before = await member(id);
    // thunks, started one at a time: calls created up front but awaited later
    // can reject before a handler is attached (an unhandled rejection)
    const attempts = [
      () => self.member.removeMember({ memberId: id }),
      () => self.member.toggleActivation({ memberId: id, status: "INACTIVE" }),
      () => self.member.revokeInvite({ memberId: id, email }),
      () => self.member.updateMember({ memberId: id, roleId: "" }),
    ];
    for (const attempt of attempts) {
      const err = await attempt().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringMatching(/at least one active admin/i),
      });
    }
    expect(await member(id)).toEqual(before);
  });

  it("an inactive admin does not count", async () => {
    await addAdmin("INACTIVE");
    await expect(
      self.member.toggleActivation({
        memberId: t.a.memberId,
        status: "INACTIVE",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows each operation while another active admin remains", async () => {
    const [x1, x2, x3, x4] = [
      await addAdmin(),
      await addAdmin(),
      await addAdmin(),
      await addAdmin(),
    ] as const;
    await self.member.removeMember({ memberId: x1.id });
    expect(await member(x1.id)).toBeNull();
    await self.member.toggleActivation({ memberId: x2.id, status: "INACTIVE" });
    expect((await member(x2.id))?.status).toBe("INACTIVE");
    await self.member.revokeInvite({ memberId: x3.id, email: x3.email });
    expect(await member(x3.id)).toBeNull();
    await self.member.updateMember({ memberId: x4.id, roleId: "" });
    expect((await member(x4.id))?.role).toBeNull();

    // self-demotion is fine once someone else is an active admin
    await addAdmin();
    await self.member.updateMember({ memberId: t.a.memberId, roleId: "" });
    expect((await member(t.a.memberId))?.role).toBeNull();
  });

  // F13: the guard is count-then-write, so it must run serializably. Two
  // admins acting on each other at the same instant: exactly one may win.
  it("two admins removing, deactivating or demoting each other at once leave an active admin", async () => {
    const ops = {
      demote: (c: Caller, id: string) =>
        c.member.updateMember({ memberId: id, roleId: "" }),
      remove: (c: Caller, id: string) =>
        c.member.removeMember({ memberId: id }),
      deactivate: (c: Caller, id: string) =>
        c.member.toggleActivation({ memberId: id, status: "INACTIVE" }),
    };
    for (let i = 0; i < 5; i++) {
      for (const [name, op] of Object.entries(ops)) {
        const pair = await seedTwoTenants();
        const y = await seedMemberOf(pair.a, "roles race", { role: "ADMIN" });
        users.push(y.user.id);
        try {
          const results = await Promise.allSettled([
            op(callerFor(pair.a), y.member.id),
            op(callerFor(y.tenant), pair.a.memberId),
          ]);
          const admins = await db.member.count({
            where: {
              companyId: pair.a.companyId,
              role: "ADMIN",
              status: "ACTIVE",
            },
          });
          const outcome = results.map((r) =>
            r.status === "fulfilled"
              ? "ok"
              : (r.reason as { code?: string }).code,
          );
          expect({ name, admins, outcome: outcome.sort() }).toMatchObject({
            admins: 1,
            outcome: [
              // UNAUTHORIZED: the winner committed before the loser's access check
              expect.stringMatching(/^(FORBIDDEN|CONFLICT|UNAUTHORIZED)$/),
              "ok",
            ],
          });
        } finally {
          await cleanupTenants(pair.a, pair.b);
        }
      }
    }
  });

  // its own tenant pair: toggling an extra admin would change the counts above
  it("toggleActivation audits deactivation and activation as such", async () => {
    const pair = await seedTwoTenants();
    const x = await seedMemberOf(pair.a, "roles toggled", { role: "ADMIN" });
    users.push(x.user.id);
    try {
      const c = callerFor(pair.a);
      await c.member.toggleActivation({
        memberId: x.member.id,
        status: "INACTIVE",
      });
      await c.member.toggleActivation({
        memberId: x.member.id,
        status: "ACTIVE",
      });
      const rows = await db.audit.findMany({
        where: {
          companyId: pair.a.companyId,
          action: { in: ["member.activated", "member.deactivated"] },
        },
        orderBy: { occurredAt: "asc" },
      });
      expect(rows.map((r) => r.action)).toEqual([
        "member.deactivated",
        "member.activated",
      ]);
    } finally {
      await cleanupTenants(pair.a, pair.b);
    }
  });
});
