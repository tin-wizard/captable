import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Tenant,
  callerFor,
  cleanupTenants,
  seedTenant,
} from "../helpers/seed";

/**
 * overview.summary: real holdings from ACTIVE securities only, each block
 * behind its own permission, and nothing from another company.
 */

let a: Tenant;
let b: Tenant;
let empty: Tenant;
const extraUsers: string[] = [];
let classA: string;
let classB: string;
let alice: string;
let bob: string;
let planId: string;

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error("expected a value");
  return v;
}

const shareClass = (t: Tenant, name: string, idx: number, authorized: bigint) =>
  db.shareClass
    .create({
      data: {
        companyId: t.companyId,
        idx,
        name,
        classType: "COMMON",
        prefix: "CS",
        initialSharesAuthorized: authorized,
        boardApprovalDate: new Date(),
        stockholderApprovalDate: new Date(),
        votesPerShare: 1,
        parValue: 0.01,
        pricePerShare: 1,
        seniority: 1,
        liquidationPreferenceMultiple: 1,
        participationCapMultiple: 1,
      },
    })
    .then((c) => c.id);

const stakeholder = (t: Tenant, name: string) =>
  db.stakeholder
    .create({
      data: { companyId: t.companyId, name, email: `${nanoid(6)}@example.com` },
    })
    .then((s) => s.id);

const share = (
  t: Tenant,
  shareClassId: string,
  stakeholderId: string,
  quantity: number,
  status: "ACTIVE" | "DRAFT",
  extra: { capitalContribution?: number; pricePerShare?: number } = {},
) =>
  db.share.create({
    data: {
      companyId: t.companyId,
      shareClassId,
      stakeholderId,
      certificateId: nanoid(6),
      quantity,
      status,
      issueDate: new Date(),
      boardApprovalDate: new Date(),
      ...extra,
    },
  });

async function memberWith(permissions: object[] | null) {
  const user = await db.user.create({
    data: {
      name: "overview member",
      email: `ov-${nanoid(8)}@example.com`,
      emailVerified: new Date(),
    },
  });
  extraUsers.push(user.id);
  const role = permissions
    ? await db.customRole.create({
        data: { companyId: a.companyId, name: nanoid(6), permissions },
      })
    : null;
  const member = await db.member.create({
    data: {
      userId: user.id,
      companyId: a.companyId,
      role: role ? "CUSTOM" : null,
      customRoleId: role?.id,
      status: "ACTIVE",
      isOnboarded: true,
    },
  });
  return callerFor({
    ...a,
    memberId: member.id,
    userId: user.id,
    session: {
      ...a.session,
      user: {
        ...a.session.user,
        id: user.id,
        email: user.email,
        memberId: member.id,
      },
    },
  });
}

beforeAll(async () => {
  a = await seedTenant("ov-a");
  b = await seedTenant("ov-b");
  empty = await seedTenant("ov-empty");

  classA = await shareClass(a, "Common", 1, 10_000_000n);
  classB = await shareClass(a, "Series A", 2, 2_000_000n);
  alice = await stakeholder(a, "Alice");
  bob = await stakeholder(a, "Bob");

  // ACTIVE: alice 600 common (value by price: 600 * 2 = 1200), bob 300 common
  // (explicit contribution 450), alice 100 Series A (no price: 0 value)
  await share(a, classA, alice, 600, "ACTIVE", { pricePerShare: 2 });
  await share(a, classA, bob, 300, "ACTIVE", { capitalContribution: 450 });
  await share(a, classB, alice, 100, "ACTIVE");
  await share(a, classA, bob, 5_000, "DRAFT"); // ignored

  const plan = await db.equityPlan.create({
    data: {
      companyId: a.companyId,
      name: "Plan",
      boardApprovalDate: new Date(),
      initialSharesReserved: 500n,
      defaultCancellatonBehavior: "RETIRE",
      shareClassId: classA,
    },
  });
  planId = plan.id;
  const option = (quantity: number, status: "ACTIVE" | "EXPIRED") =>
    db.option.create({
      data: {
        companyId: a.companyId,
        equityPlanId: planId,
        stakeholderId: bob,
        grantId: nanoid(6),
        quantity,
        exercisePrice: 1,
        type: "ISO",
        status,
        issueDate: new Date(),
        expirationDate: new Date(),
        vestingStartDate: new Date(),
        boardApprovalDate: new Date(),
        rule144Date: new Date(),
      },
    });
  await option(120, "ACTIVE");
  await option(999, "EXPIRED"); // ignored

  await db.investment.createMany({
    data: [
      {
        companyId: a.companyId,
        shareClassId: classA,
        stakeholderId: alice,
        amount: 1000,
        shares: 100n,
        date: new Date(),
      },
      {
        companyId: a.companyId,
        shareClassId: classA,
        stakeholderId: bob,
        amount: 250,
        shares: 50n,
        date: new Date(),
      },
    ],
  });
  await db.safe.create({
    data: {
      companyId: a.companyId,
      stakeholderId: alice,
      publicId: "SAFE-01",
      status: "ACTIVE",
      capital: 5000,
      issueDate: new Date(),
      boardApprovalDate: new Date(),
    },
  });

  // tenant B has its own, larger numbers that must never show up for A
  const bClass = await shareClass(b, "B Common", 1, 1n);
  const bHolder = await stakeholder(b, "Bea");
  await share(b, bClass, bHolder, 777_777, "ACTIVE", {
    capitalContribution: 9_999,
  });
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await cleanupTenants(a, b, empty);
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
});

describe("overview.summary", () => {
  it("computes holdings from ACTIVE securities only", async () => {
    const { holdings } = await callerFor(a).overview.summary();
    expect(holdings).not.toBeNull();
    const h = must(holdings);
    expect(h.issuedShares).toBe(1000);
    expect(h.optionsOutstanding).toBe(120);
    expect(h.planReserveUnallocated).toBe(380); // 500 reserved - 120 granted
    expect(h.fullyDiluted).toBe(1500);
    expect(h.issuedValue).toBe(1200 + 450);
    expect(h.investmentsRecorded).toBe(1250);
    expect(h.convertibleCapital).toBe(5000);
  });

  it("breaks ownership down by class and by stakeholder", async () => {
    const { holdings: h } = await callerFor(a).overview.summary();
    const hh = must(h);
    const common = must(hh.byClass.find((c) => c.name === "Common"));
    expect(common).toMatchObject({ shares: 900, authorized: 10_000_000 });
    expect(common.pct).toBeCloseTo(0.9);
    expect(hh.byClass.find((c) => c.name === "Series A")?.shares).toBe(100);
    const names = hh.byStakeholder.map((s) => s.name);
    expect(names.slice(0, 2).sort()).toEqual(["Alice", "Bob"]);
    expect(hh.byStakeholder.reduce((n, s) => n + s.shares, 0)).toBe(1000);
  });

  it("never mixes in another company's numbers", async () => {
    const { holdings: h } = await callerFor(a).overview.summary();
    expect(JSON.stringify(h)).not.toContain("Bea");
    expect(must(h).issuedShares).not.toBeGreaterThan(1000);
  });

  it("returns zeros, not NaN, for a company with nothing", async () => {
    const res = await callerFor(empty).overview.summary();
    expect(res.holdings).toMatchObject({
      issuedShares: 0,
      fullyDiluted: 0,
      issuedValue: 0,
      byClass: [],
      byStakeholder: [],
    });
    expect(res.engagement?.views7d).toBe(0);
    expect(res.engagement?.series).toHaveLength(7);
  });

  it("gives audits-only roles no holdings, and securities-only roles no engagement", async () => {
    const auditor = await memberWith([
      { subject: "audits", actions: ["read"] },
    ]);
    const a1 = await auditor.overview.summary();
    expect(a1.holdings).toBeNull();
    expect(a1.engagement).not.toBeNull();

    const holder = await memberWith([
      { subject: "securities", actions: ["read"] },
    ]);
    const a2 = await holder.overview.summary();
    expect(a2.holdings).not.toBeNull();
    expect(a2.engagement).toBeNull();
    expect(a2.esign).toBeNull();
  });
});
