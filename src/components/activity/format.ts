export const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const topPages = (pageSeconds: Record<string, number>, n: number) =>
  Object.entries(pageSeconds)
    .filter(([, seconds]) => seconds > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([page, seconds]) => ({ page, seconds }));

const regions = new Intl.DisplayNames(["en"], { type: "region" });

export const countryName = (code: string | null) => {
  if (!code) return null;
  try {
    return regions.of(code) ?? code;
  } catch {
    return code; // malformed code: show it as stored
  }
};
