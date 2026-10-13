import { getHoldings } from "@/server/analytics/holdings";
import type { TPrismaOrTransaction } from "@/server/db";
import type { Convertible } from "./proforma";

// Everything below takes the tenant client: nothing here filters by company.
// shortcut: all holders of one company are aggregated in memory before paging,
// upgrade to SQL-side ordering if a company ever has tens of thousands of holders.

export type CapTableFilter = {
  classId?: string;
  holderType?: "INDIVIDUAL" | "INSTITUTION";
  search?: string;
  cursor?: string;
  limit: number;
};

export type CapTableRow = {
  stakeholderId: string;
  name: string;
  email: string;
  byClass: Record<string, number>;
  options: number;
  issued: number;
  fullyDiluted: number;
  pctIssued: number;
  pctFullyDiluted: number;
  convertibleCapital: number;
};

type Holder = {
  byClass: Record<string, number>;
  issued: number;
  options: number;
};

// ACTIVE shares and options per stakeholder (only holders of either appear)
async function holderPositions(db: TPrismaOrTransaction) {
  const [shares, options] = await Promise.all([
    db.share.groupBy({
      by: ["stakeholderId", "shareClassId"],
      where: { status: "ACTIVE" },
      _sum: { quantity: true },
    }),
    db.option.groupBy({
      by: ["stakeholderId"],
      where: { status: "ACTIVE" },
      _sum: { quantity: true },
    }),
  ]);
  const holders = new Map<string, Holder>();
  const get = (id: string) => {
    let h = holders.get(id);
    if (!h) {
      h = { byClass: {}, issued: 0, options: 0 };
      holders.set(id, h);
    }
    return h;
  };
  for (const s of shares) {
    const q = s._sum.quantity ?? 0;
    const h = get(s.stakeholderId);
    h.byClass[s.shareClassId] = (h.byClass[s.shareClassId] ?? 0) + q;
    h.issued += q;
  }
  for (const o of options) get(o.stakeholderId).options += o._sum.quantity ?? 0;
  for (const [id, h] of holders)
    if (h.issued + h.options <= 0) holders.delete(id);
  return holders;
}

async function convertibleCapitalByHolder(db: TPrismaOrTransaction) {
  const where = { status: "ACTIVE" as const };
  const [safes, notes] = await Promise.all([
    db.safe.groupBy({ by: ["stakeholderId"], where, _sum: { capital: true } }),
    db.convertibleNote.groupBy({
      by: ["stakeholderId"],
      where,
      _sum: { capital: true },
    }),
  ]);
  const out = new Map<string, number>();
  for (const r of [...safes, ...notes]) {
    out.set(
      r.stakeholderId,
      (out.get(r.stakeholderId) ?? 0) + (r._sum.capital ?? 0),
    );
  }
  return out;
}

/**
 * Cap table rows, sorted by issued desc then stakeholderId asc. Keyset: the
 * cursor is the last row's stakeholderId; the next page holds rows strictly
 * after (its current issued, its id) in that order, so no row is skipped or
 * repeated while holdings are unchanged. A cursor that is not one of this
 * company's stakeholders yields an empty page. Totals and percentages are
 * company-wide and never depend on the filters or the page.
 */
export async function getCapTable(db: TPrismaOrTransaction, f: CapTableFilter) {
  const [holdings, holders, convertible, classes] = await Promise.all([
    getHoldings(db),
    holderPositions(db),
    convertibleCapitalByHolder(db),
    db.shareClass.findMany({
      select: { id: true, name: true },
      orderBy: { idx: "asc" },
    }),
  ]);

  const totals = {
    issued: holdings.issuedShares,
    options: holdings.optionsOutstanding,
    unallocatedPool: holdings.planReserveUnallocated,
    fullyDiluted: holdings.fullyDiluted,
    convertibleCapital: holdings.convertibleCapital,
    // ACTIVE issued shares per class id, company-wide
    byClass: Object.fromEntries(
      holdings.byClass.map((c) => [c.shareClassId, c.shares]),
    ) as Record<string, number>,
  };
  const empty = {
    classes,
    rows: [] as CapTableRow[],
    nextCursor: null,
    totals,
  };

  let after: { issued: number; id: string } | null = null;
  if (f.cursor) {
    const known = await db.stakeholder.count({ where: { id: f.cursor } });
    if (!known) return empty;
    after = { issued: holders.get(f.cursor)?.issued ?? 0, id: f.cursor };
  }

  const search = f.search?.trim();
  const people = await db.stakeholder.findMany({
    where: {
      // holders with only a convertible appear too (0 shares, their capital)
      id: {
        in: [
          ...new Set([
            ...holders.keys(),
            ...[...convertible].filter(([, c]) => c > 0).map(([id]) => id),
          ]),
        ],
      },
      ...(f.holderType && { stakeholderType: f.holderType }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    },
    select: { id: true, name: true, email: true },
  });

  const ordered = people
    .map((p) => ({
      p,
      h: holders.get(p.id) ?? { byClass: {}, issued: 0, options: 0 },
    }))
    .filter(({ h }) => !f.classId || (h.byClass[f.classId] ?? 0) > 0)
    .sort((x, y) => y.h.issued - x.h.issued || (x.p.id < y.p.id ? -1 : 1))
    .filter(
      ({ p, h }) =>
        !after ||
        h.issued < after.issued ||
        (h.issued === after.issued && p.id > after.id),
    );

  const page = ordered.slice(0, f.limit);
  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);
  const rows: CapTableRow[] = page.map(({ p, h }) => ({
    stakeholderId: p.id,
    name: p.name,
    email: p.email,
    byClass: h.byClass,
    options: h.options,
    issued: h.issued,
    fullyDiluted: h.issued + h.options,
    pctIssued: ratio(h.issued, totals.issued),
    pctFullyDiluted: ratio(h.issued + h.options, totals.fullyDiluted),
    convertibleCapital: convertible.get(p.id) ?? 0,
  }));

  return {
    classes,
    rows,
    nextCursor: ordered.length > f.limit ? page.at(-1)?.p.id ?? null : null,
    totals,
  };
}

const DAY_MS = 86_400_000;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const capOf = (v: number | null) => (v && v > 0 ? v : null);
// stored as percent (20 = 20 %)
const discountOf = (v: number | null) => (v ? clamp(v / 100, 0, 0.99) : null);

/**
 * Inputs for `modelRound` plus what the holder table needs: pre-round FD, the
 * unallocated pool, each existing holder's FD position, and the ACTIVE SAFEs
 * and notes. Note interest is simple: capital × rate × years(issue → asOf).
 */
export async function getRoundInputs(db: TPrismaOrTransaction, asOf: Date) {
  const select = {
    id: true,
    capital: true,
    discountRate: true,
    issueDate: true,
    stakeholder: { select: { id: true, name: true } },
  };
  const [holdings, holders, safes, notes] = await Promise.all([
    getHoldings(db),
    holderPositions(db),
    db.safe.findMany({
      where: { status: "ACTIVE" },
      select: { ...select, type: true, valuationCap: true },
    }),
    db.convertibleNote.findMany({
      where: { status: "ACTIVE" },
      select: { ...select, conversionCap: true, interestRate: true },
    }),
  ]);

  const names = await db.stakeholder.findMany({
    where: { id: { in: [...holders.keys()] } },
    select: { id: true, name: true },
  });

  const holderOf = new Map<string, { id: string; name: string }>();
  const convertibles: Convertible[] = [];
  for (const s of safes) {
    holderOf.set(s.id, s.stakeholder);
    convertibles.push({
      id: s.id,
      holder: s.stakeholder.name,
      kind: "SAFE",
      type: s.type,
      capital: Math.max(0, s.capital),
      cap: capOf(s.valuationCap),
      discount: discountOf(s.discountRate),
    });
  }
  for (const n of notes) {
    const capital = Math.max(0, n.capital);
    const years = (asOf.getTime() - n.issueDate.getTime()) / DAY_MS / 365;
    holderOf.set(n.id, n.stakeholder);
    convertibles.push({
      id: n.id,
      holder: n.stakeholder.name,
      kind: "NOTE",
      type: "PRE_MONEY",
      capital,
      interest: Math.max(0, capital * ((n.interestRate ?? 0) / 100) * years),
      cap: capOf(n.conversionCap),
      discount: discountOf(n.discountRate),
    });
  }

  return {
    issued: holdings.issuedShares,
    preRoundFD: holdings.fullyDiluted,
    existingUnallocatedPool: holdings.planReserveUnallocated,
    convertibles,
    holderOf,
    existing: names.map((p) => {
      const h = holders.get(p.id) as Holder;
      return {
        stakeholderId: p.id,
        name: p.name,
        shares: h.issued + h.options,
      };
    }),
  };
}
