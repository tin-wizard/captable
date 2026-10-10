import {
  authOptions,
  bumpSessionVersion,
  checkMembership,
  isSessionVersionCurrent,
  sessionFromTenantClaims,
} from "@/server/auth";
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});
afterAll(async () => cleanupTenants(a, b));

describe("session version", () => {
  it("current until bumped, then stale everywhere", async () => {
    expect(await isSessionVersionCurrent(a.userId, 0)).toBe(true);
    expect(await isSessionVersionCurrent(a.userId, undefined)).toBe(true);
    await bumpSessionVersion(a.userId);
    expect(await isSessionVersionCurrent(a.userId, 0)).toBe(false);
    expect(await isSessionVersionCurrent(a.userId, 1)).toBe(true);
  });

  it("treats a non-number sv as stale", async () => {
    expect(await isSessionVersionCurrent(b.userId, "0" as never)).toBe(false);
    expect(await isSessionVersionCurrent(b.userId, null as never)).toBe(false);
  });

  it("update() cannot revive a revoked token", async () => {
    await bumpSessionVersion(b.userId);
    const jwt = authOptions.callbacks?.jwt as (p: unknown) => Promise<{
      sv?: number;
    }>;
    const token = await jwt({
      token: { sub: b.userId, sv: 0 },
      trigger: "update",
    });
    expect(token.sv).toBe(0);
    expect(await isSessionVersionCurrent(b.userId, token.sv)).toBe(false);
  });
});

describe("tenant claims become a normal Session", () => {
  it("maps company fields from the claims, never from elsewhere", () => {
    const s = sessionFromTenantClaims(
      {
        sub: a.userId,
        cid: a.companyId,
        mid: "m",
        pid: "pub",
        hst: "x.dealroom.tin.info",
        sv: 0,
        name: "A",
        email: "a@x",
      },
      new Date(Date.now() + 1000),
    );
    expect(s.user).toMatchObject({
      id: a.userId,
      companyId: a.companyId,
      memberId: "m",
      companyPublicId: "pub",
      isOnboarded: true,
      status: "ACTIVE",
    });
  });

  it("same user, two hosts, two companies: each session sees only its own company", async () => {
    const memberB = await db.member.create({
      data: {
        userId: a.userId,
        companyId: b.companyId,
        role: "ADMIN",
        status: "ACTIVE",
        isOnboarded: true,
      },
    });
    try {
      const sa = sessionFromTenantClaims(
        {
          sub: a.userId,
          cid: a.companyId,
          mid: a.memberId,
          pid: "pa",
          hst: "a.dealroom.tin.info",
          sv: 1,
        },
        new Date(Date.now() + 1e6),
      );
      const sb = sessionFromTenantClaims(
        {
          sub: a.userId,
          cid: b.companyId,
          mid: memberB.id,
          pid: "pb",
          hst: "b.dealroom.tin.info",
          sv: 1,
        },
        new Date(Date.now() + 1e6),
      );
      expect((await checkMembership({ session: sa, tx: db })).companyId).toBe(
        a.companyId,
      );
      expect((await checkMembership({ session: sb, tx: db })).companyId).toBe(
        b.companyId,
      );
    } finally {
      await db.member.delete({ where: { id: memberB.id } });
    }
  });
});
