import { describe, expect, it } from "vitest";
import { type RoundInput, modelRound } from "./proforma";

const base = { existingUnallocatedPool: 0, poolTargetPct: 0, convertibles: [] };

describe("modelRound", () => {
  it("A: no convertibles, no pool", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 10_000_000,
      preMoney: 10_000_000,
      newMoney: 2_000_000,
    });
    expect(r.price).toBeCloseTo(1, 6);
    expect(r.newInvestorShares).toBeCloseTo(2_000_000, 0);
    expect(r.postFD).toBeCloseTo(12_000_000, 0);
    expect(r.postMoney).toBeCloseTo(12_000_000, 0);
    expect(r.newInvestorPct).toBeCloseTo(2 / 12, 6);
    expect(r.existing.pctAfter).toBeCloseTo(10 / 12, 6);
  });

  it("B: 10% post-money pool top-up", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 10_000_000,
      preMoney: 10_000_000,
      newMoney: 2_000_000,
      poolTargetPct: 0.1,
    });
    expect(r.price).toBeCloseTo(0.88, 6);
    expect(r.newInvestorShares).toBeCloseTo(2_272_727.27, 0);
    expect(r.postFD).toBeCloseTo(13_636_363.64, 0);
    expect(r.poolTopUpShares).toBeCloseTo(1_363_636.36, 0);
    expect(r.postMoney).toBeCloseTo(12_000_000, 0);
  });

  it("C: one post-money SAFE at its cap", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 9_500_000,
      preMoney: 20_000_000,
      newMoney: 4_000_000,
      convertibles: [
        {
          id: "s1",
          holder: "Angel",
          kind: "SAFE",
          type: "POST_MONEY",
          capital: 500_000,
          cap: 5_000_000,
          discount: null,
        },
      ],
    });
    expect(r.conversions[0]).toMatchObject({ bound: "cap" });
    expect(r.conversions[0]?.shares).toBeCloseTo(1_055_555.56, 0);
    expect(r.price).toBeCloseTo(1.894737, 5);
    expect(r.postFD).toBeCloseTo(12_666_666.67, 0);
    expect(r.conversions[0]?.pctPost).toBeCloseTo(
      1_055_555.56 / 12_666_666.67,
      5,
    );
    expect(r.postMoney).toBeCloseTo(24_000_000, 0);
  });

  it("D: discount only, 20 %", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 10_000_000,
      preMoney: 10_000_000,
      newMoney: 1_000_000,
      convertibles: [
        {
          id: "s1",
          holder: "Angel",
          kind: "SAFE",
          type: "PRE_MONEY",
          capital: 100_000,
          cap: null,
          discount: 0.2,
        },
      ],
    });
    expect(r.conversions[0]).toMatchObject({ bound: "discount" });
    expect(r.price).toBeCloseTo(0.9875, 6);
    expect(r.conversions[0]?.price).toBeCloseTo(0.79, 6);
    expect(r.conversions[0]?.shares).toBeCloseTo(126_582.28, 0);
    expect(r.postFD).toBeCloseTo(11_139_240.5, 0);
  });

  it("E: a cap far above the round never converts above the round price", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 10_000_000,
      preMoney: 10_000_000,
      newMoney: 1_000_000,
      convertibles: [
        {
          id: "s1",
          holder: "Angel",
          kind: "SAFE",
          type: "PRE_MONEY",
          capital: 100_000,
          cap: 100_000_000,
          discount: null,
        },
      ],
    });
    expect(r.conversions[0]).toMatchObject({ bound: "round" });
    expect(r.conversions[0]?.price).toBeCloseTo(r.price, 9);
  });

  it("F: a note adds simple interest to what converts", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 10_000_000,
      preMoney: 10_000_000,
      newMoney: 1_000_000,
      convertibles: [
        {
          id: "n1",
          holder: "Lender",
          kind: "NOTE",
          type: "PRE_MONEY",
          capital: 100_000,
          interest: 8_000,
          cap: null,
          discount: null,
        },
      ],
    });
    expect(r.conversions[0]?.amount).toBe(108_000);
  });

  it("G: refuses to divide by zero and reports non-convergence", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 0,
      preMoney: 1_000_000,
      newMoney: 100_000,
    });
    expect(r.converged).toBe(false);
  });

  it("H: large numbers stay finite and ordered", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 1_000_000_000,
      preMoney: 10_000_000_000,
      newMoney: 1_000_000_000,
    });
    expect(r.price).toBeCloseTo(10, 6);
    expect(r.newInvestorShares).toBeCloseTo(100_000_000, 0);
  });

  it("guards: zero/negative/non-finite inputs give finite zeroed numbers", () => {
    const cases: RoundInput[] = [
      { ...base, preRoundFD: 0, preMoney: 1_000_000, newMoney: 100_000 },
      { ...base, preRoundFD: 10, preMoney: 0, newMoney: 100_000 },
      { ...base, preRoundFD: 10, preMoney: -5, newMoney: 100_000 },
      { ...base, preRoundFD: Number.NaN, preMoney: 1_000, newMoney: 100 },
      {
        ...base,
        preRoundFD: 10,
        preMoney: Number.POSITIVE_INFINITY,
        newMoney: 100,
      },
    ];
    for (const input of cases) {
      const r = modelRound(input);
      expect(r.converged).toBe(false);
      const nums = [
        r.price,
        r.postMoney,
        r.postFD,
        r.newInvestorShares,
        r.poolTopUpShares,
        r.newInvestorPct,
        r.existing.shares,
        r.existing.pctBefore,
        r.existing.pctAfter,
      ];
      for (const n of nums) expect(n).toBe(0);
    }
  });

  it("null or non-positive cap and discount mean the round price", () => {
    const r = modelRound({
      ...base,
      preRoundFD: 10_000_000,
      preMoney: 10_000_000,
      newMoney: 1_000_000,
      convertibles: [
        {
          id: "s1",
          holder: "A",
          kind: "SAFE",
          type: "POST_MONEY",
          capital: 100_000,
          cap: 0,
          discount: -0.1,
        },
      ],
    });
    expect(r.converged).toBe(true);
    expect(r.conversions[0]).toMatchObject({ bound: "round" });
    expect(r.conversions[0]?.price).toBeCloseTo(r.price, 9);
  });

  it("does not mutate its input", () => {
    const input: RoundInput = {
      preRoundFD: 9_500_000,
      existingUnallocatedPool: 500_000,
      preMoney: 20_000_000,
      newMoney: 4_000_000,
      poolTargetPct: 0.1,
      convertibles: [
        {
          id: "s1",
          holder: "Angel",
          kind: "SAFE",
          type: "POST_MONEY",
          capital: 500_000,
          cap: 5_000_000,
          discount: 0.2,
        },
      ],
    };
    const copy = structuredClone(input);
    modelRound(input);
    expect(input).toEqual(copy);
  });
});
