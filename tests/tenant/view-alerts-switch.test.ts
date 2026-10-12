import { db } from "@/server/db";
import { appRouter } from "@/trpc/api/root";
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

  it("digest switch updates only the caller's own member row", async () => {
    const asA = callerFor(a);
    const other = await db.member.create({
      data: {
        companyId: a.companyId,
        userId: (
          await db.user.create({
            data: { email: `digest-${Date.now()}@example.test` },
          })
        ).id,
        status: "ACTIVE",
        isOnboarded: true,
      },
    });
    expect(await asA.member.viewDigest()).toBe(false);

    expect(await asA.member.setViewDigest({ enabled: true })).toBe(true);
    expect(await asA.member.viewDigest()).toBe(true);
    expect(
      (await db.member.findUniqueOrThrow({ where: { id: other.id } }))
        .viewDigest,
    ).toBe(false);
    expect(
      (await db.member.findUniqueOrThrow({ where: { id: b.memberId } }))
        .viewDigest,
    ).toBe(false);

    expect(await asA.member.setViewDigest({ enabled: false })).toBe(false);
    expect(await asA.member.viewDigest()).toBe(false);

    await db.member.delete({ where: { id: other.id } });
    await db.user.delete({ where: { id: other.userId } });
  });

  it("works on a company host, as a company-host user reaches it", async () => {
    const onHost = appRouter.createCaller({
      db,
      session: a.session,
      requestIp: "127.0.0.1",
      userAgent: "vitest",
      headers: new Headers(),
      host: {
        kind: "tenant",
        hostname: "x.dealroom.tin.info",
        companyId: a.companyId,
        publicId: "p",
      },
    } as never);

    expect(await onHost.member.setViewAlerts({ enabled: true })).toBe(true);
    expect(await onHost.member.viewAlerts()).toBe(true);
  });
});
