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

const dayFmt = new Map<string, Intl.DateTimeFormat>();
const partsFmt = new Map<string, Intl.DateTimeFormat>();

function cached(
  cache: Map<string, Intl.DateTimeFormat>,
  tz: string,
  make: () => Intl.DateTimeFormat,
) {
  let f = cache.get(tz);
  if (!f) {
    f = make();
    cache.set(tz, f);
  }
  return f;
}

/** `YYYY-MM-DD` of the instant on the wall calendar of `tz`. */
export function localDay(date: Date, tz = "UTC"): string {
  if (tz === "UTC") return date.toISOString().slice(0, 10);
  return cached(
    dayFmt,
    tz,
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
  ).format(date);
}

// wall-clock fields of the instant in `tz`
function wallClock(t: number, tz: string) {
  const parts = cached(
    partsFmt,
    tz,
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      }),
  ).formatToParts(t);
  const n = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    y: n("year"),
    mo: n("month"),
    d: n("day"),
    h: n("hour"),
    mi: n("minute"),
    s: n("second"),
  };
}

/** Integer wall-clock hour (0-23) of the instant in `tz`. */
export function localHour(date: Date, tz = "UTC"): number {
  return tz === "UTC" ? date.getUTCHours() : wallClock(date.getTime(), tz).h;
}

// ms the wall clock of `tz` is ahead of UTC at instant t (+13 h in Auckland);
function offsetAt(t: number, tz: string) {
  const w = wallClock(t, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - t; // t is whole seconds
}

// calendar arithmetic on the date itself, never on an instant, so DST cannot
// skip or repeat a day
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The first instant of the local calendar day `day` (`YYYY-MM-DD`) in `tz`. */
export function localMidnight(day: string, tz = "UTC"): Date {
  const naive = Date.parse(`${day}T00:00:00Z`);
  if (tz === "UTC") return new Date(naive);
  // The offset that applies at local midnight is one of the offsets in force
  // within 14 h of the naive instant (offsets span -12..+14). Each gives a
  // candidate; the earliest that falls on `day` is its start, which is also the
  // right answer when a DST jump skips midnight itself.
  let best = Number.POSITIVE_INFINITY;
  for (const probe of [naive - 14 * 3_600_000, naive, naive + 14 * 3_600_000]) {
    const t = naive - offsetAt(probe, tz);
    if (t < best && localDay(new Date(t), tz) === day) best = t;
  }
  return new Date(best);
}

// The day (`YYYY-MM-DD` in `tz`) the value names, or null when it is not an ISO date.
function parseDay(value: string | undefined, tz: string): string | null {
  if (!value) return null;
  const date = DATE_ONLY.test(value);
  if (!date && !FULL_ISO.test(value)) return null;
  const t = Date.parse(date ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(t)) return null;
  // rejects 2026-02-31, which Date.parse would roll over
  if (date)
    return new Date(t).toISOString().slice(0, 10) === value ? value : null;
  return localDay(new Date(t), tz);
}

/**
 * Whole local days in `tz`: `from` is local midnight of the first day, `to` the
 * last millisecond of the last day, and the previous period has as many days.
 */
export function parseRange(
  input: RangeInput,
  now: Date = new Date(),
  tz = "UTC",
) {
  let toDay = localDay(now, tz);
  let fromDay = addDays(
    toDay,
    -(
      (input.range && input.range !== "custom" ? PRESETS[input.range] : 30) - 1
    ),
  );

  if (input.range === "custom") {
    const a = parseDay(input.from, tz);
    const b = parseDay(input.to, tz);
    if (a !== null && b !== null) {
      [fromDay, toDay] = a <= b ? [a, b] : [b, a];
      // shortcut: over-long ranges are clamped, not rejected; keep the end
      const earliest = addDays(toDay, -(MAX_DAYS - 1));
      if (fromDay < earliest) fromDay = earliest;
    }
  }

  const days = Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY) + 1;
  const from = localMidnight(fromDay, tz);
  return {
    from,
    to: new Date(localMidnight(addDays(toDay, 1), tz).getTime() - 1),
    previousFrom: localMidnight(addDays(fromDay, -days), tz),
    previousTo: new Date(from.getTime() - 1),
    days,
  };
}

/** `YYYY-MM-DD` in `tz` for every local day from `from` to `to`, both inclusive. */
export function dayBuckets(from: Date, to: Date, tz = "UTC"): string[] {
  const out: string[] = [];
  const end = localDay(to, tz);
  for (let d = localDay(from, tz); d <= end; d = addDays(d, 1)) out.push(d);
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
