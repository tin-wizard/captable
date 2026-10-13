export type Convertible = {
  id: string;
  holder: string;
  kind: "SAFE" | "NOTE";
  type: "POST_MONEY" | "PRE_MONEY"; // notes are always treated as PRE_MONEY
  capital: number; // principal
  interest?: number; // accrued interest already computed by the caller (notes)
  cap: number | null; // valuation cap
  discount: number | null; // 0.2 = 20 %
};

export type RoundInput = {
  preRoundFD: number; // issued + active options + unallocated reserve
  existingUnallocatedPool: number; // part of preRoundFD that is unallocated reserve
  preMoney: number;
  newMoney: number;
  poolTargetPct: number; // 0..0.5, post-money unallocated pool / post FD
  convertibles: Convertible[];
};

export type RoundResult = {
  converged: boolean;
  price: number; // price per share of the round
  postMoney: number;
  postFD: number;
  newInvestorShares: number;
  poolTopUpShares: number;
  conversions: {
    id: string;
    holder: string;
    amount: number;
    price: number;
    shares: number;
    pctPost: number;
    bound: "cap" | "discount" | "round";
  }[];
  existing: { shares: number; pctBefore: number; pctAfter: number };
  newInvestorPct: number;
};

const TOLERANCE = 1e-9;
const MAX_ITERATIONS = 200;

const zeroed: RoundResult = {
  converged: false,
  price: 0,
  postMoney: 0,
  postFD: 0,
  newInvestorShares: 0,
  poolTopUpShares: 0,
  conversions: [],
  existing: { shares: 0, pctBefore: 0, pctAfter: 0 },
  newInvestorPct: 0,
};

/**
 * One priced round, solved by fixed-point iteration on the round price P,
 * starting from P0 = preMoney / preRoundFD. Each pass:
 * - per convertible: A = capital + interest; discountPrice = P × (1 − d) (if d > 0);
 *   capPrice = cap / (preRoundFD + Σ conversion shares of the previous pass) for
 *   POST_MONEY SAFEs, cap / preRoundFD for PRE_MONEY SAFEs and notes (if cap > 0);
 *   price_i = min(capPrice, discountPrice, P); shares_i = A / price_i.
 * - pool (t = poolTargetPct, U = existingUnallocatedPool, F = postFD):
 *   if t > 0, F = (preRoundFD + Σconv − U + newMoney / P) / (1 − t) and T = t·F − U;
 *   if T < 0 (or t = 0), T = 0 and F = preRoundFD + Σconv + newMoney / P.
 * - P' = preMoney / (preRoundFD + Σconv + T); stop when |P' − P| / P < 1e-9.
 * Bad inputs (preRoundFD <= 0, preMoney <= 0, t >= 1, non-finite) return
 * converged: false with zeroed numbers. All figures are reported at the
 * converged pass's P, so postMoney = P × postFD = preMoney + newMoney.
 * shortcut: one priced round only and note interest is supplied by the caller
 * (simple interest, no maturity), upgrade when multi-round or exit modelling lands.
 */
export function modelRound(input: RoundInput): RoundResult {
  const {
    preRoundFD,
    existingUnallocatedPool: U,
    preMoney,
    newMoney,
    poolTargetPct: t,
  } = input;
  if (
    !(preRoundFD > 0 && preMoney > 0 && t < 1) ||
    ![preRoundFD, U, preMoney, newMoney, t].every(Number.isFinite)
  ) {
    return structuredClone(zeroed);
  }

  let P = preMoney / preRoundFD;
  let prevSum = 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const conversions = input.convertibles.map((c) => {
      const amount = c.capital + (c.interest ?? 0);
      const capBase =
        c.kind === "SAFE" && c.type === "POST_MONEY"
          ? preRoundFD + prevSum
          : preRoundFD;
      const capPrice =
        c.cap != null && c.cap > 0 ? c.cap / capBase : Number.POSITIVE_INFINITY;
      const discountPrice =
        c.discount != null && c.discount > 0
          ? P * (1 - c.discount)
          : Number.POSITIVE_INFINITY;
      const price = Math.min(capPrice, discountPrice, P);
      const bound: "cap" | "discount" | "round" =
        price === P ? "round" : price === capPrice ? "cap" : "discount";
      return {
        id: c.id,
        holder: c.holder,
        amount,
        price,
        shares: amount / price,
        pctPost: 0,
        bound,
      };
    });
    const sum = conversions.reduce((s, c) => s + c.shares, 0);
    const newInvestorShares = newMoney / P;

    let T = 0;
    let F = preRoundFD + sum + newInvestorShares;
    if (t > 0) {
      const pooled = (preRoundFD + sum - U + newInvestorShares) / (1 - t);
      if (t * pooled - U > 0) {
        F = pooled;
        T = t * pooled - U;
      }
    }

    const next = preMoney / (preRoundFD + sum + T);
    if (!Number.isFinite(next) || next <= 0) return structuredClone(zeroed);
    const done = Math.abs(next - P) / P < TOLERANCE;
    if (done || i === MAX_ITERATIONS - 1) {
      return {
        converged: done,
        price: P,
        postMoney: P * F,
        postFD: F,
        newInvestorShares,
        poolTopUpShares: T,
        conversions: conversions.map((c) => ({ ...c, pctPost: c.shares / F })),
        existing: {
          shares: preRoundFD,
          pctBefore: 1,
          pctAfter: preRoundFD / F,
        },
        newInvestorPct: newInvestorShares / F,
      };
    }
    P = next;
    prevSum = sum;
  }
  return structuredClone(zeroed); // unreachable: the loop returns on its last pass
}
