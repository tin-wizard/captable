import { describe, expect, it } from "vitest";
import { engagement } from "./engagement";

describe("engagement", () => {
  it.each([
    [
      { activeSeconds: 0, visits: 1, pagesReached: 0, pagesTotal: 10 },
      0,
      "cold",
    ],
    [
      { activeSeconds: 300, visits: 3, pagesReached: 10, pagesTotal: 10 },
      100,
      "hot",
    ],
    // unknown pagesTotal: coverage falls back to time, single visit
    [
      { activeSeconds: 300, visits: 1, pagesReached: 0, pagesTotal: null },
      70,
      "hot",
    ],
    [
      { activeSeconds: 150, visits: 1, pagesReached: 0, pagesTotal: null },
      35,
      "warm",
    ],
    [
      { activeSeconds: 60, visits: 1, pagesReached: 0, pagesTotal: null },
      14,
      "cold",
    ],
    // caps
    [
      { activeSeconds: 9999, visits: 99, pagesReached: 50, pagesTotal: 10 },
      100,
      "hot",
    ],
    // zero pages total behaves like unknown, zero visits does not go negative
    [
      { activeSeconds: 0, visits: 0, pagesReached: 0, pagesTotal: 0 },
      0,
      "cold",
    ],
  ] as const)("%j", (input, score, label) => {
    expect(engagement(input)).toEqual({ score, label });
  });
});
