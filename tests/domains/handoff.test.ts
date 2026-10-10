import { db } from "@/server/db";
import { consumeHandoff, issueHandoff, sha256 } from "@/server/domains/handoff";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});
afterAll(async () => {
  // AuthHandoff has no FK, so company deletion doesn't cascade to it
  await db.authHandoff.deleteMany({
    where: { userId: { in: [a.userId, b.userId] } },
  });
  await cleanupTenants(a, b);
});

const HOST = "ho-a.dealroom.tin.info";
const issue = (state = "S1", userId = a.userId, companyId = a.companyId) =>
  issueHandoff({
    userId,
    companyId,
    targetHost: HOST,
    stateHash: sha256(state),
    next: "/x",
  });

describe("handoff", () => {
  it("issues and consumes exactly once", async () => {
    const r = await issue();
    if ("error" in r) throw new Error("unexpected");
    expect(
      await consumeHandoff({ code: r.code, state: "S1", host: HOST }),
    ).toMatchObject({
      userId: a.userId,
      companyId: a.companyId,
      next: "/x",
    });
    expect(
      await consumeHandoff({ code: r.code, state: "S1", host: HOST }),
    ).toBeNull();
  });
  it("refuses a non-member", async () => {
    expect(await issue("S1", a.userId, b.companyId)).toEqual({
      error: "no-membership",
    });
  });
  it("refuses the wrong host (code replay on another company host)", async () => {
    const r = await issue();
    if ("error" in r) throw new Error("unexpected");
    expect(
      await consumeHandoff({
        code: r.code,
        state: "S1",
        host: "evil.dealroom.tin.info",
      }),
    ).toBeNull();
  });
  it("refuses without the matching state cookie (login CSRF)", async () => {
    const r = await issue();
    if ("error" in r) throw new Error("unexpected");
    expect(
      await consumeHandoff({ code: r.code, state: "attacker", host: HOST }),
    ).toBeNull();
  });
  it("refuses an expired code", async () => {
    const r = await issue();
    if ("error" in r) throw new Error("unexpected");
    await db.authHandoff.updateMany({
      where: { codeHash: sha256(r.code) },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(
      await consumeHandoff({ code: r.code, state: "S1", host: HOST }),
    ).toBeNull();
  });
  it("concurrent consumption: exactly one succeeds", async () => {
    const r = await issue();
    if ("error" in r) throw new Error("unexpected");
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        consumeHandoff({ code: r.code, state: "S1", host: HOST }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("membership revoked between issue and consume", async () => {
    const r = await issue();
    if ("error" in r) throw new Error("unexpected");
    await db.member.updateMany({
      where: { userId: a.userId, companyId: a.companyId },
      data: { status: "INACTIVE" },
    });
    expect(
      await consumeHandoff({ code: r.code, state: "S1", host: HOST }),
    ).toBeNull();
    await db.member.updateMany({
      where: { userId: a.userId, companyId: a.companyId },
      data: { status: "ACTIVE" },
    });
  });
  it("stores only hashes", async () => {
    const r = await issue();
    if ("error" in r) throw new Error("unexpected");
    expect(await db.authHandoff.count({ where: { codeHash: r.code } })).toBe(0);
  });
  it("purges rows expired more than an hour ago on issue", async () => {
    const stale = await db.authHandoff.create({
      data: {
        codeHash: `stale-${Date.now()}`,
        stateHash: "x",
        userId: a.userId,
        companyId: a.companyId,
        memberId: a.memberId,
        targetHost: HOST,
        next: "/",
        expiresAt: new Date(Date.now() - 2 * 3_600_000),
      },
    });
    await issue();
    expect(await db.authHandoff.count({ where: { id: stale.id } })).toBe(0);
  });
});
