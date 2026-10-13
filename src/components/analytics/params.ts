export type RawSearchParams = Record<string, string | string[] | undefined>;

const RANGES = ["7d", "30d", "90d", "custom"] as const;
const STATUSES = ["all", "returned", "unopened"] as const;

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

// Server-side reading of the same URL the kit writes (range, filters, search,
// cursor). Unknown or malformed values fall back to defaults, never throw.
export function analyticsParams(sp: RawSearchParams) {
  const range = first(sp.range);
  const status = first(sp.status);
  const countries = (first(sp.country) ?? "")
    .split(",")
    .filter((c) => /^[A-Z]{2}$/.test(c))
    .slice(0, 20);
  const q = first(sp.q)?.trim().slice(0, 100);
  const cursor = first(sp.cursor)?.slice(0, 64);
  return {
    range: RANGES.find((r) => r === range),
    from: first(sp.from)?.slice(0, 40),
    to: first(sp.to)?.slice(0, 40),
    includeBots: first(sp.bots) === "1",
    viewerStatus: STATUSES.find((s) => s === status),
    country: countries.length ? countries : undefined,
    search: q || undefined,
    cursor: cursor || undefined,
  };
}

const TEMPLATE_STATUSES = [
  "DRAFT",
  "PENDING",
  "COMPLETE",
  "CANCELLED",
] as const;

// The e-sign list reads the same URL state plus status, stuck and signer.
export function esignParams(sp: RawSearchParams) {
  const base = analyticsParams(sp);
  const status = (first(sp.status) ?? "")
    .split(",")
    .filter((s): s is (typeof TEMPLATE_STATUSES)[number] =>
      (TEMPLATE_STATUSES as readonly string[]).includes(s),
    );
  return {
    range: base.range,
    from: base.from,
    to: base.to,
    status: status.length ? status : undefined,
    stuck: first(sp.stuck) === "1" ? true : undefined,
    signer: first(sp.signer)?.trim().slice(0, 100) || undefined,
    search: base.search,
    cursor: base.cursor,
  };
}
