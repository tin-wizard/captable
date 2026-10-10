import { db } from "@/server/db";
import { isUserLevelPath, layoutRedirect } from "@/server/domains/redirects";
import type { RequestHost } from "@/server/domains/request-host";
import { isActiveMember } from "@/server/member";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: true,
    canonicalHost: "dealroom.tin.info",
    canonicalOrigin: "https://dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
    port: "",
  }),
  tenantOrigin: (h: string) => `https://${h}`,
}));

const canonical: RequestHost = { kind: "canonical" };
const tenant: RequestHost = {
  kind: "tenant",
  hostname: "acme.dealroom.tin.info",
  companyId: "c1",
  publicId: "pub",
};
const alias: RequestHost = {
  kind: "alias",
  redirectHost: "new.dealroom.tin.info",
};
const unknown: RequestHost = { kind: "unknown" };
const primary = "acme.dealroom.tin.info";

describe("isUserLevelPath", () => {
  it.each([
    ["/pub/settings/profile", true],
    ["/pub/settings/profile?x=1", true],
    ["/pub/settings/security", true],
    ["/pub/settings/security/passkey", true],
    ["/pub/settings/profiles", false],
    ["/pub/settings/company", false],
    ["/pub/stakeholders", false],
    ["/pub", false],
  ])("%s → %s", (path, expected) => {
    expect(isUserLevelPath(path)).toBe(expected);
  });
});

describe("layoutRedirect", () => {
  it.each<[string, Parameters<typeof layoutRedirect>[0], unknown]>([
    [
      "alias → primary host, path kept",
      {
        host: alias,
        path: "/pub/stakeholders?x=1",
        routePublicId: "pub",
        routeCompanyPrimaryHost: primary,
      },
      { redirect: "https://new.dealroom.tin.info/pub/stakeholders?x=1" },
    ],
    [
      "tenant, foreign route publicId → 404",
      {
        host: tenant,
        path: "/other/stakeholders",
        routePublicId: "other",
        routeCompanyPrimaryHost: "other.dealroom.tin.info",
      },
      { notFound: true },
    ],
    [
      "tenant, user-level → canonical",
      {
        host: tenant,
        path: "/pub/settings/security/passkey",
        routePublicId: "pub",
        routeCompanyPrimaryHost: primary,
      },
      { redirect: "https://dealroom.tin.info/pub/settings/security/passkey" },
    ],
    [
      "tenant, company path → stay",
      {
        host: tenant,
        path: "/pub/stakeholders",
        routePublicId: "pub",
        routeCompanyPrimaryHost: primary,
      },
      null,
    ],
    [
      "canonical, user-level → stay (no loop)",
      {
        host: canonical,
        path: "/pub/settings/profile",
        routePublicId: "pub",
        routeCompanyPrimaryHost: primary,
      },
      null,
    ],
    [
      "canonical, route company with primary → its host (not the session's)",
      {
        host: canonical,
        path: "/legacyPub/stakeholders",
        routePublicId: "legacyPub",
        routeCompanyPrimaryHost: "legacy.dealroom.tin.info",
      },
      { redirect: "https://legacy.dealroom.tin.info/legacyPub/stakeholders" },
    ],
    [
      "canonical, no primary (flag off) → stay",
      {
        host: canonical,
        path: "/pub/stakeholders",
        routePublicId: "pub",
        routeCompanyPrimaryHost: null,
      },
      null,
    ],
    [
      "unknown host → 404",
      {
        host: unknown,
        path: "/pub",
        routePublicId: "pub",
        routeCompanyPrimaryHost: primary,
      },
      { notFound: true },
    ],
  ])("%s", (_name, input, expected) => {
    expect(layoutRedirect(input)).toEqual(expected);
  });
});

describe("isActiveMember", () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => {
    ({ a, b } = await seedTwoTenants());
    // a's user also joins b's company
    await db.member.create({
      data: {
        userId: a.userId,
        companyId: b.companyId,
        status: "ACTIVE",
        isOnboarded: true,
      },
    });
  });
  afterAll(async () => cleanupTenants(a, b));

  it("a multi-company user is a member of both companies", async () => {
    expect(await isActiveMember(a.userId, a.companyId)).toBe(true);
    expect(await isActiveMember(a.userId, b.companyId)).toBe(true);
  });

  it("an outsider is not", async () => {
    expect(await isActiveMember(b.userId, a.companyId)).toBe(false);
  });

  it("an inactive membership does not count", async () => {
    await db.member.updateMany({
      where: { userId: a.userId, companyId: b.companyId },
      data: { status: "INACTIVE" },
    });
    expect(await isActiveMember(a.userId, b.companyId)).toBe(false);
  });
});
