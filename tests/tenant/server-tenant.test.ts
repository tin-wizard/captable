import { db } from "@/server/db";
import { getServerTenant } from "@/server/tenant";
import type { Session } from "next-auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

// getServerTenant -> getServerPermissions -> withServerComponentSession: only
// the session (the next-auth cookie) is faked; the membership check is real.
let current: Session;
vi.mock("@/server/auth", async (orig) => ({
  ...(await orig<typeof import("@/server/auth")>()),
  withServerComponentSession: async () => current,
}));

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
});
afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

describe("getServerTenant", () => {
  it("resolves the caller's company and returns a db scoped to it", async () => {
    current = a.session;
    const t = await getServerTenant();
    expect(t.companyId).toBe(a.companyId);
    expect(t.memberId).toBe(a.memberId);
    const shareClasses = await t.db.shareClass.findMany();
    expect(shareClasses.length).toBeGreaterThan(0);
    expect(shareClasses.every((r) => r.companyId === a.companyId)).toBe(true);
    // B's rows are invisible, even asked for by id
    const bRow = await db.shareClass.findFirstOrThrow({
      where: { companyId: b.companyId },
    });
    expect(
      await t.db.shareClass.findFirst({ where: { id: bRow.id } }),
    ).toBeNull();
  });

  it("rejects a deactivated member even though the JWT still claims the company", async () => {
    await db.member.update({
      where: { id: a.memberId },
      data: { status: "INACTIVE" },
    });
    try {
      current = a.session;
      await expect(getServerTenant()).rejects.toThrow("membership not found");
    } finally {
      await db.member.update({
        where: { id: a.memberId },
        data: { status: "ACTIVE" },
      });
    }
  });
});
