import { formatDuration } from "@/components/activity/format";

// Tremor colour names (safelisted in tailwind.config.ts). Blue is the brand
// primary; the status trio stays distinguishable in greyscale by value labels.
export const chartColors = {
  primary: "blue",
  secondary: "orange",
  success: "emerald",
  warning: "amber",
  danger: "rose",
  muted: "slate",
} as const;

export const engagementColors = {
  hot: "rose",
  warm: "amber",
  cold: "slate",
  unopened: "gray",
} as const;

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const whole = new Intl.NumberFormat("en");
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export const formatCount = (n: number) => whole.format(n);
export const formatCompact = (n: number) => compact.format(n);
export const formatMoney = (n: number) => (n === 0 ? "$0" : money.format(n));
export const formatPercent = (ratio: number | null) =>
  ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
export const formatSeconds = formatDuration;
// "3 h 20 m" for hour-scale values such as time to sign
export const formatHours = (hours: number | null) => {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} m`;
  if (hours < 48) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m ? `${h} h ${m} m` : `${h} h`;
  }
  return `${Math.round(hours / 24)} d`;
};
