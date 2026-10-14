import { db } from "@/server/db";
import {
  assignPlatformSubdomain,
  clearResolveCache,
} from "@/server/domains/registry";
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
import {
  type Tenant,
  callerFor,
  cleanupTenants,
  seedTenant,
  seedTwoTenants,
} from "../helpers/seed";

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
// DNS for custom-domain verification: the challenge TXT and a CNAME to us
const dns = vi.hoisted(() => ({
  txt: [] as string[][],
  cname: [] as string[],
}));
vi.mock("@/server/domains/dns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/domains/dns")>()),
  realDnsDeps: {
    resolveTxt: async () => dns.txt,
    resolveCname: async () => dns.cname,
    resolve4: async () => [],
  },
}));

let a: Tenant;
let b: Tenant;
let memberUser: { id: string };
let plain: Tenant;
const run = nanoid(6)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x");
const labels = {
  a: `ra-${run}`,
  b: `rb-${run}`,
  newA: `rn-${run}`,
};

const tenantCaller = (t: Tenant, label: string, publicId: string) =>
  appRouter.createCaller({
    db,
    session: t.session,
    requestIp: "127.0.0.1",
    userAgent: "vitest",
    headers: new Headers(),
    host: {
      kind: "tenant",
      hostname: `${label}.dealroom.tin.info`,
      companyId: t.companyId,
      publicId,
    },
  } as never);

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  await assignPlatformSubdomain(db, {
    companyId: a.companyId,
    label: labels.a,
    createdById: a.userId,
  });
  await assignPlatformSubdomain(db, {
    companyId: b.companyId,
    label: labels.b,
    createdById: b.userId,
  });
  // a second, non-admin member of company A
  const u = await db.user.create({
    data: {
      name: "plain",
      email: `plain-${run}@example.com`,
      emailVerified: new Date(),
    },
  });
  memberUser = u;
  const role = await db.customRole.create({
    data: {
      companyId: a.companyId,
      name: "reader",
      permissions: [{ subject: "stakeholder", actions: ["read"] }],
    },
  });
  const m = await db.member.create({
    data: {
      userId: u.id,
      companyId: a.companyId,
      role: "CUSTOM",
      customRoleId: role.id,
      status: "ACTIVE",
      isOnboarded: true,
    },
  });
  plain = {
    ...a,
    userId: u.id,
    memberId: m.id,
    session: {
      ...a.session,
      user: {
        ...a.session.user,
        id: u.id,
        memberId: m.id,
        name: u.name,
        email: u.email,
      },
    },
  };
});
afterAll(async () => {
  await db.audit.deleteMany({ where: { companyId: a.companyId } });
  await db.member.deleteMany({ where: { userId: memberUser.id } });
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await cleanupTenants(a, b);
  await db.user.deleteMany({ where: { id: memberUser.id } });
  clearResolveCache();
});
beforeEach(() => clearResolveCache());

describe("domain router", () => {
  it("suggests a free label for a name", async () => {
    const r = await callerFor(a).domain.suggest({ name: `Botski ${run}` });
    expect(r).toMatchObject({ baseDomain: "dealroom.tin.info", enabled: true });
    expect(r.label).toMatch(/^botski/);
  });

  it("checkAvailability: reserved, format, taken", async () => {
    const c = callerFor(a);
    expect(await c.domain.checkAvailability({ label: "admin" })).toMatchObject({
      available: false,
      reason: "reserved",
    });
    expect(await c.domain.checkAvailability({ label: "Bad" })).toMatchObject({
      available: false,
      reason: "format",
    });
    const taken = await c.domain.checkAvailability({ label: labels.b });
    expect(taken).toMatchObject({ available: false, reason: "taken" });
    expect(taken.suggestion).toBeTruthy();
    expect(
      await c.domain.checkAvailability({ label: `free-${run}` }),
    ).toMatchObject({ available: true, reason: null });
  });

  it("is canonical-only for checkAvailability, tenant-only for checkRename", async () => {
    await expect(
      tenantCaller(a, labels.a, "p").domain.checkAvailability({
        label: "zzz-free",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await tenantCaller(a, labels.a, "p").domain.checkRename({
        label: labels.b,
      }),
    ).toMatchObject({ reason: "taken" });
  });

  it("current reports hostname and aliases", async () => {
    const r = await tenantCaller(a, labels.a, "p").domain.current();
    expect(r.hostname).toBe(`${labels.a}.dealroom.tin.info`);
    expect(r.enabled).toBe(true);
    expect(r.primaryKind).toBe("PLATFORM");
  });

  it("rename by a non-admin member is UNAUTHORIZED", async () => {
    await expect(
      tenantCaller(plain, labels.a, "p").domain.rename({ label: labels.newA }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rename to another company's live label is CONFLICT with a suggestion", async () => {
    const err = await tenantCaller(a, labels.a, "p")
      .domain.rename({ label: labels.b })
      .catch((e) => e);
    expect(err.code).toBe("CONFLICT");
    expect(JSON.parse(err.message)).toHaveProperty("suggestion");
    expect(
      await db.companyDomain.count({
        where: {
          companyId: a.companyId,
          isPrimary: true,
          hostname: `${labels.a}.dealroom.tin.info`,
        },
      }),
    ).toBe(1);
  });

  it("rename by an admin returns the new url, leaves an alias, audits; rename-back works", async () => {
    const co = await db.company.findUniqueOrThrow({
      where: { id: a.companyId },
    });
    const c = tenantCaller(a, labels.a, co.publicId);
    const r = await c.domain.rename({ label: labels.newA });
    expect(r.url).toBe(
      `https://${labels.newA}.dealroom.tin.info/${co.publicId}`,
    );
    const cur = await c.domain.current();
    expect(cur.hostname).toBe(`${labels.newA}.dealroom.tin.info`);
    expect(cur.aliases.map((x) => x.hostname)).toEqual([
      `${labels.a}.dealroom.tin.info`,
    ]);
    expect(
      await db.audit.count({
        where: { companyId: a.companyId, action: "company.subdomain-renamed" },
      }),
    ).toBe(1);
    // own live alias counts as available for rename, not for creation
    expect(await c.domain.checkRename({ label: labels.a })).toMatchObject({
      available: true,
    });
    expect(
      await callerFor(a).domain.checkAvailability({ label: labels.a }),
    ).toMatchObject({ available: false });
    await c.domain.rename({ label: labels.a });
    expect((await c.domain.current()).hostname).toBe(
      `${labels.a}.dealroom.tin.info`,
    );
  });
});

describe("custom domain procedures", () => {
  const custom = `investors-${run}.implexus.io`;
  const err = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { code: string; message: string }) => ({
        code: e.code,
        message: e.message,
      }),
    );
  const ca = () => tenantCaller(a, labels.a, "p");
  const cb = () => tenantCaller(b, labels.b, "p");

  it("refuses a member without company:update on all five", async () => {
    const c = tenantCaller(plain, labels.a, "p").domain.custom;
    const id = { domainId: "x" };
    for (const p of [
      () => c.list(),
      () => c.add({ hostname: custom }),
      () => c.verify(id),
      () => c.setPrimary(id),
      () => c.remove(id),
    ])
      expect((await err(p()))?.code).toBe("UNAUTHORIZED");
  });

  it("flag off: all five are NOT_FOUND", async () => {
    flag.enabled = false;
    try {
      const c = ca().domain.custom;
      const id = { domainId: "x" };
      for (const p of [
        () => c.list(),
        () => c.add({ hostname: custom }),
        () => c.verify(id),
        () => c.setPrimary(id),
        () => c.remove(id),
      ])
        expect((await err(p()))?.code).toBe("NOT_FOUND");
    } finally {
      flag.enabled = true;
    }
  });

  it("maps hostname errors to BAD_REQUEST with the code as message", async () => {
    expect(await err(ca().domain.custom.add({ hostname: "Bad Host" }))).toEqual(
      { code: "BAD_REQUEST", message: "format" },
    );
    expect(
      await err(ca().domain.custom.add({ hostname: "x.dealroom.tin.info" })),
    ).toEqual({ code: "BAD_REQUEST", message: "platform" });
  });

  it("removing the last address is BAD_REQUEST last-address", async () => {
    // a company whose only address is a custom primary (no platform row)
    const t = await seedTenant(`last-${run}`);
    try {
      const hostname = `last-${run}.implexus.io`;
      const row = await db.companyDomain.create({
        data: {
          companyId: t.companyId,
          hostname,
          kind: "CUSTOM",
          status: "ACTIVE",
          isPrimary: true,
        },
      });
      const c = appRouter.createCaller({
        db,
        session: t.session,
        requestIp: "127.0.0.1",
        userAgent: "vitest",
        headers: new Headers(),
        host: {
          kind: "tenant",
          hostname,
          companyId: t.companyId,
          publicId: "p",
        },
      } as never);
      expect(await err(c.domain.custom.remove({ domainId: row.id }))).toEqual({
        code: "BAD_REQUEST",
        message: "last-address",
      });
      expect(
        (await db.companyDomain.findUniqueOrThrow({ where: { id: row.id } }))
          .status,
      ).toBe("ACTIVE");
    } finally {
      await cleanupTenants(t);
    }
  });

  it("admin round trip: add, verify, primary, rename blocked, switch back, remove; audited", async () => {
    const c = ca().domain.custom;
    const row = await c.add({ hostname: custom });
    expect(row).toMatchObject({ hostname: custom, status: "PENDING" });

    dns.txt = [];
    dns.cname = [];
    expect(await c.verify({ domainId: row.id })).toEqual({
      ok: false,
      owned: false,
      routed: false,
    });

    dns.txt = [[row.verificationToken as string]];
    dns.cname = ["dealroom.tin.info"];
    expect(await c.verify({ domainId: row.id })).toEqual({ ok: true });
    const cur = await ca().domain.current();
    expect(cur).toMatchObject({ hostname: custom, primaryKind: "CUSTOM" });

    // renaming the platform address now would make a second primary
    expect(await err(ca().domain.rename({ label: labels.newA }))).toEqual({
      code: "BAD_REQUEST",
      message: "custom-primary",
    });

    // another company: the verified hostname is taken, A's ids do not exist
    expect(await err(cb().domain.custom.add({ hostname: custom }))).toEqual({
      code: "CONFLICT",
      message: "taken",
    });
    for (const p of [
      () => cb().domain.custom.verify({ domainId: row.id }),
      () => cb().domain.custom.setPrimary({ domainId: row.id }),
      () => cb().domain.custom.remove({ domainId: row.id }),
    ])
      expect(await err(p())).toEqual({
        code: "NOT_FOUND",
        message: "not-found",
      });

    const list = await c.list();
    expect(list.dnsTarget).toBe("dealroom.tin.info");
    const platform = list.rows.find((r) => r.kind === "PLATFORM");
    expect(list.rows.map((r) => r.hostname)).toContain(custom);

    await c.setPrimary({ domainId: platform?.id as string });
    expect(await ca().domain.current()).toMatchObject({
      hostname: `${labels.a}.dealroom.tin.info`,
      primaryKind: "PLATFORM",
    });

    await c.remove({ domainId: row.id });
    expect((await c.list()).rows.map((r) => r.hostname)).not.toContain(custom);

    for (const action of [
      "domain.added",
      "domain.verified",
      "domain.primary-changed",
      "domain.removed",
    ]) {
      const audits = await db.audit.findMany({
        where: { companyId: a.companyId, action },
      });
      expect(audits).toHaveLength(1);
    }
    const summaries = await db.audit.findMany({
      where: { companyId: a.companyId, action: { startsWith: "domain." } },
      select: { action: true, summary: true },
    });
    for (const s of summaries)
      expect(s.summary).toContain(
        s.action === "domain.primary-changed"
          ? `${labels.a}.dealroom.tin.info`
          : custom,
      );
  });
});

// Last: mockRestore() leaves Prisma's extended delegates without the spied
// methods, so nothing may touch companyDomain after this.
describe("domain router, flag off", () => {
  it("flag off: no registry access, rename NOT_FOUND, current disabled", async () => {
    flag.enabled = false;
    const spies = (
      ["count", "findMany", "findFirst", "updateMany"] as const
    ).map((m) => vi.spyOn(db.companyDomain, m));
    try {
      const c = tenantCaller(a, labels.a, "p");
      expect(
        await callerFor(a).domain.checkAvailability({ label: labels.b }),
      ).toEqual({
        available: false,
        reason: null,
        suggestion: null,
      });
      expect(await c.domain.checkRename({ label: labels.b })).toMatchObject({
        available: false,
      });
      expect(
        await callerFor(a).domain.suggest({ name: "Botski" }),
      ).toMatchObject({ label: null, enabled: false });
      expect(await c.domain.current()).toEqual({
        enabled: false,
        hostname: null,
        primaryKind: null,
        aliases: [],
      });
      await expect(
        c.domain.rename({ label: labels.newA }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
      flag.enabled = true;
    }
  });
});
