"use client";

import { SparkAreaChart } from "@tremor/react";
import { useEffect, useState } from "react";

// Tremor charts measure the DOM, so they render after mount only. The values
// are announced through `label` for screen readers.
export const Sparkline = ({
  data,
  label,
  className = "h-8 w-24",
}: {
  data: { index: string; value: number }[];
  label: string;
  className?: string;
}) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (data.length < 2) return null;
  return (
    <span role="img" aria-label={label} className={className}>
      {mounted && (
        <SparkAreaChart
          data={data}
          index="index"
          categories={["value"]}
          colors={["blue"]}
          className="h-full w-full"
        />
      )}
    </span>
  );
};
