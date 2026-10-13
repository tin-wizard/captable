import { describe, expect, it } from "vitest";
import {
  formatDilution,
  latestGuard,
  sortHolders,
  validateRoundInput,
} from "./round-input";

const ok = {
  preMoney: "10,000,000",
  newMoney: "2000000",
  poolTargetPct: "10",
  asOf: "2026-10-13",
};

describe("validateRoundInput", () => {
  it("parses good values; pool percent becomes a ratio", () => {
    expect(validateRoundInput(ok)).toEqual({
      ok: true,
      value: {
        preMoney: 10_000_000,
        newMoney: 2_000_000,
        poolTargetPct: 0.1,
        asOf: "2026-10-13",
      },
    });
  });

  it("treats a blank pool as 0 and a blank date as omitted", () => {
    const r = validateRoundInput({ ...ok, poolTargetPct: "", asOf: "" });
    expect(r).toEqual({
      ok: true,
      value: { preMoney: 10_000_000, newMoney: 2_000_000, poolTargetPct: 0 },
    });
  });

  it.each([
    ["preMoney", { preMoney: "0" }],
    ["preMoney", { preMoney: "-5" }],
    ["preMoney", { preMoney: "abc" }],
    ["newMoney", { newMoney: "-1" }],
    ["poolTargetPct", { poolTargetPct: "50.1" }],
    ["poolTargetPct", { poolTargetPct: "-1" }],
    ["asOf", { asOf: "2026-13-45" }],
    ["asOf", { asOf: "tomorrow" }],
    ["asOf", { asOf: "2026-02-30" }],
    ["poolTargetPct", { poolTargetPct: "50.01" }],
  ])("rejects a bad %s", (field, patch) => {
    const r = validateRoundInput({ ...ok, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field as keyof typeof r.errors]).toBeTruthy();
  });

  it("accepts the boundaries 0 new money and 50 % pool", () => {
    const r = validateRoundInput({ ...ok, newMoney: "0", poolTargetPct: "50" });
    expect(r.ok && r.value.poolTargetPct).toBe(0.5);
  });

  it("an explicit 0 pool gives 0", () => {
    const r = validateRoundInput({ ...ok, poolTargetPct: "0" });
    expect(r.ok && r.value.poolTargetPct).toBe(0);
  });
});

describe("formatDilution", () => {
  it("renders sign, one decimal and pts", () => {
    expect(formatDilution(-2.3)).toBe("-2.3 pts");
    expect(formatDilution(0)).toBe("+0.0 pts");
    expect(formatDilution(1.2)).toBe("+1.2 pts");
  });
  it("rounds first so negative zero never appears", () => {
    expect(formatDilution(-0.04)).toBe("+0.0 pts");
    expect(formatDilution(-0.06)).toBe("-0.1 pts");
  });
});

describe("sortHolders", () => {
  it("sorts people by shares then name, keeps pool and new investors last", () => {
    const r = (id: string | null, name: string, sharesBefore: number) => ({
      stakeholderId: id,
      name,
      sharesBefore,
    });
    const out = sortHolders([
      r(null, "Unallocated pool", 500),
      r("b", "Bea", 100),
      r(null, "New investors", 0),
      r("a", "Al", 100),
      r("c", "Cy", 900),
    ]);
    expect(out.map((x) => x.name)).toEqual([
      "Cy",
      "Al",
      "Bea",
      "Unallocated pool",
      "New investors",
    ]);
  });
});

describe("latestGuard", () => {
  it("an edit or a newer request makes earlier tokens stale", () => {
    const g = latestGuard();
    const first = g.begin();
    expect(g.isCurrent(first)).toBe(true);
    g.invalidate(); // input edited while in flight
    expect(g.isCurrent(first)).toBe(false);
    const second = g.begin();
    const third = g.begin();
    expect(g.isCurrent(second)).toBe(false);
    expect(g.isCurrent(third)).toBe(true);
  });
});
