// score = round(100 * (0.4 * min(1, activeSeconds / 300)
//                    + 0.3 * coverage
//                    + 0.3 * min(1, (visits - 1) / 2)))
// coverage = pagesTotal ? min(1, pagesReached / pagesTotal) : min(1, activeSeconds / 300)
// labels: hot >= 70, warm >= 35, else cold. Weights are heuristics; show raw numbers too.
export function engagement(input: {
  activeSeconds: number;
  visits: number;
  pagesReached: number;
  pagesTotal: number | null;
}): { score: number; label: "hot" | "warm" | "cold" } {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const time = clamp(input.activeSeconds / 300);
  const coverage = input.pagesTotal
    ? clamp(input.pagesReached / input.pagesTotal)
    : time;
  const returns = clamp((input.visits - 1) / 2);
  const score = Math.round(100 * (0.4 * time + 0.3 * coverage + 0.3 * returns));
  return { score, label: score >= 70 ? "hot" : score >= 35 ? "warm" : "cold" };
}
