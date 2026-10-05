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

// Bucket has no companyId yet (Task 12 adds it). Until then a bucket is usable
// when it exists and no other company's Document/Template references it.
// ponytail: a fresh, unreferenced bucket id can be claimed by whoever
// references it first; Task 12's Bucket.companyId closes that.
export async function assertBucketUsable(
  tx: TPrismaOrTransaction,
  companyId: string,
  bucketId: string,
) {
  // Filter through Bucket's relations rather than querying Document/Template
  // directly: those are tenant-scoped, so a tenantDb tx would only ever see the
  // caller's own rows and could never find another company's reference.
  const foreign = { some: { companyId: { not: companyId } } };
  const usable = await tx.bucket.count({
    where: {
      id: bucketId,
      NOT: [{ documents: foreign }, { templates: foreign }],
    },
  });
  if (!usable) throw new Error("Invalid reference");
}
