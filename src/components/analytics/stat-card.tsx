"use client";

import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiInformationLine,
  RiSubtractLine,
} from "@remixicon/react";
import { SparkAreaChart } from "@tremor/react";
import Link from "next/link";
import { useEffect, useState } from "react";

export type Delta = {
  pct: number | null;
  direction: "up" | "down" | "flat";
};

type Props = {
  label: string;
  value: string;
  hint?: string;
  delta?: Delta;
  // "up is good" by default; set false for metrics where a drop is the win
  upIsGood?: boolean;
  spark?: { index: string; value: number }[];
  href?: string;
  loading?: boolean;
  className?: string;
};

const deltaText = (d: Delta) => {
  if (d.direction === "flat") return "no change";
  if (d.pct === null) return d.direction === "up" ? "new" : "down";
  return `${d.direction === "up" ? "up" : "down"} ${Math.abs(d.pct)} percent`;
};

export const StatCard = ({
  label,
  value,
  hint,
  delta,
  upIsGood = true,
  spark,
  href,
  loading,
  className,
}: Props) => {
  // Tremor charts measure the DOM: render them after mount only
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (loading) {
    return (
      <Card className={cn("p-4", className)} aria-busy="true">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-7 w-20 animate-pulse rounded bg-muted" />
      </Card>
    );
  }

  const good =
    delta && delta.direction !== "flat"
      ? (delta.direction === "up") === upIsGood
      : null;
  const Icon =
    delta?.direction === "up"
      ? RiArrowUpLine
      : delta?.direction === "down"
        ? RiArrowDownLine
        : RiSubtractLine;

  const body = (
    <Card
      className={cn(
        "flex h-full min-w-0 flex-col justify-between gap-2 px-[18px] py-4",
        href && "transition-colors hover:bg-muted",
        className,
      )}
    >
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        {hint && (
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`About ${label}`}
                  className="rounded text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
                >
                  <RiInformationLine className="h-3.5 w-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{hint}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="min-w-0 truncate text-[28px] font-medium leading-tight max-sm:text-xl tabular-nums tracking-tight">
            {value}
          </div>
          {delta && (
            <div
              className={cn(
                "mt-1 inline-flex items-center gap-0.5 text-xs font-medium",
                good === null
                  ? "text-muted-foreground"
                  : good
                    ? "text-emerald-700"
                    : "text-rose-700",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span aria-hidden>
                {delta.pct === null
                  ? delta.direction === "flat"
                    ? "—"
                    : "new"
                  : `${delta.pct > 0 ? "+" : ""}${delta.pct}%`}
              </span>
              <span className="sr-only">{deltaText(delta)}</span>
            </div>
          )}
        </div>
        {spark && spark.length > 1 && mounted && (
          <SparkAreaChart
            data={spark}
            index="index"
            categories={["value"]}
            colors={["blue"]}
            className="h-9 w-24 shrink-0 max-sm:w-12"
            aria-hidden
          />
        )}
      </div>
    </Card>
  );

  return href ? (
    <Link
      href={href}
      aria-label={`${label}: ${value}`}
      className="block min-w-0"
    >
      {body}
    </Link>
  ) : (
    <div role="group" aria-label={`${label}: ${value}`} className="min-w-0">
      {body}
    </div>
  );
};
