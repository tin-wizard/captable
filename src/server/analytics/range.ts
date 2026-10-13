const DAY = 86_400_000;
const MAX_DAYS = 400;
const PRESETS = { "7d": 7, "30d": 30, "90d": 90 } as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FULL_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export type RangeInput = {
  range?: "7d" | "30d" | "90d" | "custom";
  from?: string;
  to?: string;
};

const startOfUtcDay = (t: number) => t - (((t % DAY) + DAY) % DAY);

// Epoch ms of the UTC day containing the value, or null when it is not an ISO date.
function parseDay(value: string | undefined): number | null {
  if (!value) return null;
  const date = DATE_ONLY.test(value);
  if (!date && !FULL_ISO.test(value)) return null;
  const t = Date.parse(date ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(t)) return null;
  // rejects 2026-02-31, which Date.parse would roll over
  if (date && new Date(t).toISOString().slice(0, 10) !== value) return null;
  return startOfUtcDay(t);
}

export function parseRange(input: RangeInput, now: Date = new Date()) {
  let fromDay: number;
  let toDay = startOfUtcDay(now.getTime());
  fromDay =
    toDay -
    ((input.range && input.range !== "custom" ? PRESETS[input.range] : 30) -
      1) *
      DAY;

  if (input.range === "custom") {
    const a = parseDay(input.from);
    const b = parseDay(input.to);
    if (a !== null && b !== null) {
      fromDay = Math.min(a, b);
      toDay = Math.max(a, b);
      // shortcut: over-long ranges are clamped, not rejected; keep the end
      fromDay = Math.max(fromDay, toDay - (MAX_DAYS - 1) * DAY);
    }
  }

  const days = Math.round((toDay - fromDay) / DAY) + 1;
  return {
    from: new Date(fromDay),
    to: new Date(toDay + DAY - 1),
    previousFrom: new Date(fromDay - days * DAY),
    previousTo: new Date(fromDay - 1),
    days,
  };
}

/** UTC `YYYY-MM-DD` for every day from `from` to `to`, both inclusive. */
export function dayBuckets(from: Date, to: Date): string[] {
  const out: string[] = [];
  const end = startOfUtcDay(to.getTime());
  for (let t = startOfUtcDay(from.getTime()); t <= end; t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function delta(
  current: number,
  previous: number,
): { pct: number | null; direction: "up" | "down" | "flat" } {
  if (current === previous)
    return { pct: previous === 0 ? null : 0, direction: "flat" };
  if (previous === 0)
    return { pct: null, direction: current > 0 ? "up" : "down" };
  const pct =
    Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  return { pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}
