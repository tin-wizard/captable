"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type RangeKey = "7d" | "30d" | "90d" | "custom";
export type RangeValue = { range: RangeKey; from?: string; to?: string };
export type Patch = Record<string, string | string[] | null | undefined>;

const RANGES: RangeKey[] = ["7d", "30d", "90d", "custom"];

export function readRange(params: URLSearchParams): RangeValue {
  const r = params.get("range") as RangeKey | null;
  const range = r && RANGES.includes(r) ? r : "30d";
  if (range !== "custom") return { range };
  return {
    range,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  };
}

// multi-value filters are stored comma separated: ?country=DE,FR
export function readList(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  return raw ? raw.split(",").filter(Boolean) : [];
}

// Applies a patch to the current query. Unknown params are kept, empty values
// remove the key, and the pagination cursor is dropped when anything else changes.
export function applyPatch(current: URLSearchParams, patch: Patch) {
  const next = new URLSearchParams(current);
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    const v = Array.isArray(value) ? value.join(",") : value;
    if (v === null || v === undefined || v === "") next.delete(key);
    else next.set(key, v);
    if (key !== "cursor") changed = true;
  }
  if (changed) next.delete("cursor");
  return next;
}

export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = useCallback(
    (patch: Patch) => {
      const qs = applyPatch(
        new URLSearchParams(params.toString()),
        patch,
      ).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return { params, set };
}
