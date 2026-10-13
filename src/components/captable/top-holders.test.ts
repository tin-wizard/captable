import { describe, expect, it } from "vitest";
import { topHolders } from "./top-holders";

const holders = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `H${i + 1}`,
    shares: (n - i) * 100,
  }));

describe("topHolders", () => {
  it("returns the top 10 plus Others, percentages summing to 1", () => {
    const hs = holders(14);
    const total = hs.reduce((s, h) => s + h.shares, 0);
    const out = topHolders(hs, total);
    expect(out).toHaveLength(11);
    expect(out[0]?.name).toBe("H1");
    const others = out.at(-1);
    expect(others?.name).toBe("Others");
    expect(others?.shares).toBe(400 + 300 + 200 + 100);
    expect(out.reduce((s, h) => s + h.pct, 0)).toBeCloseTo(1, 10);
  });

  it("has no Others row for 10 or fewer holders", () => {
    const hs = holders(10);
    const total = hs.reduce((s, h) => s + h.shares, 0);
    const out = topHolders(hs, total);
    expect(out).toHaveLength(10);
    expect(out.some((h) => h.name === "Others")).toBe(false);
    expect(out.reduce((s, h) => s + h.pct, 0)).toBeCloseTo(1, 10);
  });

  it("puts shares outside the given holders under Others and handles zero", () => {
    const out = topHolders([{ name: "A", shares: 50 }], 200);
    expect(out.map((h) => h.pct)).toEqual([0.25, 0.75]);
    expect(topHolders([], 0)).toEqual([]);
  });
});
