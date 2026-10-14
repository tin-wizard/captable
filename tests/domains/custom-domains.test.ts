import { db } from "@/server/db";
import {
  CustomDomainError,
  addCustomDomain,
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

async function addAndVerify(t: Tenant, hostname = host()) {
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
      status: "ACTIVE",
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

  it("(d) verification needs DNS, then makes the custom host primary and the platform host a permanent alias", async () => {
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

    const res = await verifyCustomDomain(
      { companyId: a.companyId, domainId: added.id },
      fakeDns(added.verificationToken),
    );
    expect(res).toMatchObject({
      ok: true,
      row: { hostname: h, status: "ACTIVE", isPrimary: true },
    });
    const custom = await row(added.id);
    expect(custom).toMatchObject({ status: "ACTIVE", isPrimary: true });
    expect(custom.verifiedAt).toBeInstanceOf(Date);
    const platform = await db.companyDomain.findFirstOrThrow({
      where: { companyId: a.companyId, kind: "PLATFORM" },
    });
    expect(platform).toMatchObject({
      status: "ALIAS",
      isPrimary: false,
      aliasExpiresAt: null,
    });

    expect(await resolveHostname(h)).toMatchObject({
      companyId: a.companyId,
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
    expect(await row(added.id)).toMatchObject({
      status: "ALIAS",
      isPrimary: false,
      aliasExpiresAt: null,
    });
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
    await verifyCustomDomain(
      { companyId: a.companyId, domainId: added.id },
      fakeDns(added.verificationToken),
    );
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
});
