import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Tenant,
  callerFor,
  cleanupTenants,
  seedTwoTenants,
} from "../helpers/seed";

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});

afterAll(async () => {
  await cleanupTenants(a, b);
});

describe("member alert switch", () => {
  it("reads on by default and persists a change for the caller only", async () => {
    const asA = callerFor(a);
    expect(await asA.member.viewAlerts()).toBe(true);

    expect(await asA.member.setViewAlerts({ enabled: false })).toBe(false);
    expect(await asA.member.viewAlerts()).toBe(false);

    const bMember = await db.member.findUniqueOrThrow({
      where: { id: b.memberId },
    });
    expect(bMember.notifyOnView).toBe(true);
  });
});
