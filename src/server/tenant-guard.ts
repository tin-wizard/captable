import { TRPCError } from "@trpc/server";
import type { TPrismaOrTransaction } from "./db";

type Refs = {
  stakeholderId?: string | null;
  shareClassId?: string | null;
  equityPlanId?: string | null;
  memberId?: string | null;
  customRoleId?: string | null;
  documentId?: string | null;
};

// There are no DB foreign keys (relationMode = "prisma"), so a client-supplied
// id for a related row must be checked against the caller's company.
export async function assertTenantOwns(
  tx: TPrismaOrTransaction,
  companyId: string,
  refs: Refs,
) {
  const where = (id: string) => ({ where: { id, companyId } });
  const checks: [string | null | undefined, (id: string) => Promise<number>][] =
    [
      [refs.stakeholderId, (id) => tx.stakeholder.count(where(id))],
      [refs.shareClassId, (id) => tx.shareClass.count(where(id))],
      [refs.equityPlanId, (id) => tx.equityPlan.count(where(id))],
      [refs.memberId, (id) => tx.member.count(where(id))],
      [refs.customRoleId, (id) => tx.customRole.count(where(id))],
      [refs.documentId, (id) => tx.document.count(where(id))],
    ];

  for (const [id, count] of checks) {
    if (id && !(await count(id))) throw new Error("Invalid reference");
  }
}

// A bucket is usable only by its owner. Buckets with no owner (legacy orphans)
// are usable by nobody.
export async function assertBucketUsable(
  tx: TPrismaOrTransaction,
  companyId: string,
  bucketId: string,
) {
  if (!(await tx.bucket.count({ where: { id: bucketId, companyId } })))
    throw new Error("Invalid reference");
}

type Role = "ADMIN" | "CUSTOM" | null;

// Defining roles and assigning them are admin matters (D2): a grant on
// roles:* or members:* is not a way to raise anyone's (or one's own) access.
export function assertAdmin(
  callerRole: Role,
  message = "Only an admin can manage roles.",
) {
  if (callerRole !== "ADMIN")
    throw new TRPCError({ code: "FORBIDDEN", message });
}

// A non-admin may not act on an admin (update, deactivate, remove, re-invite,
// revoke). Returns the target's current role (null when not in the company).
export async function assertMayManageMember(
  tx: TPrismaOrTransaction,
  companyId: string,
  callerRole: Role,
  memberId: string,
) {
  const target = await tx.member.findFirst({
    where: { id: memberId, companyId },
    select: { role: true, customRoleId: true },
  });
  if (target?.role === "ADMIN") {
    assertAdmin(callerRole, "Only an admin can manage an admin.");
  }
  return target;
}

// A company must always keep at least one ACTIVE ADMIN. Call before removing,
// deactivating, revoking or demoting `memberId`; a no-op unless that member is
// currently an ACTIVE ADMIN of the company.
// ponytail: count-then-write, so two concurrent demotions of the last two
// admins could both pass; serialize (row lock / SERIALIZABLE) if that matters.
export async function assertNotLastActiveAdmin(
  tx: TPrismaOrTransaction,
  companyId: string,
  memberId: string,
) {
  const activeAdmin = {
    companyId,
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
  };
  const isActiveAdmin = await tx.member.count({
    where: { id: memberId, ...activeAdmin },
  });
  if (isActiveAdmin && (await tx.member.count({ where: activeAdmin })) <= 1) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A company must keep at least one active admin.",
    });
  }
}
