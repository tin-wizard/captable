import { generatePublicId } from "@/common/id";
import { queue } from "@/lib/queue";
import { Audit } from "@/server/audit";
import { db } from "@/server/db";
import { appRouter } from "@/trpc/api/root";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { type Tenant, callerFor, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  B_SECRET,
  cleanupFixtures,
  leaksToB,
  seedTenantA,
  seedTenantB,
  snapshotB,
} from "../helpers/tenant-fixtures";

/**
 * Cross-tenant isolation matrix. Tenant A's authenticated caller supplies
 * tenant B's ids to every id-taking tRPC procedure. Many procedures swallow
 * errors into `{ success: false }`, so a throw is not the assertion. The
 * invariant, checked after every call whether it threw or not:
 *   (a) every row B owns is unchanged (nothing updated, deleted or inserted),
 *   (b) no row outside B now points at one of B's ids,
 *   (c) the return value carries none of B's data.
 */

// @/env snapshots process.env at import; passkey options need a valid base URL
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BASE_URL ||= "http://localhost:3000";
});

type Caller = ReturnType<typeof callerFor>;
type Ids = { a: AIds; b: BIds; aEmail: string };
type Case = {
  // "<dotted.procedure> <what A tries>"; the first word drives the coverage guard
  name: string;
  kind: "read" | "update" | "delete" | "reference";
  run: (a: Caller, ids: Ids) => Promise<unknown>;
};

const DAY = "2024-01-01";
const date = new Date(DAY);
const inviteEmail = `cross-tenant-invitee-${nanoid(8)}@example.com`;

const shareClassInput = (
  id: string | undefined,
  convertsToShareClassId: string | null = null,
) => ({
  id,
  name: "tenant-a class",
  classType: "COMMON" as const,
  initialSharesAuthorized: 1,
  boardApprovalDate: date,
  stockholderApprovalDate: date,
  votesPerShare: 1,
  parValue: 1,
  pricePerShare: 1,
  seniority: 1,
  conversionRights: "CONVERTS_TO_FUTURE_ROUND" as const,
  convertsToShareClassId,
  liquidationPreferenceMultiple: 1,
  participationCapMultiple: 1,
});

const equityPlanInput = (id: string | undefined, shareClassId: string) => ({
  id,
  name: "tenant-a plan",
  boardApprovalDate: date,
  initialSharesReserved: 1,
  shareClassId,
  defaultCancellatonBehavior: "RETIRE" as const,
});

const shareInput = (r: {
  stakeholderId: string;
  shareClassId: string;
  bucketId?: string;
}) => ({
  stakeholderId: r.stakeholderId,
  shareClassId: r.shareClassId,
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
  documents: r.bucketId ? [{ bucketId: r.bucketId, name: "doc" }] : [],
});

const optionInput = (r: {
  stakeholderId: string;
  equityPlanId: string;
  bucketId?: string;
}) => ({
  stakeholderId: r.stakeholderId,
  equityPlanId: r.equityPlanId,
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
  documents: r.bucketId ? [{ bucketId: r.bucketId, name: "doc" }] : [],
});

const safeTerms = (stakeholderId: string) => ({
  safeId: nanoid(8),
  valuationCap: 1,
  capital: 1,
  issueDate: DAY,
  boardApprovalDate: DAY,
  stakeholderId,
});

const customSafe = (stakeholderId: string, bucketId: string) => ({
  safeTemplate: "CUSTOM" as const,
  document: { bucketId, name: "safe.pdf" },
  recipients: [{ email: "signer@example.com" }],
  orderedDelivery: false,
  ...safeTerms(stakeholderId),
});

const contact = (id: string, type: "member" | "stakeholder" | "other") => {
  const email = `contact-${nanoid(6)}@example.com`;
  return { value: email, email, id, name: "contact", type };
};

const fieldInput = (id: string, recipientId: string) => ({
  id,
  name: "field",
  width: 1,
  height: 1,
  top: 1,
  left: 1,
  required: false,
  type: "TEXT" as const,
  viewportHeight: 1,
  viewportWidth: 1,
  page: 1,
  defaultValue: "",
  readOnly: false,
  recipientId,
});

const cases: Case[] = [
  // --- share classes / equity plans --------------------------------------
  {
    name: "shareClass.update B's share class",
    kind: "update",
    run: (a, { b }) => a.shareClass.update(shareClassInput(b.shareClassId)),
  },
  {
    name: "shareClass.update A's class to convert into B's class",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.shareClass.update(shareClassInput(own.shareClassId, b.shareClassId)),
  },
  {
    name: "shareClass.create converting into B's class",
    kind: "reference",
    run: (a, { b }) =>
      a.shareClass.create(shareClassInput(undefined, b.shareClassId)),
  },
  {
    name: "equityPlan.update B's plan",
    kind: "update",
    run: (a, { a: own, b }) =>
      a.equityPlan.update(equityPlanInput(b.equityPlanId, own.shareClassId)),
  },
  {
    name: "equityPlan.update A's plan onto B's share class",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.equityPlan.update(equityPlanInput(own.equityPlanId, b.shareClassId)),
  },
  {
    name: "equityPlan.create on B's share class",
    kind: "reference",
    run: (a, { b }) =>
      a.equityPlan.create(equityPlanInput(undefined, b.shareClassId)),
  },

  // --- stakeholders -------------------------------------------------------
  {
    name: "stakeholder.updateStakeholder B's stakeholder",
    kind: "update",
    run: (a, { b }) =>
      a.stakeholder.updateStakeholder({ id: b.stakeholderId, name: "pwned" }),
  },
  {
    name: "stakeholder.addStakeholders reusing B's stakeholder id",
    kind: "update",
    run: (a, { b }) => {
      // add-stakeholders.ts:27 fires Audit.create un-awaited inside the
      // transaction; it rejects after commit as an unhandled error. Unrelated
      // to tenancy, so stub it for this call only.
      vi.spyOn(Audit, "create").mockResolvedValueOnce(undefined as never);
      return a.stakeholder.addStakeholders([
        {
          id: b.stakeholderId,
          name: "pwned",
          email: `pwned-${nanoid(6)}@example.com`,
          stakeholderType: "INDIVIDUAL",
          currentRelationship: "EMPLOYEE",
        },
      ]);
    },
  },

  // --- securities ---------------------------------------------------------
  {
    name: "securities.addShares for B's stakeholder",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.securities.addShares(
        shareInput({
          stakeholderId: b.stakeholderId,
          shareClassId: own.shareClassId,
        }),
      ),
  },
  {
    name: "securities.addShares in B's share class",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.securities.addShares(
        shareInput({
          stakeholderId: own.stakeholderId,
          shareClassId: b.shareClassId,
        }),
      ),
  },
  {
    name: "securities.addShares attaching B's bucket",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.securities.addShares(
        shareInput({
          stakeholderId: own.stakeholderId,
          shareClassId: own.shareClassId,
          bucketId: b.bucketId,
        }),
      ),
  },
  {
    name: "securities.deleteShare B's share",
    kind: "delete",
    run: (a, { b }) => a.securities.deleteShare({ shareId: b.shareId }),
  },
  {
    name: "securities.addOptions for B's stakeholder",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.securities.addOptions(
        optionInput({
          stakeholderId: b.stakeholderId,
          equityPlanId: own.equityPlanId,
        }),
      ),
  },
  {
    name: "securities.addOptions under B's equity plan",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.securities.addOptions(
        optionInput({
          stakeholderId: own.stakeholderId,
          equityPlanId: b.equityPlanId,
        }),
      ),
  },
  {
    name: "securities.addOptions attaching B's bucket",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.securities.addOptions(
        optionInput({
          stakeholderId: own.stakeholderId,
          equityPlanId: own.equityPlanId,
          bucketId: b.bucketId,
        }),
      ),
  },
  {
    name: "securities.deleteOption B's option",
    kind: "delete",
    run: (a, { b }) => a.securities.deleteOption({ optionId: b.optionId }),
  },

  // --- SAFEs --------------------------------------------------------------
  {
    name: "safe.create for B's stakeholder",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.safe.create(customSafe(b.stakeholderId, own.bucketId)),
  },
  {
    name: "safe.create on B's bucket",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.safe.create(customSafe(own.stakeholderId, b.bucketId)),
  },
  {
    name: "safe.addExisting for B's stakeholder",
    kind: "reference",
    run: (a, { b }) =>
      a.safe.addExisting({ documents: [], ...safeTerms(b.stakeholderId) }),
  },
  {
    name: "safe.addExisting attaching B's bucket",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.safe.addExisting({
        documents: [{ bucketId: b.bucketId, name: "doc" }],
        ...safeTerms(own.stakeholderId),
      }),
  },
  {
    name: "safe.deleteSafe B's SAFE",
    kind: "delete",
    run: (a, { b }) => a.safe.deleteSafe({ safeId: b.safeId }),
  },

  // --- documents ----------------------------------------------------------
  {
    name: "document.get B's document",
    kind: "read",
    run: (a, { b }) => a.document.get({ publicId: b.documentPublicId }),
  },
  {
    name: "document.create on B's bucket",
    kind: "reference",
    run: (a, { b }) => a.document.create({ name: "doc", bucketId: b.bucketId }),
  },
  {
    name: "documentShare.create for B's document",
    kind: "reference",
    run: (a, { b }) =>
      a.documentShare.create({
        link: "x",
        linkExpiresAt: new Date("2100-01-01"),
        documentId: b.documentId,
        publicId: generatePublicId(),
      }),
  },
  {
    name: "documentShare.create reusing B's share id",
    kind: "update",
    run: (a, { a: own, b }) =>
      a.documentShare.create({
        id: b.documentShareId,
        link: "x",
        linkExpiresAt: new Date("2100-01-01"),
        documentId: own.documentId,
        publicId: generatePublicId(),
      }),
  },

  // --- e-sign templates ---------------------------------------------------
  {
    name: "template.get B's template",
    kind: "read",
    run: (a, { b }) =>
      a.template.get({ publicId: b.templatePublicId, isDraftOnly: false }),
  },
  {
    name: "template.create on B's bucket",
    kind: "reference",
    run: (a, { b }) =>
      a.template.create({
        name: "t",
        bucketId: b.bucketId,
        recipients: [{ email: "signer@example.com" }],
        orderedDelivery: false,
      }),
  },
  {
    name: "template.cancel B's template",
    kind: "update",
    run: (a, { b }) =>
      a.template.cancel({
        templateId: b.templateId,
        publicId: b.templatePublicId,
      }),
  },
  {
    name: "templateField.add on B's template",
    kind: "update",
    run: (a, { b }) =>
      a.templateField.add({
        status: "DRAFT",
        templatePublicId: b.templatePublicId,
        data: [],
      }),
  },
  {
    name: "templateField.add to A's template for B's recipient",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.templateField.add({
        status: "DRAFT",
        templatePublicId: own.templatePublicId,
        data: [fieldInput(nanoid(), b.recipientId)],
      }),
  },
  {
    name: "templateField.add reusing B's field id",
    kind: "update",
    run: (a, { a: own, b }) =>
      a.templateField.add({
        status: "DRAFT",
        templatePublicId: own.templatePublicId,
        data: [fieldInput(b.fieldId, own.recipientId)],
      }),
  },
  {
    name: "audit.allEsignAudits for B's template",
    kind: "read",
    run: (a, { b }) =>
      a.audit.allEsignAudits({ templatePublicId: b.templatePublicId }),
  },

  // --- updates ------------------------------------------------------------
  {
    name: "update.save B's update",
    kind: "update",
    run: (a, { b }) =>
      a.update.save({
        publicId: b.updatePublicId,
        title: "pwned",
        content: { x: 1 },
        html: "pwned",
      }),
  },
  {
    name: "update.clone B's update",
    kind: "read",
    run: (a, { b }) =>
      a.update.clone({
        id: b.updateId,
        publicId: b.updatePublicId,
        title: "copy",
        content: { x: 1 },
        html: "copy",
      }),
  },
  {
    name: "update.getRecipients of B's update",
    kind: "read",
    run: (a, { b }) => a.update.getRecipients({ updateId: b.updateId }),
  },
  {
    name: "update.share B's update",
    kind: "update",
    run: (a, { b }) =>
      a.update.share({
        updateId: b.updateId,
        others: [],
        selectedContacts: [contact("x", "other")],
      }),
  },
  {
    name: "update.share A's update with B's member",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.update.share({
        updateId: own.updateId,
        others: [],
        selectedContacts: [contact(b.memberId, "member")],
      }),
  },
  {
    name: "update.share A's update with B's stakeholder",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.update.share({
        updateId: own.updateId,
        others: [],
        selectedContacts: [contact(b.stakeholderId, "stakeholder")],
      }),
  },
  {
    name: "update.unShare B's recipient on B's update",
    kind: "delete",
    run: (a, { b }) =>
      a.update.unShare({
        updateId: b.updateId,
        recipientId: b.updateRecipientId,
      }),
  },
  {
    name: "update.unShare B's recipient via A's update",
    kind: "delete",
    run: (a, { a: own, b }) =>
      a.update.unShare({
        updateId: own.updateId,
        recipientId: b.updateRecipientId,
      }),
  },
  {
    name: "update.toggleVisibility B's update",
    kind: "update",
    run: (a, { b }) => a.update.toggleVisibility({ updateId: b.updateId }),
  },

  // --- data rooms ---------------------------------------------------------
  {
    name: "dataRoom.getDataRoom B's room",
    kind: "read",
    run: (a, { b }) =>
      a.dataRoom.getDataRoom({
        dataRoomPublicId: b.dataRoomPublicId,
        include: { company: true, documents: true, recipients: true },
      }),
  },
  {
    name: "dataRoom.save B's room",
    kind: "update",
    run: (a, { b }) =>
      a.dataRoom.save({ name: "pwned", publicId: b.dataRoomPublicId }),
  },
  {
    name: "dataRoom.save A's room with B's document",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.dataRoom.save({
        name: "tenant-a room",
        publicId: own.dataRoomPublicId,
        documents: [{ documentId: b.documentId }],
      }),
  },
  {
    name: "dataRoom.save A's room with B's member",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.dataRoom.save({
        name: "tenant-a room",
        publicId: own.dataRoomPublicId,
        recipients: [{ email: "m@example.com", memberId: b.memberId }],
      }),
  },
  {
    name: "dataRoom.save A's room with B's stakeholder",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.dataRoom.save({
        name: "tenant-a room",
        publicId: own.dataRoomPublicId,
        recipients: [
          { email: "s@example.com", stakeholderId: b.stakeholderId },
        ],
      }),
  },
  {
    name: "dataRoom.share B's room",
    kind: "update",
    run: (a, { b }) =>
      a.dataRoom.share({
        dataRoomId: b.dataRoomId,
        others: [],
        selectedContacts: [contact("x", "other")],
      }),
  },
  {
    name: "dataRoom.share A's room with B's member",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.dataRoom.share({
        dataRoomId: own.dataRoomId,
        others: [],
        selectedContacts: [contact(b.memberId, "member")],
      }),
  },
  {
    name: "dataRoom.share A's room with B's stakeholder",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.dataRoom.share({
        dataRoomId: own.dataRoomId,
        others: [],
        selectedContacts: [contact(b.stakeholderId, "stakeholder")],
      }),
  },
  {
    name: "dataRoom.unShare B's recipient on B's room",
    kind: "delete",
    run: (a, { b }) =>
      a.dataRoom.unShare({
        dataRoomId: b.dataRoomId,
        recipientId: b.dataRoomRecipientId,
      }),
  },
  {
    name: "dataRoom.unShare B's recipient via A's room",
    kind: "delete",
    run: (a, { a: own, b }) =>
      a.dataRoom.unShare({
        dataRoomId: own.dataRoomId,
        recipientId: b.dataRoomRecipientId,
      }),
  },

  // --- members and roles --------------------------------------------------
  {
    name: "company.switchCompany into B's member",
    kind: "update",
    run: (a, { b }) => a.company.switchCompany({ id: b.memberId }),
  },
  {
    name: "member.acceptMember B's member with A's own invite token",
    kind: "update",
    run: async (a, { a: own, b, aEmail }) => {
      const { token } = await db.verificationToken.create({
        data: {
          identifier: `${aEmail}:${own.memberId}`,
          token: `cross-tenant-${nanoid(16)}`,
          expires: new Date("2100-01-01"),
        },
      });
      return a.member.acceptMember({
        memberId: b.memberId,
        token,
        name: "pwned",
        workEmail: "pwned@example.com",
      });
    },
  },
  {
    name: "member.revokeInvite B's pending invite",
    kind: "delete",
    run: (a, { b }) =>
      a.member.revokeInvite({
        email: b.pendingEmail,
        memberId: b.pendingMemberId,
      }),
  },
  {
    name: "member.removeMember B's member",
    kind: "delete",
    run: (a, { b }) => a.member.removeMember({ memberId: b.memberId }),
  },
  {
    name: "member.toggleActivation B's member",
    kind: "update",
    run: (a, { b }) =>
      a.member.toggleActivation({ memberId: b.memberId, status: "INACTIVE" }),
  },
  {
    name: "member.updateMember B's member",
    kind: "update",
    run: (a, { b }) =>
      a.member.updateMember({ memberId: b.memberId, title: "pwned" }),
  },
  {
    name: "member.updateMember A's member onto B's custom role",
    kind: "reference",
    run: (a, { a: own, b }) =>
      a.member.updateMember({
        memberId: own.member2Id,
        roleId: b.customRoleId,
      }),
  },
  {
    name: "member.reInvite B's pending member",
    kind: "update",
    run: (a, { b }) => a.member.reInvite({ memberId: b.pendingMemberId }),
  },
  {
    name: "member.inviteMember with B's custom role",
    kind: "reference",
    run: (a, { b }) =>
      a.member.inviteMember({
        email: inviteEmail,
        name: "invitee",
        title: "invitee",
        roleId: b.customRoleId,
      }),
  },
  {
    name: "rbac.updateRole B's role",
    kind: "update",
    run: (a, { b }) =>
      a.rbac.updateRole({
        roleId: b.customRoleId,
        name: "pwned",
        permissions: {},
      }),
  },
  {
    name: "rbac.deleteRole B's role",
    kind: "delete",
    run: (a, { b }) => a.rbac.deleteRole({ roleId: b.customRoleId }),
  },

  // --- user-scoped credentials and stubs ----------------------------------
  {
    name: "passkey.createAuthenticationOptions with B admin's passkey",
    kind: "read",
    run: (a, { b }) =>
      a.passkey.createAuthenticationOptions({
        preferredPasskeyId: b.passkeyId,
      }),
  },
  {
    name: "passkey.update B admin's passkey",
    kind: "update",
    run: (a, { b }) => a.passkey.update({ passkeyId: b.passkeyId, name: "x" }),
  },
  {
    name: "passkey.delete B admin's passkey",
    kind: "delete",
    run: (a, { b }) => a.passkey.delete({ passkeyId: b.passkeyId }),
  },
  {
    name: "accessToken.delete B admin's token",
    kind: "delete",
    run: (a, { b }) => a.accessToken.delete({ tokenId: b.accessTokenId }),
  },
  {
    name: "bankAccounts.delete B's bank account",
    kind: "delete",
    run: (a, { b }) => a.bankAccounts.delete({ id: b.bankAccountId }),
  },
];

// Id-taking procedures with no case, each with the reason it needs none.
const EXEMPT: Record<string, string> = {
  "billing.checkout":
    "priceId is a global Stripe catalog price, not tenant data; the call goes to Stripe",
  "passkey.create":
    "verificationResponse.id/rawId are the new credential's own ids, verified by WebAuthn against the caller's challenge; no row is looked up by them",
};

// --- coverage guard helpers ------------------------------------------------

const ID_KEY = /^id$|Ids?$/;

function hasIdField(schema: ZodTypeAny): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: walking Zod internals
  const def = schema._def as any;
  if (def.typeName === "ZodObject") {
    return Object.entries(def.shape() as Record<string, ZodTypeAny>).some(
      ([key, value]) => ID_KEY.test(key) || hasIdField(value),
    );
  }
  const children: ZodTypeAny[] = [
    def.innerType,
    def.schema,
    def.type,
    def.left,
    def.right,
    def.valueType,
    ...(def.options ? [...def.options.values()] : []),
  ].filter(Boolean);
  return children.some(hasIdField);
}

// biome-ignore lint/suspicious/noExplicitAny: tRPC v10 procedure internals
const procedures = appRouter._def.procedures as Record<string, any>;

const procedureOf = (c: Case) => c.name.split(" ")[0] as string;

const stringify = (v: unknown) =>
  JSON.stringify(v ?? null, (_k, x) =>
    typeof x === "bigint" ? x.toString() : x,
  );

// --- suite -----------------------------------------------------------------

describe("cross-tenant isolation", () => {
  let tenants: { a: Tenant; b: Tenant };
  let ids: Ids;
  let callerA: Caller;

  beforeAll(async () => {
    // jobs (emails) are enqueued in pg-boss; nothing is sent from tests
    vi.spyOn(queue, "send").mockResolvedValue(null);
    vi.spyOn(queue, "insert").mockResolvedValue(undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    tenants = await seedTwoTenants();
    ids = {
      a: await seedTenantA(tenants.a),
      b: await seedTenantB(tenants.b),
      aEmail: tenants.a.session.user.email as string,
    };
    callerA = callerFor(tenants.a);
  });

  afterAll(async () => {
    await db.verificationToken.deleteMany({
      where: {
        OR: [
          { identifier: { contains: ids.a.memberId } },
          { identifier: { startsWith: inviteEmail } },
        ],
      },
    });
    await db.passwordResetToken.deleteMany({ where: { email: inviteEmail } });
    await cleanupFixtures(ids.a, ids.b, [tenants.a, tenants.b], [inviteEmail]);
    vi.restoreAllMocks();
  });

  async function expectIsolated(c: Case) {
    const before = await snapshotB(ids.b);
    const leaksBefore = await leaksToB(ids.b);

    let result: unknown;
    try {
      result = await c.run(callerA, ids);
    } catch {
      result = undefined; // refusing by throwing is fine
    }

    expect(await snapshotB(ids.b)).toEqual(before);
    expect(await leaksToB(ids.b)).toEqual(leaksBefore);
    expect(stringify(result)).not.toContain(B_SECRET);
  }

  const rows = cases.map((c) => [`${c.name} [${c.kind}]`, c] as const);

  it.each(rows)("%s", (_name, c) => expectIsolated(c));

  describe("own-tenant controls (the matrix cannot pass vacuously)", () => {
    it("shareClass.update succeeds on A's own share class", async () => {
      const res = await callerA.shareClass.update({
        ...shareClassInput(ids.a.shareClassId),
        name: "tenant-a class renamed",
      });
      expect(res.success).toBe(true);
      const row = await db.shareClass.findUnique({
        where: { id: ids.a.shareClassId },
      });
      expect(row?.name).toBe("tenant-a class renamed");
    });

    it("securities.addShares succeeds with A's own references", async () => {
      const input = shareInput({
        stakeholderId: ids.a.stakeholderId,
        shareClassId: ids.a.shareClassId,
      });
      const res = await callerA.securities.addShares(input);
      expect(res.success).toBe(true);
      expect(
        await db.share.count({
          where: {
            companyId: ids.a.companyId,
            certificateId: input.certificateId,
          },
        }),
      ).toBe(1);
    });

    it("dataRoom.save links A's own document", async () => {
      const res = await callerA.dataRoom.save({
        name: "tenant-a room",
        publicId: ids.a.dataRoomPublicId,
        documents: [{ documentId: ids.a.documentId }],
      });
      expect(res.success).toBe(true);
      expect(
        await db.dataRoomDocument.count({
          where: { dataRoomId: ids.a.dataRoomId, documentId: ids.a.documentId },
        }),
      ).toBe(1);
    });

    it("stakeholder.updateStakeholder succeeds on A's own stakeholder", async () => {
      const res = await callerA.stakeholder.updateStakeholder({
        id: ids.a.stakeholderId,
        name: "tenant-a holder renamed",
      });
      expect(res.success).toBe(true);
      const row = await db.stakeholder.findUnique({
        where: { id: ids.a.stakeholderId },
      });
      expect(row?.name).toBe("tenant-a holder renamed");
    });

    it("documentShare.create succeeds for A's own document", async () => {
      const res = await callerA.documentShare.create({
        link: "x",
        linkExpiresAt: new Date("2100-01-01"),
        documentId: ids.a.documentId,
        publicId: generatePublicId(),
      });
      expect(res.success).toBe(true);
    });

    it("member.revokeInvite refuses B's invite as not found, before touching B's tokens or data", async () => {
      const tokensBefore = await db.verificationToken.count({
        where: { identifier: { contains: ids.b.pendingMemberId } },
      });
      expect(tokensBefore).toBeGreaterThan(0);

      const err = await callerA.member
        .revokeInvite({
          email: ids.b.pendingEmail,
          memberId: ids.b.pendingMemberId,
        })
        .then(() => undefined)
        .catch((e: unknown) => e);

      expect(err).toMatchObject({ code: "NOT_FOUND" });
      expect(stringify((err as Error).message)).not.toContain(B_SECRET);
      expect(
        await db.verificationToken.count({
          where: { identifier: { contains: ids.b.pendingMemberId } },
        }),
      ).toBe(tokensBefore);
    });

    it("member.inviteMember, updateMember and toggleActivation succeed inside A's own tenant", async () => {
      const invited = await callerA.member.inviteMember({
        email: inviteEmail,
        name: "invitee",
        title: "invitee",
      });
      expect(invited.success).toBe(true);
      const pending = await db.member.findFirstOrThrow({
        where: { companyId: ids.a.companyId, user: { email: inviteEmail } },
      });

      await callerA.member.updateMember({
        memberId: ids.a.member2Id,
        title: "renamed",
      });
      expect(
        (await db.member.findUniqueOrThrow({ where: { id: ids.a.member2Id } }))
          .title,
      ).toBe("renamed");

      await callerA.member.toggleActivation({
        memberId: ids.a.member2Id,
        status: "INACTIVE",
      });
      expect(
        (await db.member.findUniqueOrThrow({ where: { id: ids.a.member2Id } }))
          .status,
      ).toBe("INACTIVE");

      // revoking A's own pending invite removes the member and its token
      await callerA.member.revokeInvite({
        email: inviteEmail,
        memberId: pending.id,
      });
      expect(await db.member.count({ where: { id: pending.id } })).toBe(0);
      expect(
        await db.verificationToken.count({
          where: { identifier: { contains: pending.id } },
        }),
      ).toBe(0);
    });

    it("update.getRecipients returns B's recipients to B's own caller", async () => {
      const res = await callerFor(tenants.b).update.getRecipients({
        updateId: ids.b.updateId,
      });
      expect(stringify(res)).toContain(B_SECRET);
    });
  });
});

describe("coverage guard", () => {
  const covered = new Set(cases.map(procedureOf));

  it("every id-taking procedure has a cross-tenant case or a justified exemption", () => {
    const idTaking = Object.entries(procedures)
      .filter(([, p]) => (p._def.inputs as ZodTypeAny[]).some(hasIdField))
      .map(([name]) => name);
    const uncovered = idTaking.filter((n) => !covered.has(n) && !EXEMPT[n]);
    expect(uncovered).toEqual([]);
  });

  it("cases and exemptions only name procedures that exist", () => {
    const names = [...covered, ...Object.keys(EXEMPT)];
    expect(names.filter((n) => !(n in procedures))).toEqual([]);
  });
});
