"use client";

import arcs from "@/assets/tin-mark-arcs.png";
import dot from "@/assets/tin-mark-dot.png";
import letters from "@/assets/tin-mark-letters.png";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { type CSSProperties, useEffect, useRef } from "react";

const IDLE_INTERVAL_MS = 9000;

// Animated TIN logo built from three layers of the real logo (see
// src/assets/tin-mark-*.png): the letters rise, the dot drops in, then the
// signal arcs transmit one by one. The arcs re-transmit every few seconds
// while the page is visible. Styles live in globals.css (.brand-mark).
export const BrandMark = ({
  className,
  width,
}: {
  className?: string;
  width?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = window.setInterval(() => {
      if (document.hidden) return;
      el.classList.remove("is-idle");
      el.getBoundingClientRect(); // restart the animation
      el.classList.add("is-idle");
    }, IDLE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      ref={ref}
      role="img"
      aria-label="TIN"
      className={cn("brand-mark", className)}
      style={
        width ? ({ "--mark-w": `${width}px` } as CSSProperties) : undefined
      }
    >
      <Image src={letters} alt="" priority className="brand-mark-letters" />
      <Image src={arcs} alt="" priority className="brand-mark-arcs" />
      <Image src={dot} alt="" priority className="brand-mark-dot" />
    </div>
  );
};
