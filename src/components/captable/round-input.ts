export type RoundFormValues = {
  preMoney: string;
  newMoney: string;
  // percent as typed, e.g. "10" for a 10 % post-money pool
  poolTargetPct: string;
  asOf: string; // YYYY-MM-DD or blank
};

export type RoundInputValue = {
  preMoney: number;
  newMoney: number;
  poolTargetPct: number; // ratio 0..0.5
  asOf?: string;
};

export type RoundInputErrors = Partial<Record<keyof RoundFormValues, string>>;

export type RoundInputResult =
  | { ok: true; value: RoundInputValue }
  | { ok: false; errors: RoundInputErrors };

const toNumber = (s: string) => {
  const t = s.replace(/[,$\s]/g, "");
  return t === "" ? Number.NaN : Number(t);
};

export function validateRoundInput(v: RoundFormValues): RoundInputResult {
  const errors: RoundInputErrors = {};

  const preMoney = toNumber(v.preMoney);
  if (!Number.isFinite(preMoney) || preMoney <= 0) {
    errors.preMoney = "Enter a pre-money valuation above 0.";
  }

  const newMoney = toNumber(v.newMoney);
  if (!Number.isFinite(newMoney) || newMoney < 0) {
    errors.newMoney = "Enter new money of 0 or more.";
  }

  const poolPct = v.poolTargetPct.trim() === "" ? 0 : toNumber(v.poolTargetPct);
  if (!Number.isFinite(poolPct) || poolPct < 0 || poolPct > 50) {
    errors.poolTargetPct = "Enter a pool target between 0% and 50%.";
  }

  const asOf = v.asOf.trim();
  if (asOf !== "") {
    const d = new Date(`${asOf}T00:00:00Z`);
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(asOf) &&
      !Number.isNaN(d.getTime()) &&
      d.toISOString().startsWith(asOf);
    if (!valid) errors.asOf = "Enter a valid date (YYYY-MM-DD).";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      preMoney,
      newMoney,
      poolTargetPct: poolPct / 100,
      ...(asOf ? { asOf } : {}),
    },
  };
}

// Rounds first so a tiny negative never renders as "-0.0".
export function formatDilution(pts: number): string {
  const r = Math.round(pts * 10) / 10;
  const sign = r < 0 ? "-" : "+";
  return `${sign}${Math.abs(r).toFixed(1)} pts`;
}

// Existing holders by shares before then name, then the pool and new
// investors (rows without a stakeholder) in the server's order.
export function sortHolders<
  T extends {
    stakeholderId: string | null;
    name: string;
    sharesBefore: number;
  },
>(rows: T[]): T[] {
  const people = rows
    .filter((r) => r.stakeholderId !== null)
    .sort(
      (a, b) => b.sharesBefore - a.sharesBefore || a.name.localeCompare(b.name),
    );
  return [...people, ...rows.filter((r) => r.stakeholderId === null)];
}

// Lets only the newest request touch the screen: an edit or a new Calculate
// invalidates every earlier one.
export function latestGuard() {
  let n = 0;
  return {
    begin: () => ++n,
    invalidate: () => {
      n++;
    },
    isCurrent: (token: number) => token === n,
  };
}
