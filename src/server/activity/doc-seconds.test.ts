import { describe, expect, it } from "vitest";
import { mergeDocSeconds } from "./doc-seconds";

describe("mergeDocSeconds", () => {
  it("only ever raises values and clamps to the ceiling", () => {
    const a = { b1: { n: 10, p: { "1": 5, "2": 3 } } };
    const out = mergeDocSeconds(
      a,
      { b1: { n: 10, p: { "1": 2, "2": 900, "3": 4 } } },
      60,
    );
    expect(out.b1?.p).toEqual({ "1": 5, "2": 60, "3": 4 });
  });
  it("keeps the largest page count seen and ignores a page beyond n", () => {
    const out = mergeDocSeconds(
      { b1: { n: 3, p: {} } },
      { b1: { n: 5, p: { "9": 4, "5": 1 } } },
      60,
    );
    expect(out.b1?.n).toBe(5);
    expect(out.b1?.p).toEqual({ "5": 1 });
  });
  it("caps documents per visit at 20", () => {
    const inc = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`b${i}`, { n: 2, p: { "1": 1 } }]),
    );
    expect(Object.keys(mergeDocSeconds({}, inc, 60))).toHaveLength(20);
  });
  it("caps pages per document at 500 and drops malformed page keys", () => {
    const p = Object.fromEntries(
      Array.from({ length: 600 }, (_, i) => [String(i + 1), 1]),
    );
    const out = mergeDocSeconds(
      {},
      { b1: { n: 1000, p: { ...p, "0": 1, x: 1 } } },
      60,
    );
    expect(Object.keys(out.b1?.p ?? {})).toHaveLength(500);
    expect(out.b1?.p).not.toHaveProperty("0");
    expect(out.b1?.p).not.toHaveProperty("x");
  });
  it("does not mutate the stored value", () => {
    const stored = { b1: { n: 2, p: { "1": 1 } } };
    mergeDocSeconds(stored, { b1: { n: 2, p: { "1": 9, "2": 3 } } }, 60);
    expect(stored).toEqual({ b1: { n: 2, p: { "1": 1 } } });
  });
});
