"use client";

import { cn } from "@/lib/utils";
import { type RangeKey, readRange, useUrlState } from "./use-url-state";

const OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "custom", label: "Custom" },
];

// The range lives in the URL (?range=30d or ?range=custom&from=…&to=…) so a
// view can be shared and the server can read it on first render.
export const RangeTabs = ({ className }: { className?: string }) => {
  const { params, set } = useUrlState();
  const current = readRange(params);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div
        role="group"
        aria-label="Date range"
        className="inline-flex rounded-md border bg-card p-0.5"
      >
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={current.range === o.key}
            onClick={() =>
              set(
                o.key === "custom"
                  ? { range: "custom" }
                  : {
                      range: o.key === "30d" ? null : o.key,
                      from: null,
                      to: null,
                    },
              )
            }
            className={cn(
              "rounded px-3 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2",
              current.range === o.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {current.range === "custom" && (
        <div className="flex items-center gap-1 text-xs">
          <label className="sr-only" htmlFor="range-from">
            From
          </label>
          <input
            id="range-from"
            type="date"
            value={current.from ?? ""}
            max={current.to}
            onChange={(e) => set({ range: "custom", from: e.target.value })}
            className="rounded-md border bg-card px-2 py-1"
          />
          <span aria-hidden>–</span>
          <label className="sr-only" htmlFor="range-to">
            To
          </label>
          <input
            id="range-to"
            type="date"
            value={current.to ?? ""}
            min={current.from}
            onChange={(e) => set({ range: "custom", to: e.target.value })}
            className="rounded-md border bg-card px-2 py-1"
          />
        </div>
      )}
    </div>
  );
};
