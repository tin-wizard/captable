import { db } from "@/server/db";
import { domainConfig } from "@/server/domains/config";
import { getTenantLoginView } from "@/server/domains/login-view";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTenant } from "../helpers/seed";

let a: Tenant;
let b: Tenant;
const LOGO = "https://cdn.example.com/acme-logo.png";
const hostname = "acme.dealroom.tin.info";
const view = (companyId: string, next: string | null = null) =>
  getTenantLoginView({ companyId, hostname, next });

beforeAll(async () => {
  a = await seedTenant("loginview-a");
  b = await seedTenant("loginview-b");
  await db.company.update({
    where: { id: a.companyId },
    data: { logo: LOGO, showNameOnLogin: false },
  });
  await db.company.update({
    where: { id: b.companyId },
    data: { logo: `${LOGO}?b`, showNameOnLogin: true },
  });
});

afterAll(async () => {
  await cleanupTenants(a, b);
});

describe("getTenantLoginView", () => {
  it("not opted in: shows only the hostname, never the name or logo", async () => {
    const v = await view(a.companyId);
    expect(v.title).toBe(hostname);
    expect(v.logo).toBeNull();
    const json = JSON.stringify(v);
    expect(json).not.toContain("loginview-a");
    expect(json).not.toContain(LOGO);
  });

  it("opted in: shows the company name and logo", async () => {
    const v = await view(b.companyId);
    expect(v.title).toBe("loginview-b Inc");
    expect(v.logo).toBe(`${LOGO}?b`);
  });

  it("continue link falls back to / for foreign or protocol-relative next", async () => {
    for (const next of ["https://evil.com", "//evil.com"]) {
      expect((await view(a.companyId, next)).continueHref).toBe(
        "/auth/handoff/start?next=%2F",
      );
    }
  });

  it("a deep path survives into the continue link", async () => {
    expect((await view(a.companyId, "/abc/stakeholders")).continueHref).toBe(
      "/auth/handoff/start?next=%2Fabc%2Fstakeholders",
    );
  });

  it("the other company link points at the canonical login", async () => {
    expect((await view(a.companyId)).canonicalLoginHref).toBe(
      `${domainConfig().canonicalOrigin}/login`,
    );
  });

  it("never leaks another tenant's name", async () => {
    const json = JSON.stringify(await view(a.companyId));
    expect(json).not.toContain("loginview-b");
    expect(JSON.stringify(await view(b.companyId))).not.toContain(
      "loginview-a",
    );
  });
});
