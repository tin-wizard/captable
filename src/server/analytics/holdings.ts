import type { TPrismaOrTransaction } from "@/server/db";

export type Holdings = {
  issuedShares: number;
  optionsOutstanding: number;
  planReserveUnallocated: number;
  fullyDiluted: number;
  issuedValue: number;
  investmentsRecorded: number;
  convertibleCapital: number;
  byClass: {
    shareClassId: string;
    name: string;
    shares: number;
    pct: number;
    authorized: number;
    issuedValue: number;
  }[];
  byStakeholder: {
    stakeholderId: string | null; // null = the "Others" bucket
    name: string;
    shares: number;
    pct: number;
  }[];
};

const TOP_STAKEHOLDERS = 8;
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

// Everything is ACTIVE securities only (drafts, pending and signed-but-not-yet
// active rows are not holdings). `db` must be the tenant client: nothing here
// filters by company itself.
// shortcut: BigInt columns are summed as Number, exact up to 2^53 shares.
export async function getHoldings(db: TPrismaOrTransaction): Promise<Holdings> {
  const [shares, optionSums, plans, classes, investments, safes, notes] =
    await Promise.all([
      db.share.findMany({
        where: { status: "ACTIVE" },
        select: {
          quantity: true,
          pricePerShare: true,
          capitalContribution: true,
          shareClassId: true,
          stakeholderId: true,
        },
      }),
      db.option.groupBy({
        by: ["equityPlanId"],
        where: { status: "ACTIVE" },
        _sum: { quantity: true },
      }),
      db.equityPlan.findMany({
        select: { id: true, initialSharesReserved: true },
      }),
      db.shareClass.findMany({
        select: { id: true, name: true, initialSharesAuthorized: true },
        orderBy: { idx: "asc" },
      }),
      db.investment.aggregate({ _sum: { amount: true } }),
      db.safe.aggregate({
        where: { status: "ACTIVE" },
        _sum: { capital: true },
      }),
      db.convertibleNote.aggregate({
        where: { status: "ACTIVE" },
        _sum: { capital: true },
      }),
    ]);

  const value = (s: (typeof shares)[number]) =>
    s.capitalContribution ??
    (s.pricePerShare ? s.quantity * s.pricePerShare : 0);

  let issuedShares = 0;
  let issuedValue = 0;
  const classAgg = new Map<string, { shares: number; value: number }>();
  const holderAgg = new Map<string, number>();
  for (const s of shares) {
    issuedShares += s.quantity;
    issuedValue += value(s);
    const c = classAgg.get(s.shareClassId) ?? { shares: 0, value: 0 };
    c.shares += s.quantity;
    c.value += value(s);
    classAgg.set(s.shareClassId, c);
    holderAgg.set(
      s.stakeholderId,
      (holderAgg.get(s.stakeholderId) ?? 0) + s.quantity,
    );
  }

  const granted = new Map(
    optionSums.map((o) => [o.equityPlanId, o._sum.quantity ?? 0]),
  );
  const optionsOutstanding = [...granted.values()].reduce((a, b) => a + b, 0);
  const planReserveUnallocated = plans.reduce(
    (sum, p) =>
      sum +
      Math.max(0, num(p.initialSharesReserved) - (granted.get(p.id) ?? 0)),
    0,
  );

  const pct = (n: number) => (issuedShares ? n / issuedShares : 0);

  const topIds = [...holderAgg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_STAKEHOLDERS);
  const names = topIds.length
    ? await db.stakeholder.findMany({
        where: { id: { in: topIds.map(([id]) => id) } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const topShares = topIds.reduce((a, [, n]) => a + n, 0);
  const byStakeholder: Holdings["byStakeholder"] = topIds.map(([id, n]) => ({
    stakeholderId: id,
    name: nameOf.get(id) ?? "Unknown",
    shares: n,
    pct: pct(n),
  }));
  if (issuedShares > topShares) {
    byStakeholder.push({
      stakeholderId: null,
      name: "Others",
      shares: issuedShares - topShares,
      pct: pct(issuedShares - topShares),
    });
  }

  return {
    issuedShares,
    optionsOutstanding,
    planReserveUnallocated,
    fullyDiluted: issuedShares + optionsOutstanding + planReserveUnallocated,
    issuedValue,
    investmentsRecorded: investments._sum.amount ?? 0,
    convertibleCapital: (safes._sum.capital ?? 0) + (notes._sum.capital ?? 0),
    byClass: classes.map((c) => {
      const agg = classAgg.get(c.id) ?? { shares: 0, value: 0 };
      return {
        shareClassId: c.id,
        name: c.name,
        shares: agg.shares,
        pct: pct(agg.shares),
        authorized: num(c.initialSharesAuthorized),
        issuedValue: agg.value,
      };
    }),
    byStakeholder,
  };
}
