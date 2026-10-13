"use client";

import { useEffect, useState } from "react";
import { useUrlState } from "./use-url-state";

// Debounced search that writes ?q= (cursor is dropped by applyPatch).
export const SearchBox = ({
  placeholder = "Search",
  className,
}: {
  placeholder?: string;
  className?: string;
}) => {
  const { params, set } = useUrlState();
  const urlValue = params.get("q") ?? "";
  const [value, setValue] = useState(urlValue);

  useEffect(() => setValue(urlValue), [urlValue]);
  useEffect(() => {
    if (value === urlValue) return;
    const t = setTimeout(() => set({ q: value || null }), 350);
    return () => clearTimeout(t);
  }, [value, urlValue, set]);

  return (
    <>
      <label className="sr-only" htmlFor="analytics-search">
        {placeholder}
      </label>
      <input
        id="analytics-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={`rounded-md border bg-card px-3 py-1.5 text-sm ${
          className ?? ""
        }`}
      />
    </>
  );
};
