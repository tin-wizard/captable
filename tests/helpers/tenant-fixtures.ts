import { generatePublicId } from "@/common/id";
import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { type Tenant, cleanupTenants } from "./seed";

// Every string column on a row seeded for tenant B carries this marker, so a
// return value that leaks any of B's rows is detectable by a substring search.
export const B_SECRET = "tenant-b-secret";

const day = new Date("2024-01-01");

function seedUser(label: string) {
  return db.user.create({
    data: {
      name: `${label}`,
      email: `${label.replace(/\W/g, "-")}-${nanoid(8)}@example.com`,
      emailVerified: day,
    },
  });
}

async function seedMember(
  t: Tenant,
  label: string,
  status: "ACTIVE" | "PENDING",
) {
  const user = await seedUser(label);
  const member = await db.member.create({
    data: {
      userId: user.id,
      companyId: t.companyId,
      role: "ADMIN",
      status,
      isOnboarded: status === "ACTIVE",
      title: label,
    },
  });
  return { user, member };
}

function seedBucket(label: string) {
  return db.bucket.create({
    data: {
      name: label,
      key: `${label}/${nanoid(8)}.pdf`,
      mimeType: "application/pdf",
      size: 1,
      tags: [],
    },
  });
}

async function seedCore(t: Tenant, label: string) {
  const { companyId, memberId } = t;
  const shareClass = await db.shareClass.create({
    data: {
      companyId,
      idx: 1,
      name: `${label} class`,
      initialSharesAuthorized: 1000n,
      boardApprovalDate: day,
      stockholderApprovalDate: day,
      votesPerShare: 1,
      parValue: 0.0001,
      pricePerShare: 1,
      seniority: 1,
      liquidationPreferenceMultiple: 1,
      participationCapMultiple: 1,
    },
  });
  const equityPlan = await db.equityPlan.create({
    data: {
      companyId,
      shareClassId: shareClass.id,
      name: `${label} plan`,
      boardApprovalDate: day,
      initialSharesReserved: 100n,
      defaultCancellatonBehavior: "RETIRE",
      comments: label,
    },
  });
  const stakeholder = await db.stakeholder.create({
    data: {
      companyId,
      name: `${label} holder`,
      email: `${label.replace(/\W/g, "-")}-holder-${nanoid(8)}@example.com`,
      institutionName: label,
    },
  });
  const bucket = await seedBucket(label);
  const document = await db.document.create({
    data: {
      companyId,
      uploaderId: memberId,
      publicId: generatePublicId(),
      name: `${label} doc`,
      bucketId: bucket.id,
    },
  });
  const update = await db.update.create({
    data: {
      companyId,
      authorId: memberId,
      publicId: generatePublicId(),
      title: `${label} update`,
      content: { text: label },
      html: `<p>${label}</p>`,
      // not DRAFT, so toggleVisibility's only barrier is the tenant check
      status: "PRIVATE",
    },
  });
  const dataRoom = await db.dataRoom.create({
    data: { companyId, name: `${label} room`, publicId: generatePublicId() },
  });
  const template = await db.template.create({
    data: {
      companyId,
      uploaderId: memberId,
      bucketId: bucket.id,
      publicId: generatePublicId(),
      name: `${label} template`,
      status: "DRAFT",
      message: label,
    },
  });
  const recipient = await db.esignRecipient.create({
    data: {
      templateId: template.id,
      email: `${label.replace(/\W/g, "-")}-signer@example.com`,
      name: label,
    },
  });
  return {
    shareClass,
    equityPlan,
    stakeholder,
    bucket,
    document,
    update,
    dataRoom,
    template,
    recipient,
  };
}

export async function seedTenantA(a: Tenant) {
  const core = await seedCore(a, "tenant-a");
  const { user: user2, member: member2 } = await seedMember(
    a,
    "tenant-a member2",
    "ACTIVE",
  );
  return {
    companyId: a.companyId,
    memberId: a.memberId,
    shareClassId: core.shareClass.id,
    equityPlanId: core.equityPlan.id,
    stakeholderId: core.stakeholder.id,
    bucketId: core.bucket.id,
    documentId: core.document.id,
    updateId: core.update.id,
    dataRoomId: core.dataRoom.id,
    dataRoomPublicId: core.dataRoom.publicId,
    templateId: core.template.id,
    templatePublicId: core.template.publicId,
    recipientId: core.recipient.id,
    member2Id: member2.id,
    extraUserIds: [user2.id],
  };
}

export async function seedTenantB(b: Tenant) {
  const S = B_SECRET;
  const { companyId, memberId } = b;
  await db.company.update({
    where: { id: companyId },
    data: { name: `${S} Inc` },
  });
  await db.user.update({
    where: { id: b.userId },
    data: { name: `${S} admin` },
  });

  const core = await seedCore(b, S);
  const { stakeholder, shareClass, equityPlan, template, update, dataRoom } =
    core;

  const field = await db.templateField.create({
    data: {
      name: S,
      defaultValue: S,
      top: 1,
      left: 1,
      width: 1,
      height: 1,
      viewportHeight: 1,
      viewportWidth: 1,
      page: 1,
      recipientId: core.recipient.id,
      templateId: template.id,
    },
  });
  await db.esignAudit.create({
    data: {
      companyId,
      templateId: template.id,
      recipientId: core.recipient.id,
      action: S,
      ip: S,
      userAgent: S,
      location: S,
      summary: S,
    },
  });
  const updateRecipient = await db.updateRecipient.create({
    data: { updateId: update.id, name: S, email: `${S}-ur@example.com` },
  });
  await db.dataRoomDocument.create({
    data: { dataRoomId: dataRoom.id, documentId: core.document.id },
  });
  const dataRoomRecipient = await db.dataRoomRecipient.create({
    data: { dataRoomId: dataRoom.id, name: S, email: `${S}-dr@example.com` },
  });
  const documentShare = await db.documentShare.create({
    data: {
      documentId: core.document.id,
      link: S,
      publicId: generatePublicId(),
      linkExpiresAt: new Date("2100-01-01"),
      recipients: [S],
    },
  });
  const safe = await db.safe.create({
    data: {
      companyId,
      stakeholderId: stakeholder.id,
      publicId: "SAFE-1",
      safeId: S,
      additionalTerms: S,
      capital: 1000,
      issueDate: day,
      boardApprovalDate: day,
    },
  });
  const share = await db.share.create({
    data: {
      companyId,
      stakeholderId: stakeholder.id,
      shareClassId: shareClass.id,
      certificateId: S,
      quantity: 10,
      issueDate: day,
      boardApprovalDate: day,
    },
  });
  const option = await db.option.create({
    data: {
      companyId,
      stakeholderId: stakeholder.id,
      equityPlanId: equityPlan.id,
      grantId: S,
      quantity: 10,
      exercisePrice: 1,
      type: "ISO",
      issueDate: day,
      expirationDate: day,
      vestingStartDate: day,
      boardApprovalDate: day,
      rule144Date: day,
    },
  });
  const customRole = await db.customRole.create({
    data: { companyId, name: S, permissions: [] },
  });
  const active = await seedMember(b, `${S} member`, "ACTIVE");
  await db.member.update({
    where: { id: active.member.id },
    data: { customRoleId: customRole.id },
  });
  const pending = await seedMember(b, `${S} invitee`, "PENDING");
  const inviteToken = await db.verificationToken.create({
    data: {
      identifier: `${pending.user.email}:${pending.member.id}`,
      token: `${S}-${nanoid(16)}`,
      expires: new Date("2100-01-01"),
    },
  });
  const passkey = await db.passkey.create({
    data: {
      userId: b.userId,
      name: S,
      credentialId: Buffer.from(S),
      credentialPublicKey: Buffer.from(S),
      counter: 0n,
      credentialDeviceType: "SINGLE_DEVICE",
      credentialBackedUp: false,
      transports: [],
    },
  });
  const accessToken = await db.accessToken.create({
    data: { userId: b.userId, clientId: S, clientSecret: S },
  });
  const bankAccount = await db.bankAccount.create({
    data: {
      companyId,
      beneficiaryName: S,
      beneficiaryAddress: S,
      bankName: S,
      bankAddress: S,
      accountNumber: S,
      routingNumber: S,
    },
  });

  return {
    companyId,
    adminMemberId: memberId,
    userIds: [b.userId, active.user.id, pending.user.id],
    shareClassId: shareClass.id,
    equityPlanId: equityPlan.id,
    stakeholderId: stakeholder.id,
    bucketId: core.bucket.id,
    documentId: core.document.id,
    documentPublicId: core.document.publicId,
    documentShareId: documentShare.id,
    updateId: update.id,
    updatePublicId: update.publicId,
    updateRecipientId: updateRecipient.id,
    dataRoomId: dataRoom.id,
    dataRoomPublicId: dataRoom.publicId,
    dataRoomRecipientId: dataRoomRecipient.id,
    templateId: template.id,
    templatePublicId: template.publicId,
    recipientId: core.recipient.id,
    fieldId: field.id,
    safeId: safe.id,
    shareId: share.id,
    optionId: option.id,
    memberId: active.member.id,
    pendingMemberId: pending.member.id,
    pendingEmail: pending.user.email as string,
    inviteToken: inviteToken.token,
    customRoleId: customRole.id,
    passkeyId: passkey.id,
    accessTokenId: accessToken.id,
    bankAccountId: bankAccount.id,
  };
}

export type AIds = Awaited<ReturnType<typeof seedTenantA>>;
export type BIds = Awaited<ReturnType<typeof seedTenantB>>;

const byId = { orderBy: { id: "asc" as const } };

// Every row tenant B owns, directly or through a parent. Compared before and
// after each cross-tenant call: any update, delete or insert under B shows up.
export async function snapshotB(b: BIds) {
  const companyId = b.companyId;
  const own = { where: { companyId }, ...byId };
  const users = { in: b.userIds };
  return {
    company: await db.company.findUnique({ where: { id: companyId } }),
    members: await db.member.findMany(own),
    users: await db.user.findMany({ where: { id: users }, ...byId }),
    customRoles: await db.customRole.findMany(own),
    stakeholders: await db.stakeholder.findMany(own),
    shareClasses: await db.shareClass.findMany(own),
    equityPlans: await db.equityPlan.findMany(own),
    shares: await db.share.findMany(own),
    options: await db.option.findMany(own),
    safes: await db.safe.findMany(own),
    documents: await db.document.findMany(own),
    documentShares: await db.documentShare.findMany({
      where: { document: { companyId } },
      ...byId,
    }),
    buckets: await db.bucket.findMany({ where: { id: b.bucketId }, ...byId }),
    updates: await db.update.findMany(own),
    updateRecipients: await db.updateRecipient.findMany({
      where: { update: { companyId } },
      ...byId,
    }),
    dataRooms: await db.dataRoom.findMany(own),
    dataRoomDocuments: await db.dataRoomDocument.findMany({
      where: { dataRoom: { companyId } },
      ...byId,
    }),
    dataRoomRecipients: await db.dataRoomRecipient.findMany({
      where: { dataRoom: { companyId } },
      ...byId,
    }),
    templates: await db.template.findMany(own),
    templateFields: await db.templateField.findMany({
      where: { template: { companyId } },
      ...byId,
    }),
    esignRecipients: await db.esignRecipient.findMany({
      where: { template: { companyId } },
      ...byId,
    }),
    esignAudits: await db.esignAudit.findMany(own),
    audits: await db.audit.findMany(own),
    bankAccounts: await db.bankAccount.findMany(own),
    passkeys: await db.passkey.findMany({ where: { userId: users }, ...byId }),
    accessTokens: await db.accessToken.findMany({
      where: { userId: users },
      ...byId,
    }),
    verificationTokens: await db.verificationToken.findMany({
      where: { identifier: { contains: b.pendingMemberId } },
      ...byId,
    }),
  };
}

// Rows outside tenant B that point at one of B's ids ("link-to" leaks). There
// are no DB foreign keys, so nothing but app code stops these.
export async function leaksToB(b: BIds) {
  const notB = { not: b.companyId };
  const bMembers = { in: [b.adminMemberId, b.memberId, b.pendingMemberId] };
  const person = {
    OR: [{ memberId: bMembers }, { stakeholderId: b.stakeholderId }],
  };
  return {
    memberCustomRole: await db.member.count({
      where: { companyId: notB, customRoleId: b.customRoleId },
    }),
    shares: await db.share.count({
      where: {
        companyId: notB,
        OR: [
          { stakeholderId: b.stakeholderId },
          { shareClassId: b.shareClassId },
        ],
      },
    }),
    options: await db.option.count({
      where: {
        companyId: notB,
        OR: [
          { stakeholderId: b.stakeholderId },
          { equityPlanId: b.equityPlanId },
        ],
      },
    }),
    safes: await db.safe.count({
      where: { companyId: notB, stakeholderId: b.stakeholderId },
    }),
    equityPlans: await db.equityPlan.count({
      where: { companyId: notB, shareClassId: b.shareClassId },
    }),
    shareClasses: await db.shareClass.count({
      where: { companyId: notB, convertsToShareClassId: b.shareClassId },
    }),
    documentsOnBBucket: await db.document.count({
      where: { companyId: notB, bucketId: b.bucketId },
    }),
    templatesOnBBucket: await db.template.count({
      where: { companyId: notB, bucketId: b.bucketId },
    }),
    dataRoomDocuments: await db.dataRoomDocument.count({
      where: { dataRoom: { companyId: notB }, documentId: b.documentId },
    }),
    dataRoomRecipients: await db.dataRoomRecipient.count({
      where: { dataRoom: { companyId: notB }, ...person },
    }),
    updateRecipients: await db.updateRecipient.count({
      where: { update: { companyId: notB }, ...person },
    }),
    templateFields: await db.templateField.count({
      where: { template: { companyId: notB }, recipientId: b.recipientId },
    }),
  };
}

export async function cleanupFixtures(
  a: AIds,
  b: BIds,
  tenants: Tenant[],
  extraUserEmails: string[] = [],
) {
  const companyIds = { in: [a.companyId, b.companyId] };
  // CustomRole -> Company and AccessToken -> User have no cascade; they would
  // block the company and user deletes
  await db.customRole.deleteMany({ where: { companyId: companyIds } });
  await db.accessToken.deleteMany({ where: { userId: { in: b.userIds } } });
  await db.verificationToken.deleteMany({
    where: { identifier: { contains: b.pendingMemberId } },
  });
  await cleanupTenants(...tenants);
  await db.bucket.deleteMany({
    where: { id: { in: [a.bucketId, b.bucketId] } },
  });
  await db.user.deleteMany({
    where: {
      OR: [
        { id: { in: [...a.extraUserIds, ...b.userIds] } },
        { email: { in: extraUserEmails } },
      ],
    },
  });
}
