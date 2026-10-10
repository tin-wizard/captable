import { db } from "@/server/db";
import { appRouter } from "@/trpc/api/root";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});
afterAll(async () => cleanupTenants(a, b));

const callerOn = (host: unknown, t: Tenant | null) =>
  appRouter.createCaller({
    db,
    session: t?.session ?? null,
    requestIp: "127.0.0.1",
    userAgent: "vitest",
    headers: new Headers(),
    host,
  } as never);
const tenantHost = (t: Tenant) => ({
  kind: "tenant",
  hostname: "x.dealroom.tin.info",
  companyId: t.companyId,
  publicId: "p",
});

describe("company-host procedure rules", () => {
  it("denies user-level procedures on a company host", async () => {
    await expect(
      callerOn(tenantHost(a), a).company.switchCompany({ id: "anything" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerOn(tenantHost(a), a).passkey.find(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies public auth procedures on a company host", async () => {
    await expect(
      callerOn(tenantHost(a), null).auth.forgotPassword("x@y.z"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("fails closed when host is missing", async () => {
    await expect(
      callerOn(undefined, a).company.switchCompany({ id: "anything" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows tenant procedures on a company host", async () => {
    await expect(
      callerOn(tenantHost(a), a).stakeholder.getStakeholders(),
    ).resolves.toBeDefined();
  });
  it("canonical keeps today's behaviour", async () => {
    await expect(
      callerOn({ kind: "canonical" }, a).company.switchCompany({ id: "nope" }),
    ).resolves.toEqual({ success: true });
  });
});
