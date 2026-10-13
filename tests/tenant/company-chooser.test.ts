import { getCompanyList } from "@/server/company";
import { chooserDecision, enterCompany } from "@/server/company-chooser";
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, cleanupTenants, seedTenant } from "../helpers/seed";

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

// The chooser lists getCompanyList: only ACTIVE, onboarded memberships of this user.
let a: Tenant;
let b: Tenant;
let c: Tenant;
let other: Tenant;

beforeAll(async () => {
  a = await seedTenant("chooser-a");
  b = await seedTenant("chooser-b");
  c = await seedTenant("chooser-c");
  other = await seedTenant("chooser-other");
  await db.companyDomain.create({
    data: {
      companyId: a.companyId,
      hostname: `chooser-a-${a.companyId}.dealroom.tin.info`,
      kind: "PLATFORM",
      status: "ACTIVE",
      isPrimary: true,
    },
  });
  // a's user: ACTIVE+onboarded in b too; INVITED in c; ACTIVE but not onboarded in other
  await db.member.create({
    data: {
      userId: a.userId,
      companyId: b.companyId,
      status: "ACTIVE",
      isOnboarded: true,
    },
  });
  await db.member.create({
    data: {
      userId: a.userId,
      companyId: c.companyId,
      status: "PENDING",
      isOnboarded: false,
    },
  });
  await db.member.create({
    data: {
      userId: a.userId,
      companyId: other.companyId,
      status: "ACTIVE",
      isOnboarded: false,
    },
  });
});

afterAll(async () => {
  await cleanupTenants(a, b, c, other);
});

describe("getCompanyList for the chooser", () => {
  it("lists both ACTIVE onboarded memberships, nothing else", async () => {
    const ids = (await getCompanyList(a.userId)).map((m) => m.company.id);
    expect(ids.sort()).toEqual([a.companyId, b.companyId].sort());
  });

  it("another user's companies never appear", async () => {
    const ids = (await getCompanyList(c.userId)).map((m) => m.company.id);
    expect(ids).toEqual([c.companyId]);
  });

  it("links enter through the handoff when the company has a host, else relative", async () => {
    const list = await getCompanyList(a.userId);
    const byId = (id: string) => list.find((m) => m.company.id === id);
    const withHost = byId(a.companyId);
    expect(withHost?.url).toBe(
      `https://chooser-a-${a.companyId}.dealroom.tin.info/auth/handoff/start?next=%2F${withHost?.company.publicId}`,
    );
    const noHost = byId(b.companyId);
    expect(noHost?.url).toBe(`/${noHost?.company.publicId}`);
  });
});

describe("chooserDecision", () => {
  it("none, single, many", () => {
    expect(chooserDecision([])).toEqual({ kind: "none" });
    expect(chooserDecision([{ url: "/x" }])).toEqual({
      kind: "single",
      url: "/x",
    });
    expect(chooserDecision([{ url: "/x" }, { url: "/y" }])).toEqual({
      kind: "many",
    });
  });
});

describe("enterCompany (chooser click)", () => {
  const run = async (url: string) => {
    const calls: string[] = [];
    await enterCompany(
      { url, memberId: "m1" },
      {
        switchCompany: async (id) => calls.push(`switch:${id}`),
        refreshSession: async () => calls.push("refresh"),
        assign: (u) => calls.push(`go:${u}`),
      },
    );
    return calls;
  };

  it("no company host (relative url): switch, refresh session, then navigate", async () => {
    expect(await run("/pubB")).toEqual(["switch:m1", "refresh", "go:/pubB"]);
  });

  it("host-bound (handoff url): navigate only", async () => {
    const url = "https://b.dealroom.tin.info/auth/handoff/start?next=%2FpubB";
    expect(await run(url)).toEqual([`go:${url}`]);
  });

  it("a refused switch does not navigate", async () => {
    const assign = vi.fn();
    await expect(
      enterCompany(
        { url: "/pubB", memberId: "m1" },
        {
          switchCompany: () => Promise.reject(new Error("FORBIDDEN")),
          refreshSession: async () => undefined,
          assign,
        },
      ),
    ).rejects.toThrow("FORBIDDEN");
    expect(assign).not.toHaveBeenCalled();
  });
});
