import { db } from "@/server/db";
import {
  DomainTakenError,
  InvalidLabelError,
  assignPlatformSubdomain,
  clearResolveCache,
  isLabelAvailable,
  primaryHostname,
  renamePlatformSubdomain,
  resolveHostname,
  suggestAvailableLabel,
} from "@/server/domains/registry";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type Tenant,
  cleanupTenants,
  seedTenant,
  seedTwoTenants,
} from "../helpers/seed";

vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: true,
    canonicalHost: "dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
  }),
}));

let a: Tenant;
let b: Tenant;
let c: Tenant;
beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});
afterAll(async () => cleanupTenants(a, b, ...(c ? [c] : [])));
beforeEach(() => clearResolveCache());

describe("registry", () => {
  it("assigns, resolves and reports the primary", async () => {
    await db.$transaction((tx) =>
      assignPlatformSubdomain(tx, {
        companyId: a.companyId,
        label: "reg-a",
        createdById: a.userId,
      }),
    );
    expect(await primaryHostname(db, a.companyId)).toBe(
      "reg-a.dealroom.tin.info",
    );
    expect(await resolveHostname("reg-a.dealroom.tin.info")).toMatchObject({
      companyId: a.companyId,
      status: "ACTIVE",
    });
    expect(await isLabelAvailable(db, "reg-a")).toBe(false);
  });

  it("rejects reserved and malformed labels", async () => {
    await expect(
      db.$transaction((tx) =>
        assignPlatformSubdomain(tx, {
          companyId: b.companyId,
          label: "admin",
          createdById: b.userId,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidLabelError);
    await expect(
      db.$transaction((tx) =>
        assignPlatformSubdomain(tx, {
          companyId: b.companyId,
          label: "Bad Label",
          createdById: b.userId,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidLabelError);
  });

  it("concurrent claims: exactly one wins, the loser gets a suggestion", async () => {
    // b and c have no primary yet, so only the hostname constraint can decide
    c = await seedTenant("c");
    const claim = (t: Tenant) =>
      db.$transaction((tx) =>
        assignPlatformSubdomain(tx, {
          companyId: t.companyId,
          label: "race",
          createdById: t.userId,
        }),
      );
    const results = await Promise.allSettled([claim(b), claim(c)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(lost[0]?.reason).toBeInstanceOf(DomainTakenError);
    expect((lost[0]?.reason as DomainTakenError).suggestion).toBe("race-2");
  });

  it("rename keeps the old label as a 30-day alias pointing at the new primary", async () => {
    await db.$transaction((tx) =>
      renamePlatformSubdomain(tx, {
        companyId: a.companyId,
        label: "reg-a-new",
        createdById: a.userId,
      }),
    );
    const old = await resolveHostname("reg-a.dealroom.tin.info");
    expect(old).toMatchObject({
      status: "ALIAS",
      primaryHostname: "reg-a-new.dealroom.tin.info",
    });
    const row = await db.companyDomain.findFirstOrThrow({
      where: { hostname: "reg-a.dealroom.tin.info" },
    });
    // biome-ignore lint/style/noNonNullAssertion: set by rename
    expect(row.aliasExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
      29 * 864e5,
    );
  });

  it("unknown hosts resolve to null, and expired aliases are not served", async () => {
    expect(await resolveHostname("nope.dealroom.tin.info")).toBeNull();
    await db.companyDomain.updateMany({
      where: { hostname: "reg-a.dealroom.tin.info" },
      data: { aliasExpiresAt: new Date(Date.now() - 1000) },
    });
    clearResolveCache();
    expect(await resolveHostname("reg-a.dealroom.tin.info")).toBeNull();
  });

  it("lets another company claim an expired alias's hostname", async () => {
    // rename works whether b won or lost the race above
    await db.$transaction((tx) =>
      renamePlatformSubdomain(tx, {
        companyId: b.companyId,
        label: "reg-a",
        createdById: b.userId,
      }),
    );
    expect(await resolveHostname("reg-a.dealroom.tin.info")).toMatchObject({
      companyId: b.companyId,
      status: "ACTIVE",
    });
    const released = await db.companyDomain.findFirstOrThrow({
      where: { hostname: "reg-a.dealroom.tin.info", companyId: a.companyId },
    });
    expect(released.status).toBe("RELEASED");
  });

  it("renaming back to an own live alias promotes it", async () => {
    const rename = (label: string) =>
      db.$transaction((tx) =>
        renamePlatformSubdomain(tx, {
          companyId: a.companyId,
          label,
          createdById: a.userId,
        }),
      );
    await rename("reg-a-back");
    await expect(rename("reg-a-new")).resolves.toEqual({
      hostname: "reg-a-new.dealroom.tin.info",
    });
    expect(await primaryHostname(db, a.companyId)).toBe(
      "reg-a-new.dealroom.tin.info",
    );
    expect(await resolveHostname("reg-a-back.dealroom.tin.info")).toMatchObject(
      { status: "ALIAS", primaryHostname: "reg-a-new.dealroom.tin.info" },
    );
  });

  it("suggests the next free label", async () => {
    expect(await suggestAvailableLabel(db, "Race")).toBe("race-2");
  });

  it("falls back to company-<seed> when company..company-99 are taken", async () => {
    const taken = [
      "company",
      ...Array.from({ length: 98 }, (_, i) => `company-${i + 2}`),
    ].map((l) => ({ hostname: `${l}.dealroom.tin.info` }));
    const spy = vi
      .spyOn(db.companyDomain, "findMany")
      // biome-ignore lint/suspicious/noExplicitAny: stubbed prisma promise
      .mockResolvedValue(taken as any);
    try {
      expect(await suggestAvailableLabel(db, "日本株式会社")).toBeNull();
      expect(await suggestAvailableLabel(db, "日本株式会社", "Abc123xyz")).toBe(
        "company-abc123",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
