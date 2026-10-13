import { getCompanyList } from "@/server/company";
import { chooserDecision } from "@/server/company-chooser";
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTenant } from "../helpers/seed";

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

  it("each entry links to its company home", async () => {
    for (const m of await getCompanyList(a.userId)) {
      expect(m.url).toContain(m.company.publicId);
    }
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
