import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});
afterAll(async () => {
  await db.companyDomain.deleteMany({
    where: { companyId: { in: [a.companyId, b.companyId] } },
  });
  await cleanupTenants(a, b);
});

describe("CompanyDomain constraints", () => {
  it("allows one live row per hostname, case-insensitively unique by construction", async () => {
    await db.companyDomain.create({
      data: {
        companyId: a.companyId,
        hostname: "dup.dealroom.tin.info",
        kind: "PLATFORM",
        status: "ACTIVE",
        isPrimary: true,
      },
    });
    await expect(
      db.companyDomain.create({
        data: {
          companyId: b.companyId,
          hostname: "dup.dealroom.tin.info",
          kind: "PLATFORM",
          status: "ACTIVE",
          isPrimary: true,
        },
      }),
    ).rejects.toThrow();
  });
  it("rejects upper-case hostnames", async () => {
    await expect(
      db.companyDomain.create({
        data: {
          companyId: b.companyId,
          hostname: "Upper.dealroom.tin.info",
          kind: "PLATFORM",
          status: "ACTIVE",
          isPrimary: false,
        },
      }),
    ).rejects.toThrow();
  });
  it("allows one primary per company", async () => {
    await expect(
      db.companyDomain.create({
        data: {
          companyId: a.companyId,
          hostname: "second.dealroom.tin.info",
          kind: "PLATFORM",
          status: "ACTIVE",
          isPrimary: true,
        },
      }),
    ).rejects.toThrow();
  });
  it("a RELEASED row frees the hostname", async () => {
    await db.companyDomain.updateMany({
      where: { hostname: "dup.dealroom.tin.info" },
      data: { status: "RELEASED", isPrimary: false },
    });
    await expect(
      db.companyDomain.create({
        data: {
          companyId: b.companyId,
          hostname: "dup.dealroom.tin.info",
          kind: "PLATFORM",
          status: "ACTIVE",
          isPrimary: true,
        },
      }),
    ).resolves.toBeTruthy();
  });
  it("users start at sessionVersion 0", async () => {
    const u = await db.user.findUniqueOrThrow({
      where: { id: a.userId },
      select: { sessionVersion: true },
    });
    expect(u.sessionVersion).toBe(0);
  });
});
