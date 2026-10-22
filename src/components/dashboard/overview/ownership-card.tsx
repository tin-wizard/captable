"use client";

import { ChartCard, formatCount, formatPercent } from "@/components/analytics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";

type Slice = { name: string; shares: number; pct: number };

// Ownership of issued shares, by share class or by stakeholder; each row shows
// its percentage as text next to the bar, so values never depend on colour.
export const OwnershipCard = ({
  byClass,
  byStakeholder,
}: {
  byClass: Slice[];
  byStakeholder: Slice[];
}) => {
  const [by, setBy] = useState<"class" | "stakeholder">("class");

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
      <div className="-m-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-auto px-4 py-2 text-xs font-medium text-muted-foreground">
                Holder
              </TableHead>
              <TableHead className="h-auto px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                Shares
              </TableHead>
              <TableHead className="h-auto px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                Ownership
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slices.map((s) => (
              <TableRow key={s.name}>
                <TableCell
                  title={s.name}
                  className="max-w-[16rem] truncate px-4 py-[11px] font-medium"
                >
                  {s.name}
                </TableCell>
                <TableCell className="px-4 py-[11px] text-right tabular-nums">
                  {formatCount(s.shares)}
                </TableCell>
                <TableCell className="px-4 py-[11px] text-right tabular-nums">
                  <span
                    aria-hidden
                    className="mr-2 inline-block h-1.5 w-20 align-middle"
                  >
                    <span
                      className="block h-1.5 rounded-[1px] bg-primary/85"
                      style={{
                        width: `${Math.max(2, Math.min(100, s.pct * 100))}%`,
                      }}
                    />
                  </span>
                  {formatPercent(s.pct)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ChartCard>
  );
};
