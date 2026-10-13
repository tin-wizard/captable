import { describe, expect, it } from "vitest";
import { dayBuckets, delta, parseRange } from "./range";

const now = new Date("2026-10-13T10:00:00Z");
const DAY = 86_400_000;

describe("parseRange", () => {
  it("defaults to 30 days ending at end of today (UTC)", () => {
    const r = parseRange({}, now);
    expect(r.days).toBe(30);
    expect(r.to.toISOString()).toBe("2026-10-13T23:59:59.999Z");
    expect(r.from.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });
  it("supports 7d and 90d", () => {
    expect(parseRange({ range: "7d" }, now).days).toBe(7);
    expect(parseRange({ range: "90d" }, now).days).toBe(90);
  });
  it("swaps a custom range given backwards", () => {
    const r = parseRange(
      { range: "custom", from: "2026-10-10", to: "2026-10-01" },
      now,
    );
    expect(r.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-10T23:59:59.999Z");
    expect(r.days).toBe(10);
  });
  it("clamps custom ranges to 400 days, keeping the end", () => {
    const r = parseRange(
      { range: "custom", from: "2020-01-01", to: "2026-10-01" },
      now,
    );
    expect(r.days).toBe(400);
    expect(r.to.toISOString()).toBe("2026-10-01T23:59:59.999Z");
  });
  it("falls back to the default on invalid dates", () => {
    expect(
      parseRange({ range: "custom", from: "nope", to: "2026-10-01" }, now).days,
    ).toBe(30);
    expect(
      parseRange({ range: "custom", from: "2026-02-31", to: "2026-03-05" }, now)
        .days,
    ).toBe(30);
    expect(
      parseRange({ range: "custom", from: "10/01/2026", to: "10/05/2026" }, now)
        .days,
    ).toBe(30);
  });
  it("accepts full ISO strings", () => {
    const r = parseRange(
      {
        range: "custom",
        from: "2026-10-01T15:00:00Z",
        to: "2026-10-03T01:00:00Z",
      },
      now,
    );
    expect(r.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(r.days).toBe(3);
  });
  it("previous period has equal length and ends right before from", () => {
    const r = parseRange({ range: "7d" }, now);
    expect(r.previousTo.getTime()).toBe(r.from.getTime() - 1);
    expect(r.previousTo.getTime() - r.previousFrom.getTime() + 1).toBe(
      r.to.getTime() - r.from.getTime() + 1,
    );
    expect(r.previousFrom.getTime()).toBe(r.from.getTime() - 7 * DAY);
  });
});

describe("dayBuckets", () => {
  it("is inclusive of both ends and as long as days", () => {
    const r = parseRange({ range: "7d" }, now);
    const b = dayBuckets(r.from, r.to);
    expect(b).toHaveLength(7);
    expect(b[0]).toBe("2026-10-07");
    expect(b[6]).toBe("2026-10-13");
  });
  it("returns one bucket for a single day", () => {
    const d = new Date("2026-10-13T05:00:00Z");
    expect(dayBuckets(d, d)).toEqual(["2026-10-13"]);
  });
});

describe("delta", () => {
  it.each([
    [0, 0, null, "flat"],
    [0, 5, null, "up"],
    [10, 5, -50, "down"],
    [5, 10, 100, "up"],
    [5, 5, 0, "flat"],
  ] as const)("%s vs %s", (previous, current, pct, direction) => {
    // note: args are (current, previous)
    expect(delta(current, previous)).toEqual({ pct, direction });
  });
});
