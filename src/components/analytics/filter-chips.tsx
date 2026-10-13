"use client";

import { cn } from "@/lib/utils";
import { readList, useUrlState } from "./use-url-state";

export type ChipGroup = {
  key: string;
  label: string;
  options: { value: string; label: string; count?: number }[];
  // several values at once (comma separated in the URL); default is single choice
  multi?: boolean;
};

// Toggle chips whose state lives in the URL. Selecting the active single-choice
// chip clears it; changing any filter drops the pagination cursor (applyPatch).
export const FilterChips = ({
  groups,
  className,
}: {
  groups: ChipGroup[];
  className?: string;
}) => {
  const { params, set } = useUrlState();

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}
    >
      {groups.map((g) => {
        const active = readList(params, g.key);
        return (
          <div
            key={g.key}
            role="group"
            aria-label={g.label}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-xs text-muted-foreground">{g.label}</span>
            {g.options.map((o) => {
              const on = active.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = g.multi
                      ? on
                        ? active.filter((v) => v !== o.value)
                        : [...active, o.value]
                      : on
                        ? []
                        : [o.value];
                    set({ [g.key]: next.length ? next : null });
                  }}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs focus-visible:outline focus-visible:outline-2",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                  {o.count !== undefined && (
                    <span className="ml-1 opacity-70">{o.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
