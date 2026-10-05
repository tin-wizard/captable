import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
  snapshotB,
} from "../helpers/tenant-fixtures";

/**
 * tenantDb(db, A) must never read or change tenant B's rows.
 *
 * Covered: every model operation on the direct-companyId models (where is
 * forced to A, create/createMany/createManyAndReturn/upsert.create stamp A,
 * a `companyId` key in update data is forced to A) and the where-taking
 * operations plus upsert on the parent-scoped child models. Raw SQL on the
 * tenant client throws.
 *
 * NOT covered (tests below marked LIMIT pin today's behaviour):
 *   - nested writes inside `data` (connect/create of a relation): unscoped
 *   - `include`/`select` of a relation: returns whatever row the FK points at
 *   - create/createMany on a child model: the parent id is not checked
 *   - FK ids supplied as data (stakeholderId, bucketId ...): Task 5b
 *   - Company, User and other global models: untouched by design
 *   - findRaw/aggregateRaw do not exist for Postgres; $queryRaw et al. throw
 */

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let before: Awaited<ReturnType<typeof snapshotB>>;
let ta: ReturnType<typeof tenantDb>;

// companyId is omitted when not given; the cast mirrors a caller that forgets it
const holder = (name: string, companyId?: string) =>
  ({
    name,
    email: `${name}-${Math.random().toString(36).slice(2)}@example.com`,
    ...(companyId && { companyId }),
  }) as { name: string; email: string; companyId: string };

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  await db.dataRoomDocument.create({
    data: { dataRoomId: aIds.dataRoomId, documentId: aIds.documentId },
  });
  before = await snapshotB(bIds);
  ta = tenantDb(db, a.companyId);
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

const bUnchanged = async () => expect(await snapshotB(bIds)).toEqual(before);

describe("tenantDb reads", () => {
  it("findMany returns only own rows", async () => {
    const rows = await ta.shareClass.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.companyId === a.companyId)).toBe(true);
  });

  it("findFirst by another tenant's id returns null", async () => {
    expect(
      await ta.shareClass.findFirst({ where: { id: bIds.shareClassId } }),
    ).toBeNull();
  });

  it("an explicit foreign companyId in where is overridden to own", async () => {
    const rows = await ta.stakeholder.findMany({
      where: { companyId: b.companyId },
    });
    expect(rows.every((r) => r.companyId === a.companyId)).toBe(true);
  });

  it("findUnique / findUniqueOrThrow cannot see another tenant", async () => {
    expect(
      await ta.stakeholder.findUnique({ where: { id: bIds.stakeholderId } }),
    ).toBeNull();
    await expect(
      ta.stakeholder.findUniqueOrThrow({ where: { id: bIds.stakeholderId } }),
    ).rejects.toThrow();
    await expect(
      ta.stakeholder.findFirstOrThrow({ where: { id: bIds.stakeholderId } }),
    ).rejects.toThrow();
    expect(
      await ta.stakeholder.findUnique({ where: { id: aIds.stakeholderId } }),
    ).not.toBeNull();
  });

  it("count / aggregate / groupBy are scoped", async () => {
    const ids = { id: { in: [aIds.stakeholderId, bIds.stakeholderId] } };
    expect(await ta.stakeholder.count({ where: ids })).toBe(1);
    const agg = await ta.stakeholder.aggregate({ where: ids, _count: true });
    expect(agg._count).toBe(1);
    const groups = await ta.stakeholder.groupBy({
      by: ["companyId"],
      where: ids,
    });
    expect(groups).toEqual([{ companyId: a.companyId }]);
  });

  it("paginate (pagination extension) is scoped", async () => {
    const [rows] = await ta.shareClass
      .paginate()
      .withPages({ limit: 50, page: 1 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.companyId === a.companyId)).toBe(true);
  });

  it("an interactive transaction on the tenant client stays scoped", async () => {
    const found = await ta.$transaction((tx) =>
      tx.shareClass.findFirst({ where: { id: bIds.shareClassId } }),
    );
    expect(found).toBeNull();
  });

  it("a non-tenant model (user) is untouched", async () => {
    expect(
      await ta.user.findUnique({ where: { id: b.userId } }),
    ).not.toBeNull();
  });
});

describe("tenantDb writes", () => {
  it("update / delete on another tenant's id throw", async () => {
    await expect(
      ta.stakeholder.update({
        where: { id: bIds.stakeholderId },
        data: { name: "pwned" },
      }),
    ).rejects.toThrow();
    await expect(
      ta.bankAccount.delete({ where: { id: bIds.bankAccountId } }),
    ).rejects.toThrow();
    await bUnchanged();
  });

  it("updateMany / deleteMany on another tenant's id change nothing", async () => {
    const u = await ta.stakeholder.updateMany({
      where: { id: bIds.stakeholderId },
      data: { name: "pwned" },
    });
    const d = await ta.safe.deleteMany({ where: { id: bIds.safeId } });
    expect([u.count, d.count]).toEqual([0, 0]);
    await bUnchanged();
  });

  it("a companyId in update data cannot move a row to another tenant", async () => {
    const s = await ta.stakeholder.create({ data: holder("mover") });
    const moved = await ta.stakeholder.update({
      where: { id: s.id },
      data: { companyId: b.companyId },
    });
    expect(moved.companyId).toBe(a.companyId);
    await ta.stakeholder.updateMany({
      where: { id: s.id },
      data: { companyId: b.companyId },
    });
    const row = await db.stakeholder.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.companyId).toBe(a.companyId);
    await db.stakeholder.delete({ where: { id: s.id } });
  });

  it("create stamps companyId and overrides a foreign one", async () => {
    const plain = await ta.stakeholder.create({ data: holder("plain") });
    const forged = await ta.stakeholder.create({
      data: holder("forged", b.companyId),
    });
    expect([plain.companyId, forged.companyId]).toEqual([
      a.companyId,
      a.companyId,
    ]);
    await db.stakeholder.deleteMany({
      where: { id: { in: [plain.id, forged.id] } },
    });
    await bUnchanged();
  });

  it("createMany and createManyAndReturn stamp every row", async () => {
    const tag = `bulk-${Math.random().toString(36).slice(2)}`;
    await ta.stakeholder.createMany({
      data: [holder(tag, b.companyId), holder(tag, a.companyId)],
    });
    const returned = await ta.stakeholder.createManyAndReturn({
      data: [holder(tag, b.companyId)],
    });
    const rows = await db.stakeholder.findMany({ where: { name: tag } });
    expect(rows).toHaveLength(3);
    expect(returned[0]?.companyId).toBe(a.companyId);
    expect(rows.every((r) => r.companyId === a.companyId)).toBe(true);
    await db.stakeholder.deleteMany({ where: { name: tag } });
    await bUnchanged();
  });

  it("upsert on another tenant's id does not touch it and creates in own tenant", async () => {
    const row = await ta.stakeholder.upsert({
      where: { id: bIds.stakeholderId },
      update: { name: "pwned" },
      create: holder("upserted", b.companyId),
    });
    expect(row.id).not.toBe(bIds.stakeholderId);
    expect(row.companyId).toBe(a.companyId);
    await db.stakeholder.delete({ where: { id: row.id } });
    await bUnchanged();
  });
});

describe("tenantDb parent-scoped child models", () => {
  it("findMany returns only rows whose parent is in the tenant", async () => {
    const rows = await ta.dataRoomDocument.findMany({
      include: { dataRoom: true },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.dataRoom.companyId).toBe(a.companyId);
    expect(await ta.updateRecipient.findMany()).toEqual([]);
  });

  it("unique and where-taking writes cannot reach another tenant's child", async () => {
    expect(
      await ta.templateField.findUnique({ where: { id: bIds.fieldId } }),
    ).toBeNull();
    await expect(
      ta.documentShare.update({
        where: { id: bIds.documentShareId },
        data: { link: "pwned" },
      }),
    ).rejects.toThrow();
    await expect(
      ta.esignRecipient.delete({ where: { id: bIds.recipientId } }),
    ).rejects.toThrow();
    const d = await ta.dataRoomRecipient.deleteMany({
      where: { id: bIds.dataRoomRecipientId },
    });
    expect(d.count).toBe(0);
    await bUnchanged();
  });

  it("a caller's own relation filter is kept, not replaced", async () => {
    const rows = await ta.dataRoomDocument.findMany({
      where: { dataRoom: { companyId: b.companyId } },
    });
    expect(rows).toEqual([]);
  });

  it("upsert on another tenant's child does not update it", async () => {
    await expect(
      ta.updateRecipient.upsert({
        where: { id: bIds.updateRecipientId },
        update: { name: "pwned" },
        // parent is A's update, so the create branch is legitimate
        create: { updateId: aIds.updateId, email: "upsert-child@example.com" },
      }),
    ).resolves.toMatchObject({ updateId: aIds.updateId });
    await db.updateRecipient.deleteMany({
      where: { updateId: aIds.updateId },
    });
    await bUnchanged();
  });
});

describe("tenantDb unsupported operations", () => {
  it("raw SQL on the tenant client throws instead of running unscoped", async () => {
    await expect(ta.$queryRaw`SELECT 1`).rejects.toThrow(/tenantDb/);
    await expect(ta.$executeRaw`SELECT 1`).rejects.toThrow(/tenantDb/);
    await expect(ta.$queryRawUnsafe("SELECT 1")).rejects.toThrow(/tenantDb/);
    await expect(ta.$executeRawUnsafe("SELECT 1")).rejects.toThrow(/tenantDb/);
  });
});

describe("tenantDb known limits (pin current, UNPROTECTED behaviour)", () => {
  it("LIMIT: nested connect in data can point an own row at another tenant's row", async () => {
    const plan = await ta.equityPlan.update({
      where: { id: aIds.equityPlanId },
      data: { shareClass: { connect: { id: bIds.shareClassId } } },
      include: { shareClass: true },
    });
    // LIMIT: include returns B's share class through the forged FK
    expect(plan.shareClass.companyId).toBe(b.companyId);
    await db.equityPlan.update({
      where: { id: aIds.equityPlanId },
      data: { shareClassId: aIds.shareClassId },
    });
  });

  it("LIMIT: create on a child model does not check the parent's tenant", async () => {
    const row = await ta.dataRoomDocument.create({
      data: { dataRoomId: bIds.dataRoomId, documentId: aIds.documentId },
    });
    expect(row.dataRoomId).toBe(bIds.dataRoomId);
    await db.dataRoomDocument.delete({ where: { id: row.id } });
    await bUnchanged();
  });

  it("LIMIT: Company is not a tenant model", async () => {
    expect(
      await ta.company.findUnique({ where: { id: b.companyId } }),
    ).not.toBeNull();
  });
});
