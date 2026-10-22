"use client";

import {
  ChartCard,
  formatCompact,
  formatPercent,
} from "@/components/analytics";
import { DonutChart } from "@tremor/react";
import { useEffect, useState } from "react";

type Slice = { name: string; shares: number; pct: number };

const COLORS = [
  "blue",
  "orange",
  "emerald",
  "violet",
  "amber",
  "cyan",
  "rose",
  "indigo",
  "slate",
] as const;

// Ownership of issued shares, by share class or by stakeholder. Every slice is
// also listed next to the chart, so the values never depend on colour.
export const OwnershipCard = ({
  byClass,
  byStakeholder,
}: {
  byClass: Slice[];
  byStakeholder: Slice[];
}) => {
  const [by, setBy] = useState<"class" | "stakeholder">("class");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const slices = (by === "class" ? byClass : byStakeholder).filter(
    (s) => s.shares > 0,
  );
  const empty = slices.length === 0;

  return (
    <ChartCard
      title="Ownership"
      description="Share of issued shares"
      state={empty ? "empty" : "ready"}
      emptyHint="Issue shares to see how ownership splits."
      actions={
        <div
          role="group"
          aria-label="Group ownership by"
          className="inline-flex rounded border bg-card p-0.5 text-xs"
        >
          {(["class", "stakeholder"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={by === k}
              onClick={() => setBy(k)}
              className={`rounded px-2.5 py-1 font-medium focus-visible:outline focus-visible:outline-2 ${
                by === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {k === "class" ? "Share class" : "Stakeholder"}
            </button>
          ))}
        </div>
      }
      tableAlt={{
        columns: ["Name", "Shares", "Ownership"],
        rows: slices.map((s) => [s.name, s.shares, formatPercent(s.pct)]),
      }}
    >
      <div className="grid items-center gap-4 sm:grid-cols-2">
        <ul className="space-y-2 text-sm">
          {slices.map((s, i) => (
            <li
              key={s.name}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full bg-${
                    COLORS[i % COLORS.length]
                  }-500`}
                />
                <span className="truncate font-medium">{s.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCompact(s.shares)} · {formatPercent(s.pct)}
              </span>
            </li>
          ))}
        </ul>
        {mounted && (
          <DonutChart
            className="h-48"
            data={slices.map((s) => ({ name: s.name, value: s.shares }))}
            category="value"
            index="name"
            colors={slices.map((_, i) => COLORS[i % COLORS.length] ?? "blue")}
            showLabel={false}
            valueFormatter={(v) => formatCompact(v)}
          />
        )}
      </div>
    </ChartCard>
  );
};
