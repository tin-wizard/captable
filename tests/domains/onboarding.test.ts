import { db } from "@/server/db";
import { clearResolveCache } from "@/server/domains/registry";
import { appRouter } from "@/trpc/api/root";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Tenant, cleanupTenants, seedTenant } from "../helpers/seed";

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: flag.enabled,
    canonicalHost: "dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
    port: "",
  }),
  tenantOrigin: (h: string) => `https://${h}`,
}));

const run = nanoid(6)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x");
let existing: Tenant;
const createdNames: string[] = [];

const caller = (t: Tenant) =>
  appRouter.createCaller({
    db,
    session: t.session,
    requestIp: "127.0.0.1",
    userAgent: "vitest",
    headers: new Headers(),
    host: { kind: "canonical" },
  });

const payload = (name: string, subdomain?: string) => {
  createdNames.push(name);
  return {
    user: { name: "Founder", email: "f@example.com", title: "CEO" },
    company: {
      name,
      incorporationType: "c-corp",
      incorporationDate: "2020-01-01",
      incorporationCountry: "US",
      incorporationState: "DE",
      streetAddress: "1 Main St",
      city: "Wilmington",
      state: "DE",
      zipcode: "19801",
      country: "US",
      ...(subdomain ? { subdomain } : {}),
    },
  };
};

beforeAll(async () => {
  existing = await seedTenant("onb");
});
beforeEach(() => {
  flag.enabled = true;
  clearResolveCache();
});
afterAll(async () => {
  const cs = await db.company.findMany({
    where: { name: { in: createdNames } },
    select: { id: true },
  });
  const ids = cs.map((c) => c.id);
  await db.audit.deleteMany({ where: { companyId: { in: ids } } });
  await db.company.deleteMany({ where: { id: { in: ids } } });
  await cleanupTenants(existing);
  clearResolveCache();
});

describe("onboarding with subdomain", () => {
  it("creates company, ACTIVE primary and returns the tenant url", async () => {
    const label = `botski-${run}`;
    const r = await caller(existing).onboarding.onboard(
      payload(`Botski ${run}`, label),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    const company = await db.company.findUnique({
      where: { publicId: r.publicId },
    });
    expect(company).not.toBeNull();
    const d = await db.companyDomain.findFirst({
      where: { companyId: company?.id },
    });
    expect(d).toMatchObject({
      hostname: `${label}.dealroom.tin.info`,
      status: "ACTIVE",
      isPrimary: true,
    });
    expect(r.url).toBe(`https://${label}.dealroom.tin.info/${r.publicId}`);
    expect(
      await db.audit.count({
        where: { companyId: company?.id, action: "company.subdomain-assigned" },
      }),
    ).toBe(1);
  });

  it("derives the label from the name when none is given", async () => {
    const r = await caller(existing).onboarding.onboard(
      payload(`Derived ${run} Co`),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    const d = await db.companyDomain.findFirst({
      where: { company: { publicId: r.publicId } },
    });
    expect(d?.hostname.startsWith("derived-")).toBe(true);
  });

  it("rejects a taken subdomain and creates no company", async () => {
    const label = `taken-${run}`;
    await caller(existing).onboarding.onboard(payload(`Taker ${run}`, label));
    const before = await db.company.count();
    const r = await caller(existing).onboarding.onboard(
      payload(`Loser ${run}`, label),
    );
    expect(r).toMatchObject({ success: false, field: "subdomain" });
    expect(await db.company.count()).toBe(before);
  });

  it("rejects a reserved subdomain and creates no company", async () => {
    const before = await db.company.count();
    const r = await caller(existing).onboarding.onboard(
      payload(`Reserved ${run}`, "admin"),
    );
    expect(r).toMatchObject({
      success: false,
      field: "subdomain",
      suggestion: null,
    });
    expect(await db.company.count()).toBe(before);
  });

  it("updateCompany ignores a subdomain in the payload", async () => {
    const label = `upd-${run}`;
    const r = await caller(existing).onboarding.onboard(
      payload(`Updater ${run}`, label),
    );
    if (!r.success) throw new Error("setup failed");
    const company = await db.company.findUniqueOrThrow({
      where: { publicId: r.publicId },
    });
    const member = await db.member.findFirstOrThrow({
      where: { companyId: company.id },
    });
    const t: Tenant = {
      ...existing,
      companyId: company.id,
      memberId: member.id,
      session: {
        ...existing.session,
        user: {
          ...existing.session.user,
          companyId: company.id,
          memberId: member.id,
          companyPublicId: company.publicId,
        },
      },
    };
    const res = await appRouter
      .createCaller({
        db,
        session: t.session,
        requestIp: "127.0.0.1",
        userAgent: "vitest",
        headers: new Headers(),
        host: {
          kind: "tenant",
          hostname: `${label}.dealroom.tin.info`,
          companyId: company.id,
          publicId: company.publicId,
        },
      } as never)
      .company.updateCompany(payload(`Updater ${run}`, "other-label"));
    expect(res.success).toBe(true);
    const domains = await db.companyDomain.findMany({
      where: { companyId: company.id },
    });
    expect(domains.map((x) => x.hostname)).toEqual([
      `${label}.dealroom.tin.info`,
    ]);
  });

  it("flag off: no domain row and a relative url", async () => {
    flag.enabled = false;
    const r = await caller(existing).onboarding.onboard(
      payload(`Flagoff ${run}`, `off-${run}`),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.url).toBe(`/${r.publicId}`);
    expect(
      await db.companyDomain.count({
        where: { company: { publicId: r.publicId } },
      }),
    ).toBe(0);
  });
});
