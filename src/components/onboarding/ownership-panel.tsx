"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

// Illustrative example only: no real company data is shown before login.
const HOLDERS = [
  { name: "Founders", color: "#9cafd0" },
  { name: "Series A investors", color: "#3b63ad" },
  { name: "Seed SAFE holders", color: "#6b86b4" },
  { name: "Employee option pool", color: "#c8d4e7" },
  { name: "Advisors", color: "#ef6a30" },
];

const ROUNDS = [
  { name: "Founding", shares: [85, 0, 0, 10, 5] },
  { name: "After seed", shares: [64, 0, 15, 15, 6] },
  { name: "After Series A", shares: [46, 21.5, 12.5, 15, 5] },
];

const RADIUS = 96;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const MOVE_MS = 1100;
const HOLD_MS = 5200;

const easeInOutCubic = (k: number) =>
  k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;

// Navy brand panel for the login and sign-up pages: an ownership ring that
// moves through funding rounds to show dilution. It pauses while the tab is
// hidden and stays on the last round for reduced-motion users.
export function OwnershipPanel() {
  const segRefs = useRef<(SVGCircleElement | null)[]>([]);
  const pctRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const totalRef = useRef<HTMLSpanElement>(null);
  const current = useRef<number[]>(HOLDERS.map(() => 0));
  const [round, setRound] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hot, setHot] = useState<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduceMotion(true);
      setRound(ROUNDS.length - 1);
    }
  }, []);

  useEffect(() => {
    const target = ROUNDS[round]?.shares ?? [];
    const from = current.current.slice();
    const duration = reduceMotion ? 0 : MOVE_MS;
    const start = performance.now();
    let frame = 0;
    let timer = 0;

    const paint = (values: number[]) => {
      let offset = 0;
      values.forEach((value, i) => {
        const gap = value > 0.4 ? 3 : 0;
        const length = Math.max(0, (CIRCUMFERENCE * value) / 100 - gap);
        const seg = segRefs.current[i];
        seg?.setAttribute("stroke-dasharray", `${length} ${CIRCUMFERENCE}`);
        seg?.setAttribute(
          "stroke-dashoffset",
          String((-offset * CIRCUMFERENCE) / 100),
        );
        const pct = pctRefs.current[i];
        if (pct) pct.textContent = `${value.toFixed(1)}%`;
        const row = rowRefs.current[i];
        if (row) row.dataset.zero = value < 0.05 ? "true" : "false";
        offset += value;
      });
      if (totalRef.current) {
        totalRef.current.textContent = `${Math.round(offset)}%`;
      }
    };

    const advance = () => {
      if (document.hidden) {
        timer = window.setTimeout(advance, 1000);
        return;
      }
      setRound((r) => (r + 1) % ROUNDS.length);
    };

    const step = (now: number) => {
      const k = duration ? Math.min(1, (now - start) / duration) : 1;
      const eased = easeInOutCubic(k);
      const values = from.map((f, i) => f + ((target[i] ?? 0) - f) * eased);
      current.current = values;
      paint(values);
      if (k < 1) {
        frame = requestAnimationFrame(step);
      } else if (!reduceMotion) {
        timer = window.setTimeout(advance, HOLD_MS);
      }
    };

    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [round, reduceMotion]);

  return (
    <section className="relative flex items-center gap-5 overflow-hidden bg-navy-800 px-6 py-6 text-white sm:gap-8 sm:px-10 sm:py-8 lg:w-[52%] lg:flex-col lg:items-stretch lg:justify-center lg:gap-10 lg:px-14 lg:py-12">
      <span aria-hidden="true" className="ownership-glow" />

      <div className="relative min-w-0 flex-1 lg:flex-none">
        <h2 className="max-w-md text-lg font-semibold leading-tight tracking-tight text-white sm:text-2xl lg:text-[32px]">
          See who owns what, at every round.
        </h2>
        <div
          className="mt-3 flex flex-wrap gap-1.5 sm:mt-4"
          role="group"
          aria-label="Funding round"
        >
          {ROUNDS.map((r, i) => (
            <button
              key={r.name}
              type="button"
              aria-pressed={round === i}
              onClick={() => setRound(i)}
              className={cn(
                "relative overflow-hidden rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-400",
                round === i
                  ? "border-ember-500/60 bg-ember-500/20 text-white"
                  : "border-white/15 bg-white/5 text-navy-200 hover:text-white",
              )}
            >
              {r.name}
              {round === i && !reduceMotion && (
                <span
                  key={round}
                  aria-hidden="true"
                  className="ownership-progress"
                  style={{ animationDuration: `${MOVE_MS + HOLD_MS}ms` }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      <figure
        className="relative m-0 flex shrink-0 items-center gap-6 lg:gap-9"
        aria-label="Example ownership by funding round"
      >
        <div
          className="relative size-24 shrink-0 sm:size-44 lg:size-[230px]"
          data-dim={hot !== null ? "true" : undefined}
        >
          <svg
            viewBox="0 0 230 230"
            className="size-full -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="115"
              cy="115"
              r={RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="26"
            />
            {HOLDERS.map((h, i) => (
              <circle
                key={h.name}
                ref={(el) => {
                  segRefs.current[i] = el;
                }}
                className="ownership-seg"
                data-hot={hot === i ? "true" : undefined}
                cx="115"
                cy="115"
                r={RADIUS}
                fill="none"
                stroke={h.color}
                strokeDasharray={`0 ${CIRCUMFERENCE}`}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              ref={totalRef}
              className="text-lg font-semibold tracking-tight sm:text-2xl lg:text-3xl"
            >
              0%
            </span>
            <span className="mt-0.5 hidden font-mono text-[11px] text-navy-300 sm:block lg:text-xs">
              fully diluted
            </span>
          </div>
        </div>

        <ul className="m-0 hidden min-w-[220px] list-none gap-1.5 p-0 sm:grid">
          {HOLDERS.map((h, i) => (
            <li
              key={h.name}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className="ownership-row grid grid-cols-[12px_1fr_auto] items-center gap-2.5 rounded-md px-1.5 py-1 text-sm text-navy-100 transition-colors hover:bg-white/5 hover:text-white"
              style={{ animationDelay: `${150 + i * 110}ms` }}
              onMouseEnter={() => setHot(i)}
              onMouseLeave={() => setHot(null)}
            >
              <span
                className="size-3 rounded-[3px]"
                style={{ background: h.color }}
              />
              <span>{h.name}</span>
              <span
                ref={(el) => {
                  pctRefs.current[i] = el;
                }}
                className="font-mono text-[13px] font-medium tabular-nums text-white"
              >
                0.0%
              </span>
            </li>
          ))}
        </ul>
      </figure>
    </section>
  );
}
