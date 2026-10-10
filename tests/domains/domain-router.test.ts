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
  seedTwoTenants,
} from "../helpers/seed";

vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: true,
    canonicalHost: "dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
    port: "",
  }),
  tenantOrigin: (h: string) => `https://${h}`,
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
