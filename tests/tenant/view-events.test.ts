import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});

afterAll(async () => {
  await cleanupTenants(a, b);
});

describe("ViewEvent is a tenant model", () => {
  it("tenant A never sees tenant B's events", async () => {
    const mine = await db.viewEvent.create({
      data: {
        companyId: a.companyId,
        kind: "ESIGN",
        targetId: "t",
        recipientId: "r",
        ip: "1.2.3.0",
        userAgent: "ua",
      },
    });
    const theirs = await db.viewEvent.create({
      data: {
        companyId: b.companyId,
        kind: "ESIGN",
        targetId: "t",
        recipientId: "r",
        ip: "1.2.3.0",
        userAgent: "ua",
      },
    });

    const seen = await tenantDb(db, a.companyId).viewEvent.findMany();

    expect(seen.map((e) => e.id)).toContain(mine.id);
    expect(seen.map((e) => e.id)).not.toContain(theirs.id);
  });

  it("a member's alert switch defaults to on", async () => {
    const member = await db.member.findUniqueOrThrow({
      where: { id: a.memberId },
    });
    expect(member.notifyOnView).toBe(true);
  });
});
