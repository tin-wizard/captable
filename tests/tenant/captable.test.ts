import { modelRound } from "@/server/captable/proforma";
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
 * captable.table and captable.proforma: ACTIVE securities only, company-wide
 * totals and percentages, keyset paging, securities:read, tenant scoping.
 *
 * Fixture (tenant A), ACTIVE only:
 *   Alice  INDIVIDUAL   600 Common + 100 Series A          = 700
 *   Bob    INDIVIDUAL   300 Common, 120 options             = 300
 *   Dan    INDIVIDUAL   200 Common                          = 200
 *   Acme   INSTITUTION  200 Series A                        = 200
 *   Erin   INDIVIDUAL   30 options                          =   0
 *   Carol  (no holdings) post-money SAFE 50,000 cap 1M, 20 % discount
 *   Alice  note 10,000 at 10 % from 2025-10-13, cap 500k, 20 % discount
 * Plan reserve 500 → unallocated 500 − 150 = 350.
 * Issued 1,400; FD 1,400 + 150 + 350 = 1,900; convertible capital 60,000.
 */

const AS_OF = "2026-10-13";
let a: Tenant;
let b: Tenant;
let empty: Tenant;
const extraUsers: string[] = [];
let common: string;
let seriesA: string;
const h = {} as Record<
  "alice" | "bob" | "dan" | "acme" | "erin" | "carol",
  string
>;
let bHolder: string;

const shareClass = (t: Tenant, name: string, idx: number) =>
  db.shareClass
    .create({
      data: {
        companyId: t.companyId,
        idx,
        name,
        classType: "COMMON",
        prefix: "CS",
        initialSharesAuthorized: 10_000_000n,
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

const stakeholder = (
  t: Tenant,
  name: string,
  stakeholderType: "INDIVIDUAL" | "INSTITUTION" = "INDIVIDUAL",
) =>
  db.stakeholder
    .create({
      data: {
        companyId: t.companyId,
        name,
        stakeholderType,
        email: `${name.toLowerCase()}-${nanoid(6)}@example.com`,
      },
    })
    .then((s) => s.id);

const share = (
  t: Tenant,
  shareClassId: string,
  stakeholderId: string,
  quantity: number,
  status: "ACTIVE" | "DRAFT" = "ACTIVE",
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
    },
  });

async function memberWith(permissions: object[]) {
  const user = await db.user.create({
    data: {
      name: "captable member",
      email: `ct-${nanoid(8)}@example.com`,
      emailVerified: new Date(),
    },
  });
  extraUsers.push(user.id);
  const role = await db.customRole.create({
    data: { companyId: a.companyId, name: nanoid(6), permissions },
  });
  const member = await db.member.create({
    data: {
      userId: user.id,
      companyId: a.companyId,
      role: "CUSTOM",
      customRoleId: role.id,
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

const code = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: { code?: string; message?: string }) => `${e.code}: ${e.message}`,
  );

const round = { preMoney: 2_000_000, newMoney: 500_000, poolTargetPct: 0.1 };

beforeAll(async () => {
  a = await seedTenant("ct-a");
  b = await seedTenant("ct-b");
  empty = await seedTenant("ct-empty");

  common = await shareClass(a, "Common", 1);
  seriesA = await shareClass(a, "Series A", 2);
  h.alice = await stakeholder(a, "Alice");
  h.bob = await stakeholder(a, "Bob");
  h.dan = await stakeholder(a, "Dan");
  h.acme = await stakeholder(a, "Acme", "INSTITUTION");
  h.erin = await stakeholder(a, "Erin");
  h.carol = await stakeholder(a, "Carol");

  await share(a, common, h.alice, 600);
  await share(a, seriesA, h.alice, 100);
  await share(a, common, h.bob, 300);
  await share(a, common, h.bob, 5_000, "DRAFT"); // ignored
  await share(a, common, h.dan, 200);
  await share(a, seriesA, h.acme, 200);

  const plan = await db.equityPlan.create({
    data: {
      companyId: a.companyId,
      name: "Plan",
      boardApprovalDate: new Date(),
      initialSharesReserved: 500n,
      defaultCancellatonBehavior: "RETIRE",
      shareClassId: common,
    },
  });
  const option = (
    stakeholderId: string,
    quantity: number,
    status: "ACTIVE" | "EXPIRED",
  ) =>
    db.option.create({
      data: {
        companyId: a.companyId,
        equityPlanId: plan.id,
        stakeholderId,
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
  await option(h.bob, 120, "ACTIVE");
  await option(h.erin, 30, "ACTIVE");
  await option(h.bob, 999, "EXPIRED"); // ignored

  const safe = (publicId: string, status: "ACTIVE" | "DRAFT") =>
    db.safe.create({
      data: {
        companyId: a.companyId,
        stakeholderId: h.carol,
        publicId,
        status,
        type: "POST_MONEY",
        capital: 50_000,
        valuationCap: 1_000_000,
        discountRate: 20,
        issueDate: new Date(),
        boardApprovalDate: new Date(),
      },
    });
  await safe("SAFE-01", "ACTIVE");
  await safe("SAFE-02", "DRAFT"); // ignored
  await db.convertibleNote.create({
    data: {
      companyId: a.companyId,
      stakeholderId: h.alice,
      publicId: "CN-01",
      status: "ACTIVE",
      capital: 10_000,
      conversionCap: 500_000,
      discountRate: 20,
      interestRate: 10,
      issueDate: new Date("2025-10-13T00:00:00Z"),
      boardApprovalDate: new Date(),
    },
  });

  // tenant B: its own holder, never visible to A
  const bClass = await shareClass(b, "B Common", 1);
  bHolder = await stakeholder(b, "Bea");
  await share(b, bClass, bHolder, 777_777);
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await cleanupTenants(a, b, empty);
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
});

describe("captable.table", () => {
  it("totals match the hand sums", async () => {
    const t = await callerFor(a).captable.table({});
    expect(t.totals).toEqual({
      issued: 1400,
      options: 150,
      unallocatedPool: 350,
      fullyDiluted: 1900,
      convertibleCapital: 60_000,
      byClass: { [common]: 1100, [seriesA]: 300 },
    });
    expect(Object.values(t.totals.byClass).reduce((x, y) => x + y, 0)).toBe(
      t.totals.issued,
    );
    expect(t.classes.map((c) => c.name)).toEqual(["Common", "Series A"]);
  });

  it("lists holders by issued desc, splits by class, and skips non-holders", async () => {
    const { rows } = await callerFor(a).captable.table({});
    const names = rows.map((r) => r.name);
    expect(names.slice(0, 2)).toEqual(["Alice", "Bob"]);
    expect(names.slice(2, 4).sort()).toEqual(["Acme", "Dan"]);
    expect(names[4]).toBe("Erin");
    expect(names).not.toContain("Carol"); // convertible only, no shares/options

    const alice = rows.find((r) => r.name === "Alice");
    expect(alice).toMatchObject({
      byClass: { [common]: 600, [seriesA]: 100 },
      issued: 700,
      options: 0,
      fullyDiluted: 700,
      convertibleCapital: 10_000,
    });
    expect(alice?.pctIssued).toBeCloseTo(0.5, 12);
    expect(alice?.pctFullyDiluted).toBeCloseTo(700 / 1900, 12);
    expect(rows.find((r) => r.name === "Bob")).toMatchObject({
      byClass: { [common]: 300 },
      issued: 300,
      options: 120,
      fullyDiluted: 420,
    });
  });

  it("issued percentages sum to 1 and FD percentages plus the pool sum to 1", async () => {
    const { rows, totals } = await callerFor(a).captable.table({});
    const sum = (f: (r: (typeof rows)[number]) => number) =>
      rows.reduce((n, r) => n + f(r), 0);
    expect(Math.abs(sum((r) => r.pctIssued) - 1)).toBeLessThan(1e-9);
    expect(
      Math.abs(
        sum((r) => r.pctFullyDiluted) +
          totals.unallocatedPool / totals.fullyDiluted -
          1,
      ),
    ).toBeLessThan(1e-9);
  });

  it("filters by class, holder type and search without changing totals or pct", async () => {
    const c = callerFor(a);
    const byClass = await c.captable.table({ classId: seriesA });
    expect(byClass.rows.map((r) => r.name)).toEqual(["Alice", "Acme"]);
    expect(byClass.totals.issued).toBe(1400);

    const inst = await c.captable.table({ holderType: "INSTITUTION" });
    expect(inst.rows.map((r) => r.name)).toEqual(["Acme"]);
    expect(inst.rows[0]?.pctIssued).toBeCloseTo(200 / 1400, 12);

    expect(
      (await c.captable.table({ search: "aCmE" })).rows.map((r) => r.name),
    ).toEqual(["Acme"]);
    expect(
      (await c.captable.table({ search: "dan-" })).rows.map((r) => r.name),
    ).toEqual(["Dan"]); // email match
  });

  it("pages by keyset without gaps or repeats", async () => {
    const c = callerFor(a);
    const all = (await c.captable.table({})).rows.map((r) => r.stakeholderId);
    for (const limit of [1, 2, 3]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await c.captable.table({ limit, cursor });
        seen.push(...page.rows.map((r) => r.stakeholderId));
        expect(page.totals.issued).toBe(1400);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen).toEqual(all);
    }
  });

  it("a foreign or unknown cursor returns an empty page", async () => {
    const c = callerFor(a);
    for (const cursor of [bHolder, "not-an-id"]) {
      const page = await c.captable.table({ cursor });
      expect(page.rows).toEqual([]);
      expect(page.nextCursor).toBeNull();
    }
  });

  it("never shows tenant B's holders", async () => {
    const t = await callerFor(a).captable.table({});
    expect(JSON.stringify(t)).not.toContain("Bea");
    expect(t.rows.map((r) => r.stakeholderId)).not.toContain(bHolder);
  });

  it("returns zero totals for an empty company", async () => {
    const t = await callerFor(empty).captable.table({});
    expect(t).toEqual({
      classes: [],
      rows: [],
      nextCursor: null,
      totals: {
        issued: 0,
        options: 0,
        unallocatedPool: 0,
        fullyDiluted: 0,
        convertibleCapital: 0,
        byClass: {},
      },
    });
  });
});

describe("captable.proforma", () => {
  it("matches modelRound for the same inputs (percent rates as fractions, note interest accrued)", async () => {
    const res = await callerFor(a).captable.proforma({ ...round, asOf: AS_OF });
    const expected = modelRound({
      ...round,
      preRoundFD: 1900,
      existingUnallocatedPool: 350,
      convertibles: [
        {
          id: "safe",
          holder: "Carol",
          kind: "SAFE",
          type: "POST_MONEY",
          capital: 50_000,
          cap: 1_000_000,
          discount: 0.2,
        },
        {
          id: "note",
          holder: "Alice",
          kind: "NOTE",
          type: "PRE_MONEY",
          capital: 10_000,
          interest: 1_000, // 10 % × 365 days / 365
          cap: 500_000,
          discount: 0.2,
        },
      ],
    });
    expect(res.converged).toBe(true);
    expect(res.asOf).toBe(AS_OF);
    for (const k of [
      "price",
      "postMoney",
      "postFD",
      "newInvestorShares",
      "poolTopUpShares",
      "newInvestorPct",
    ] as const) {
      expect(res[k]).toBeCloseTo(expected[k], 9);
    }
    const amounts = res.conversions.map((c) => c.amount).sort((x, y) => x - y);
    expect(amounts[0]).toBeCloseTo(11_000, 6);
    expect(amounts[1]).toBe(50_000);
    const shares = (r: typeof res.conversions) =>
      r.map((c) => c.shares).sort((x, y) => x - y);
    expect(shares(res.conversions)[0]).toBeCloseTo(
      shares(expected.conversions)[0] as number,
      6,
    );
    expect(shares(res.conversions)[1]).toBeCloseTo(
      shares(expected.conversions)[1] as number,
      6,
    );
  });

  it("holder rows: existing, merged converters, pool and new investors sum to 1", async () => {
    const res = await callerFor(a).captable.proforma({ ...round, asOf: AS_OF });
    const sum = (f: (r: (typeof res.holders)[number]) => number) =>
      res.holders.reduce((n, r) => n + f(r), 0);
    expect(Math.abs(sum((r) => r.pctAfter) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(sum((r) => r.pctBefore) - 1)).toBeLessThan(1e-9);

    const by = (id: string | null, name?: string) =>
      res.holders.filter(
        (r) => r.stakeholderId === id && (!name || r.name === name),
      );
    expect(by(h.alice)).toHaveLength(1); // holder + note merged
    const alice = by(h.alice)[0];
    expect(alice?.sharesBefore).toBe(700);
    expect(alice?.sharesAfter).toBeGreaterThan(700);
    const carol = by(h.carol)[0];
    expect(carol?.sharesBefore).toBe(0);
    expect(carol?.pctBefore).toBe(0);
    expect(carol?.sharesAfter).toBeGreaterThan(0);
    expect(by(h.bob)[0]).toMatchObject({ sharesBefore: 420, sharesAfter: 420 });

    const pool = by(null, "Unallocated pool")[0];
    expect(pool?.sharesBefore).toBe(350);
    expect(pool?.sharesAfter).toBeCloseTo(350 + res.poolTopUpShares, 6);
    const inv = by(null, "New investors")[0];
    expect(inv?.sharesAfter).toBeCloseTo(res.newInvestorShares, 6);
    for (const r of res.holders) {
      expect(r.dilutionPts).toBeCloseTo((r.pctAfter - r.pctBefore) * 100, 9);
    }
    expect(JSON.stringify(res)).not.toContain("Bea");
  });

  it("refuses an empty company", async () => {
    expect(await code(callerFor(empty).captable.proforma(round))).toBe(
      "BAD_REQUEST: Add shares first",
    );
  });

  it("validates inputs", async () => {
    const c = callerFor(a);
    for (const bad of [
      { ...round, preMoney: 0 },
      { ...round, newMoney: -1 },
      { ...round, poolTargetPct: 0.6 },
      { ...round, asOf: "2026-02-30" },
      { ...round, asOf: "13/10/2026" },
    ]) {
      expect(await code(c.captable.proforma(bad))).toMatch(/^BAD_REQUEST/);
    }
  });
});

describe("permissions", () => {
  it("refuses both procedures without securities:read and allows them with it", async () => {
    const without = await memberWith([
      { subject: "stakeholder", actions: ["read"] },
    ]);
    expect(await code(without.captable.table({}))).toMatch(/^UNAUTHORIZED/);
    expect(await code(without.captable.proforma(round))).toMatch(
      /^UNAUTHORIZED/,
    );

    const reader = await memberWith([
      { subject: "securities", actions: ["read"] },
    ]);
    expect(await code(reader.captable.table({}))).toBe("resolved");
    expect(await code(reader.captable.proforma(round))).toBe("resolved");
  });
});
