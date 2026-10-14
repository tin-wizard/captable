import { db } from "@/server/db";
import {
  CustomDomainError,
  addCustomDomain,
  listDomains,
  liveCustomHostnames,
  removeCustomDomain,
  setPrimaryDomain,
  verifyCustomDomain,
} from "@/server/domains/custom";
import type { DnsDeps } from "@/server/domains/dns";
import {
  PlatformRenameBlockedError,
  assignPlatformSubdomain,
  clearResolveCache,
  isLabelAvailable,
  primaryHostname,
  renamePlatformSubdomain,
  resolveHostname,
} from "@/server/domains/registry";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Tenant, cleanupTenants, seedTenant } from "../helpers/seed";

vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: true,
    canonicalHost: "dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
  }),
}));

const cors = vi.hoisted(() => ({
  sync: vi.fn(async (_o: string[]): Promise<unknown> => ({ skipped: true })),
}));
vi.mock("@/server/domains/cors", () => ({
  syncCustomOriginsCors: cors.sync,
}));

const tenants: Tenant[] = [];
afterAll(async () => cleanupTenants(...tenants));
beforeEach(() => clearResolveCache());
afterEach(() => {
  vi.useRealTimers();
});

const rand = () =>
  nanoid(8)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "x");
const host = () => `investors-${rand()}.implexus.io`;

// A company with its platform address as primary.
async function fresh() {
  const t = await seedTenant(`cd-${rand()}`);
  tenants.push(t);
  const label = `cd-${rand()}`;
  const { hostname } = await db.$transaction((tx) =>
    assignPlatformSubdomain(tx, {
      companyId: t.companyId,
      label,
      createdById: t.userId,
    }),
  );
  return { ...t, label, platformHost: hostname };
}

// DNS that publishes `token` as the challenge and CNAMEs to the canonical host.
const fakeDns = (token: string | null): DnsDeps => ({
  resolveTxt: async () => (token ? [[token]] : []),
  resolveCname: async () => (token ? ["dealroom.tin.info"] : []),
  resolve4: async () => [],
});

const row = (id: string) =>
  db.companyDomain.findUniqueOrThrow({ where: { id } });

const code = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e) => (e instanceof CustomDomainError ? e.code : e),
  );

// Verify never promotes (controller ruling); `primary` then runs Make primary.
async function addAndVerify(
  t: Tenant,
  hostname = host(),
  { primary = true } = {},
) {
  const added = await addCustomDomain({
    companyId: t.companyId,
    raw: hostname,
    createdById: t.userId,
  });
  const res = await verifyCustomDomain(
    { companyId: t.companyId, domainId: added.id },
    fakeDns(added.verificationToken),
  );
  expect(res.ok).toBe(true);
  if (primary)
    await setPrimaryDomain({ companyId: t.companyId, domainId: added.id });
  return added;
}

describe("custom domains", () => {
  it("(a) adds a PENDING non-primary row with a token, refuses bad input, is idempotent", async () => {
    const a = await fresh();
    const h = host();
    const added = await addCustomDomain({
      companyId: a.companyId,
      raw: `https://${h.toUpperCase()}/x`,
      createdById: a.userId,
    });
    expect(added).toMatchObject({
      hostname: h,
      kind: "CUSTOM",
      status: "PENDING",
      isPrimary: false,
      verifiedAt: null,
    });
    expect(added.verificationToken).toMatch(/^[0-9a-f]{32}$/);
    expect(await row(added.id)).toMatchObject({
      companyId: a.companyId,
      status: "PENDING",
      createdById: a.userId,
    });

    const again = await addCustomDomain({
      companyId: a.companyId,
      raw: h,
      createdById: a.userId,
    });
    expect(again.id).toBe(added.id);
    expect(
      await db.companyDomain.count({
        where: { companyId: a.companyId, hostname: h },
      }),
    ).toBe(1);

    const add = (raw: string) =>
      code(
        addCustomDomain({ companyId: a.companyId, raw, createdById: a.userId }),
      );
    expect(await add("acme.dealroom.tin.info")).toBe("platform");
    expect(await add("10.0.0.1")).toBe("format");
    expect(await add("")).toBe("empty");
  });

  it("(b) refuses a sixth non-released custom domain", async () => {
    const c = await fresh();
    for (let i = 0; i < 5; i++)
      await addCustomDomain({
        companyId: c.companyId,
        raw: host(),
        createdById: c.userId,
      });
    expect(
      await code(
        addCustomDomain({
          companyId: c.companyId,
          raw: host(),
          createdById: c.userId,
        }),
      ),
    ).toBe("limit");
  });

  it("(c) a PENDING claim never blocks, a verified one always does, and tokens do not cross companies", async () => {
    const a = await fresh();
    const b = await fresh();
    const h = host();
    const ra = await addCustomDomain({
      companyId: a.companyId,
      raw: h,
      createdById: a.userId,
    });
    const rb = await addCustomDomain({
      companyId: b.companyId,
      raw: h,
      createdById: b.userId,
    });
    expect(rb.status).toBe("PENDING");
    expect(rb.verificationToken).not.toBe(ra.verificationToken);

    expect(
      await verifyCustomDomain(
        { companyId: a.companyId, domainId: ra.id },
        fakeDns(ra.verificationToken),
      ),
    ).toMatchObject({ ok: true });

    // A's published token does not prove B's row
    expect(
      await verifyCustomDomain(
        { companyId: b.companyId, domainId: rb.id },
        fakeDns(ra.verificationToken),
      ),
    ).toEqual({ ok: false, owned: false, routed: true });
    expect((await row(rb.id)).status).toBe("PENDING");

    // even with B's own token published, A owns the hostname now
    expect(
      await code(
        verifyCustomDomain(
          { companyId: b.companyId, domainId: rb.id },
          fakeDns(rb.verificationToken),
        ),
      ),
    ).toBe("taken");
    expect((await row(rb.id)).status).toBe("PENDING");
    expect(await primaryHostname(db, b.companyId)).toBe(b.platformHost);
    expect(await row(ra.id)).toMatchObject({
      companyId: a.companyId,
      status: "ALIAS",
      aliasExpiresAt: null,
    });

    // and a new claim by another company is refused outright
    const c = await fresh();
    expect(
      await code(
        addCustomDomain({
          companyId: c.companyId,
          raw: h,
          createdById: c.userId,
        }),
      ),
    ).toBe("taken");

    // B cannot verify A's row by id either
    expect(
      await code(
        verifyCustomDomain(
          { companyId: b.companyId, domainId: ra.id },
          fakeDns(ra.verificationToken),
        ),
      ),
    ).toBe("not-found");
  });

  it("(d) verification needs DNS, makes a permanent non-primary alias; Make primary then turns the platform host into a permanent alias", async () => {
    const a = await fresh();
    const h = host();
    const added = await addCustomDomain({
      companyId: a.companyId,
      raw: h,
      createdById: a.userId,
    });
    expect(
      await verifyCustomDomain(
        { companyId: a.companyId, domainId: added.id },
        fakeDns(null),
      ),
    ).toEqual({ ok: false, owned: false, routed: false });
    expect((await row(added.id)).status).toBe("PENDING");

    // verify: ALIAS, permanent, not primary; it redirects to the current primary
    // and can get its certificate on the first visit
    const res = await verifyCustomDomain(
      { companyId: a.companyId, domainId: added.id },
      fakeDns(added.verificationToken),
    );
    expect(res).toMatchObject({
      ok: true,
      row: { hostname: h, status: "ALIAS", isPrimary: false },
    });
    const verified = await row(added.id);
    expect(verified).toMatchObject({
      status: "ALIAS",
      isPrimary: false,
      aliasExpiresAt: null,
    });
    expect(verified.verifiedAt).toBeInstanceOf(Date);
    const platform = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM" },
    });
    expect(platform).toMatchObject({ status: "ACTIVE", isPrimary: true });
    expect(await primaryHostname(db, a.companyId)).toBe(a.platformHost);
    expect(await resolveHostname(h)).toMatchObject({
      companyId: a.companyId,
      status: "ALIAS",
      primaryHostname: a.platformHost,
    });
    expect(await liveCustomHostnames()).toContain(h);

    // Make primary
    await setPrimaryDomain({ companyId: a.companyId, domainId: added.id });
    expect(await row(added.id)).toMatchObject({
      status: "ACTIVE",
      isPrimary: true,
      aliasExpiresAt: null,
    });
    expect(await row(platform.id)).toMatchObject({
      status: "ALIAS",
      isPrimary: false,
      aliasExpiresAt: null,
    });
    expect(await resolveHostname(h)).toMatchObject({
      status: "ACTIVE",
      primaryHostname: h,
    });
    expect(await resolveHostname(a.platformHost)).toMatchObject({
      companyId: a.companyId,
      status: "ALIAS",
      primaryHostname: h,
    });

    // permanent: still an alias years later, and the lazy release leaves it alone
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 1000 * 864e5);
    clearResolveCache();
    expect(await isLabelAvailable(db, a.label)).toBe(false);
    expect(await resolveHostname(a.platformHost)).toMatchObject({
      status: "ALIAS",
      primaryHostname: h,
    });
    expect((await row(platform.id)).status).toBe("ALIAS");
  });

  it("(e) a PENDING hostname does not resolve", async () => {
    const a = await fresh();
    const h = host();
    await addCustomDomain({
      companyId: a.companyId,
      raw: h,
      createdById: a.userId,
    });
    expect(await resolveHostname(h)).toBeNull();
  });

  it("(f) primaryHostname reports the custom host", async () => {
    const a = await fresh();
    const added = await addAndVerify(a);
    expect(await primaryHostname(db, a.companyId)).toBe(added.hostname);
  });

  it("(g) setPrimaryDomain switches back to the platform host and refuses PENDING or foreign rows", async () => {
    const a = await fresh();
    const b = await fresh();
    const added = await addAndVerify(a);
    const platform = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM" },
    });
    await setPrimaryDomain({ companyId: a.companyId, domainId: platform.id });
    expect(await row(platform.id)).toMatchObject({
      status: "ACTIVE",
      isPrimary: true,
      aliasExpiresAt: null,
    });
    // back on the platform address: the custom host is an expiring alias, not a permanent one
    const demoted = await row(added.id);
    expect(demoted).toMatchObject({ status: "ALIAS", isPrimary: false });
    expectAboutThirtyDays(demoted.aliasExpiresAt);
    expect(await resolveHostname(added.hostname)).toMatchObject({
      status: "ALIAS",
      primaryHostname: a.platformHost,
    });

    const pending = await addCustomDomain({
      companyId: a.companyId,
      raw: host(),
      createdById: a.userId,
    });
    expect(
      await code(
        setPrimaryDomain({ companyId: a.companyId, domainId: pending.id }),
      ),
    ).toBe("not-found");
    expect(
      await code(
        setPrimaryDomain({ companyId: b.companyId, domainId: added.id }),
      ),
    ).toBe("not-found");
    expect(await primaryHostname(db, a.companyId)).toBe(a.platformHost);
    expect(await primaryHostname(db, b.companyId)).toBe(b.platformHost);
  });

  it("(h) removing the primary custom domain promotes the platform host and frees the hostname", async () => {
    const a = await fresh();
    const b = await fresh();
    const added = await addAndVerify(a);
    const pending = await addCustomDomain({
      companyId: a.companyId,
      raw: host(),
      createdById: a.userId,
    });

    // removing a PENDING row leaves the primary untouched
    await removeCustomDomain({ companyId: a.companyId, domainId: pending.id });
    expect((await row(pending.id)).status).toBe("RELEASED");
    expect(await primaryHostname(db, a.companyId)).toBe(added.hostname);

    // another company cannot remove it
    expect(
      await code(
        removeCustomDomain({ companyId: b.companyId, domainId: added.id }),
      ),
    ).toBe("not-found");

    await removeCustomDomain({ companyId: a.companyId, domainId: added.id });
    const removed = await row(added.id);
    expect(removed).toMatchObject({ status: "RELEASED", isPrimary: false });
    expect(removed.releasedAt).toBeInstanceOf(Date);
    expect(await primaryHostname(db, a.companyId)).toBe(a.platformHost);
    expect(
      await db.companyDomain.findFirstOrThrow({
        where: { companyId: a.companyId, kind: "PLATFORM" },
      }),
    ).toMatchObject({ status: "ACTIVE", isPrimary: true });
    expect(await resolveHostname(added.hostname)).toBeNull();
    expect(await resolveHostname(a.platformHost)).toMatchObject({
      status: "ACTIVE",
    });

    // the platform row can never be removed through this path
    const platform = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM" },
    });
    expect(
      await code(
        removeCustomDomain({ companyId: a.companyId, domainId: platform.id }),
      ),
    ).toBe("not-found");

    const taken = await addAndVerify(b, added.hostname);
    expect(await primaryHostname(db, b.companyId)).toBe(taken.hostname);
  });

  it("(i) renaming the platform address while a custom domain is primary is refused", async () => {
    const a = await fresh();
    const added = await addAndVerify(a);
    await expect(
      db.$transaction((tx) =>
        renamePlatformSubdomain(tx, {
          companyId: a.companyId,
          label: `cd-${rand()}`,
          createdById: a.userId,
        }),
      ),
    ).rejects.toBeInstanceOf(PlatformRenameBlockedError);
    expect(await primaryHostname(db, a.companyId)).toBe(added.hostname);
    expect(
      await db.companyDomain.count({
        where: { companyId: a.companyId, isPrimary: true },
      }),
    ).toBe(1);
  });

  it("(j) liveCustomHostnames lists ACTIVE and ALIAS custom hosts only", async () => {
    const a = await fresh();
    const active = await addAndVerify(a);
    const alias = await addAndVerify(a); // demotes `active` to a permanent alias
    const pending = await addCustomDomain({
      companyId: a.companyId,
      raw: host(),
      createdById: a.userId,
    });
    const released = await addAndVerify(a);
    await removeCustomDomain({ companyId: a.companyId, domainId: released.id });

    const live = await liveCustomHostnames();
    expect(live).toContain(active.hostname);
    expect(live).toContain(alias.hostname);
    expect(live).not.toContain(pending.hostname);
    expect(live).not.toContain(released.hostname);
    expect(live).not.toContain(a.platformHost);
  });

  it("(k) every mutation clears the resolve cache", async () => {
    const a = await fresh();
    const added = await addCustomDomain({
      companyId: a.companyId,
      raw: host(),
      createdById: a.userId,
    });
    expect(await resolveHostname(added.hostname)).toBeNull(); // cached miss
    expect(await resolveHostname(a.platformHost)).toMatchObject({
      status: "ACTIVE",
    }); // cached hit
    await verifyCustomDomain(
      { companyId: a.companyId, domainId: added.id },
      fakeDns(added.verificationToken),
    );
    expect(await resolveHostname(added.hostname)).toMatchObject({
      status: "ALIAS",
    });
    expect(await resolveHostname(added.hostname)).toMatchObject({
      status: "ALIAS",
    }); // now a cached hit
    await setPrimaryDomain({ companyId: a.companyId, domainId: added.id });
    expect(await resolveHostname(added.hostname)).toMatchObject({
      status: "ACTIVE",
    });
    expect(await resolveHostname(a.platformHost)).toMatchObject({
      status: "ALIAS",
    }); // cached hit with the custom primary

    const platform = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM" },
    });
    await setPrimaryDomain({ companyId: a.companyId, domainId: platform.id });
    expect(await resolveHostname(a.platformHost)).toMatchObject({
      status: "ACTIVE",
    });

    await removeCustomDomain({ companyId: a.companyId, domainId: added.id });
    expect(await resolveHostname(added.hostname)).toBeNull();
  });

  it("(l) setPrimary cannot hold old platform labels: only the current platform row can be promoted", async () => {
    const a = await fresh();
    const y = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM", isPrimary: true },
    });
    const xLabel = `cd-${rand()}`;
    await db.$transaction((tx) =>
      renamePlatformSubdomain(tx, {
        companyId: a.companyId,
        label: xLabel,
        createdById: a.userId,
      }),
    );
    // Y is now an expiring rename alias; promoting it would re-hold it (and X) forever
    expect(
      await code(setPrimaryDomain({ companyId: a.companyId, domainId: y.id })),
    ).toBe("not-found");
    const yAfter = await row(y.id);
    expect(yAfter).toMatchObject({ status: "ALIAS", isPrimary: false });
    expectAboutThirtyDays(yAfter.aliasExpiresAt);
    const x = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, isPrimary: true },
    });
    expect(x).toMatchObject({
      hostname: `${xLabel}.dealroom.tin.info`,
      status: "ACTIVE",
      aliasExpiresAt: null,
    });

    // via a custom primary: X becomes the permanent alias, Y stays expiring,
    // and switching back to X leaves the custom host expiring, not permanent
    const added = await addAndVerify(a);
    expect(await row(x.id)).toMatchObject({
      status: "ALIAS",
      aliasExpiresAt: null,
    });
    expectAboutThirtyDays((await row(y.id)).aliasExpiresAt);
    expect(
      await code(setPrimaryDomain({ companyId: a.companyId, domainId: y.id })),
    ).toBe("not-found");
    await setPrimaryDomain({ companyId: a.companyId, domainId: x.id });
    expect(await row(x.id)).toMatchObject({
      status: "ACTIVE",
      isPrimary: true,
      aliasExpiresAt: null,
    });
    expectAboutThirtyDays((await row(added.id)).aliasExpiresAt);
    expectAboutThirtyDays((await row(y.id)).aliasExpiresAt);
  });

  it("(m) removing the only live address is refused and leaves the row unchanged", async () => {
    const t = await seedTenant(`cd-${rand()}`);
    tenants.push(t);
    const added = await addAndVerify(t); // no platform row: the custom host is the only address
    expect(
      await code(
        removeCustomDomain({ companyId: t.companyId, domainId: added.id }),
      ),
    ).toBe("last-address");
    expect(await row(added.id)).toMatchObject({
      status: "ACTIVE",
      isPrimary: true,
      releasedAt: null,
    });
    expect(await primaryHostname(db, t.companyId)).toBe(added.hostname);
  });
});

describe("expiring custom aliases", () => {
  it("(n) once a demoted custom host expires it stops resolving and another company can claim it", async () => {
    const a = await fresh();
    const b = await fresh();
    const added = await addAndVerify(a);
    const platform = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM" },
    });
    await setPrimaryDomain({ companyId: a.companyId, domainId: platform.id });
    expect(await liveCustomHostnames()).toContain(added.hostname);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 864e5);
    clearResolveCache();
    expect(await resolveHostname(added.hostname)).toBeNull();
    expect(await liveCustomHostnames()).not.toContain(added.hostname);
    await addAndVerify(b, added.hostname);
    expect((await row(added.id)).status).toBe("RELEASED");
    expect(await primaryHostname(db, b.companyId)).toBe(added.hostname);
  });
});

describe("listing and several custom domains", () => {
  it("(o) listDomains leaves out an expired alias", async () => {
    const a = await fresh();
    const added = await addAndVerify(a);
    const platform = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM" },
    });
    await setPrimaryDomain({ companyId: a.companyId, domainId: platform.id });
    expect((await listDomains(a.companyId)).map((r) => r.id)).toContain(
      added.id,
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 864e5);
    const ids = (await listDomains(a.companyId)).map((r) => r.id);
    expect(ids).not.toContain(added.id);
    expect(ids).toContain(platform.id);
  });

  it("(p) two custom domains: verify both, make B primary, then the platform address", async () => {
    const a = await fresh();
    const da = await addAndVerify(a, host(), { primary: false });
    const db_ = await addAndVerify(a, host(), { primary: false });
    const platform = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM" },
    });
    // verified, not primary: both permanent aliases of the platform address
    for (const d of [da, db_])
      expect(await row(d.id)).toMatchObject({
        status: "ALIAS",
        isPrimary: false,
        aliasExpiresAt: null,
      });

    await setPrimaryDomain({ companyId: a.companyId, domainId: db_.id });
    expect(await row(db_.id)).toMatchObject({
      status: "ACTIVE",
      isPrimary: true,
    });
    expect(await row(platform.id)).toMatchObject({
      status: "ALIAS",
      aliasExpiresAt: null,
    });
    expect(await row(da.id)).toMatchObject({
      status: "ALIAS",
      aliasExpiresAt: null,
    });

    await setPrimaryDomain({ companyId: a.companyId, domainId: platform.id });
    expect(await row(platform.id)).toMatchObject({
      status: "ACTIVE",
      isPrimary: true,
      aliasExpiresAt: null,
    });
    // the demoted primary expires (back on a platform address)
    const b = await row(db_.id);
    expect(b).toMatchObject({ status: "ALIAS", isPrimary: false });
    expectAboutThirtyDays(b.aliasExpiresAt);
    // Task 1 ruling: only the row demoted by a change of primary gets an
    // expiry; A was never primary, so it stays a permanent, DNS-proven alias
    expect(await row(da.id)).toMatchObject({
      status: "ALIAS",
      isPrimary: false,
      aliasExpiresAt: null,
    });
  });
});

function expectAboutThirtyDays(d: Date | null) {
  expect(d).toBeInstanceOf(Date);
  const days = ((d as Date).getTime() - Date.now()) / 864e5;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThanOrEqual(30);
}

describe("R2 CORS sync side effects", () => {
  beforeEach(() => {
    cors.sync.mockClear();
  });

  it("a sync that throws or fails leaves verify and remove succeeding with corsSynced false", async () => {
    const a = await fresh();
    const added = await addCustomDomain({
      companyId: a.companyId,
      raw: host(),
      createdById: a.userId,
    });
    cors.sync.mockRejectedValueOnce(new Error("boom"));
    const res = await verifyCustomDomain(
      { companyId: a.companyId, domainId: added.id },
      fakeDns(added.verificationToken),
    );
    expect(res).toMatchObject({ ok: true, corsSynced: false });
    expect((await row(added.id)).status).toBe("ALIAS");

    cors.sync.mockResolvedValueOnce({ skipped: false, ok: false });
    expect(
      await removeCustomDomain({ companyId: a.companyId, domainId: added.id }),
    ).toEqual({ corsSynced: false });
    expect((await row(added.id)).status).toBe("RELEASED");
  });

  it("no sync when verification or the transaction fails", async () => {
    const a = await fresh();
    const b = await fresh();
    const h = host();
    const added = await addCustomDomain({
      companyId: a.companyId,
      raw: h,
      createdById: a.userId,
    });
    // DNS missing
    expect(
      await verifyCustomDomain(
        { companyId: a.companyId, domainId: added.id },
        fakeDns(null),
      ),
    ).toMatchObject({ ok: false });
    // another company already owns the hostname: the transaction fails
    const mine = await addCustomDomain({
      companyId: b.companyId,
      raw: h,
      createdById: b.userId,
    });
    await verifyCustomDomain(
      { companyId: b.companyId, domainId: mine.id },
      fakeDns(mine.verificationToken),
    );
    cors.sync.mockClear();
    expect(
      await code(
        verifyCustomDomain(
          { companyId: a.companyId, domainId: added.id },
          fakeDns(added.verificationToken),
        ),
      ),
    ).not.toBe("resolved");
    // removing a foreign / missing row
    expect(
      await code(
        removeCustomDomain({ companyId: a.companyId, domainId: mine.id }),
      ),
    ).toBe("not-found");
    expect(cors.sync).not.toHaveBeenCalled();
  });
});
