export type HolderShare = { name: string; shares: number };
export type TopSlice = { name: string; shares: number; pct: number };

/**
 * Top `n` holders by issued shares plus an "Others" slice holding whatever of
 * `totalIssued` they do not cover. Percentages are shares / totalIssued, so
 * they sum to 1. No "Others" slice when the top n already cover the total.
 */
export function topHolders(
  holders: HolderShare[],
  totalIssued: number,
  n = 10,
): TopSlice[] {
  if (totalIssued <= 0) return [];
  const top = holders
    .filter((h) => h.shares > 0)
    .sort((a, b) => b.shares - a.shares)
    .slice(0, n);
  const rest = totalIssued - top.reduce((s, h) => s + h.shares, 0);
  const slices = rest > 0 ? [...top, { name: "Others", shares: rest }] : top;
  return slices.map((h) => ({ ...h, pct: h.shares / totalIssued }));
}
