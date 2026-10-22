"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RiBarChartBoxLine, RiErrorWarningLine } from "@remixicon/react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  state?: "ready" | "loading" | "empty" | "error";
  emptyHint?: string;
  errorMessage?: string;
  onRetry?: () => void;
  // a text alternative for the chart, read by screen readers
  tableAlt?: { columns: string[]; rows: (string | number)[][] };
  children?: ReactNode;
  className?: string;
};

export const ChartCard = ({
  title,
  description,
  actions,
  state = "ready",
  emptyHint = "Nothing to show for this period yet.",
  errorMessage = "This chart could not be loaded.",
  onRetry,
  tableAlt,
  children,
  className,
}: Props) => (
  <Card className={className} aria-busy={state === "loading"}>
    <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
      <div>
        <h3 className="font-serif text-[19px] font-medium">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actions}
    </div>
    <div className="p-4">
      {state === "loading" && (
        <div className="h-48 animate-pulse rounded bg-muted/60" />
      )}
      {state === "empty" && (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <RiBarChartBoxLine className="h-8 w-8" aria-hidden />
          <p>{emptyHint}</p>
        </div>
      )}
      {state === "error" && (
        <div
          role="alert"
          className="flex h-48 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground"
        >
          <RiErrorWarningLine className="h-8 w-8" aria-hidden />
          <p>{errorMessage}</p>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {state === "ready" && (
        <>
          {children}
          {tableAlt && (
            <table className="sr-only">
              <caption>{title}</caption>
              <thead>
                <tr>
                  {tableAlt.columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableAlt.rows.map((row, i) => (
                  <tr key={`${i}-${row[0]}`}>
                    {tableAlt.columns.map((col, j) => (
                      <td key={col}>{row[j]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  </Card>
);
