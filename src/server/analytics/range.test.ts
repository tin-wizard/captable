import { describe, expect, it } from "vitest";
import {
  dayBuckets,
  delta,
  localDay,
  localHour,
  localMidnight,
  parseRange,
} from "./range";

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

describe("timezones", () => {
  it("localDay moves a late-UTC instant into the next day east of UTC", () => {
    expect(localDay(new Date("2026-03-10T23:30:00Z"), "Pacific/Auckland")).toBe(
      "2026-03-11",
    );
    expect(localDay(new Date("2026-03-10T23:30:00Z"), "UTC")).toBe(
      "2026-03-10",
    );
    expect(
      localDay(new Date("2026-03-10T03:30:00Z"), "America/Los_Angeles"),
    ).toBe("2026-03-09");
  });
  it("localDay turns over at 18:30 UTC in Kolkata", () => {
    expect(localDay(new Date("2026-03-10T18:29:59.999Z"), "Asia/Kolkata")).toBe(
      "2026-03-10",
    );
    expect(localDay(new Date("2026-03-10T18:30:00Z"), "Asia/Kolkata")).toBe(
      "2026-03-11",
    );
  });
  it("localHour is the integer wall-clock hour", () => {
    const t = new Date("2026-03-10T23:30:00Z");
    expect(localHour(t, "UTC")).toBe(23);
    expect(localHour(t, "Pacific/Auckland")).toBe(12); // +13 in March
    expect(localHour(t, "Asia/Kolkata")).toBe(5);
    expect(localHour(t, "America/Los_Angeles")).toBe(16); // PDT from 8 March
    expect(localHour(new Date("2026-03-10T00:00:00Z"), "UTC")).toBe(0);
  });
  it("dayBuckets has one entry per local day across a DST change", () => {
    const b = dayBuckets(
      new Date("2026-03-05T12:00:00Z"),
      new Date("2026-03-15T12:00:00Z"),
      "America/New_York",
    );
    expect(b).toEqual([...new Set(b)]);
    expect(b[0]).toBe("2026-03-05");
    expect(b.at(-1)).toBe("2026-03-15");
    expect(b).toHaveLength(11);
  });
  it("dayBuckets neither skips nor repeats a day when clocks fall back", () => {
    const b = dayBuckets(
      new Date("2026-04-03T12:00:00Z"),
      new Date("2026-04-07T12:00:00Z"),
      "Pacific/Auckland", // NZDT ends 5 April
    );
    expect(b).toEqual([
      "2026-04-04",
      "2026-04-05",
      "2026-04-06",
      "2026-04-07",
      "2026-04-08",
    ]);
  });
  it("parseRange anchors to local midnight", () => {
    const r = parseRange(
      { range: "7d" },
      new Date("2026-03-10T23:30:00Z"),
      "Pacific/Auckland",
    );
    expect(localDay(r.to, "Pacific/Auckland")).toBe("2026-03-11");
    expect(r.days).toBe(7);
  });
  it("parseRange gives exact local midnights east of UTC (+13)", () => {
    const r = parseRange(
      { range: "7d" },
      new Date("2026-03-10T23:30:00Z"),
      "Pacific/Auckland",
    );
    expect(r.from.toISOString()).toBe("2026-03-04T11:00:00.000Z"); // 5 Mar 00:00 +13
    expect(r.to.toISOString()).toBe("2026-03-11T10:59:59.999Z");
    expect(r.previousTo.getTime()).toBe(r.from.getTime() - 1);
    expect(r.previousFrom.toISOString()).toBe("2026-02-25T11:00:00.000Z");
    expect(dayBuckets(r.from, r.to, "Pacific/Auckland")).toHaveLength(7);
  });
  it("parseRange gives exact local midnights behind UTC", () => {
    const r = parseRange(
      { range: "7d" },
      new Date("2026-03-10T03:30:00Z"),
      "America/Los_Angeles",
    );
    // 3 Mar..9 Mar local; PST (-8) until 8 Mar, PDT (-7) after
    expect(r.from.toISOString()).toBe("2026-03-03T08:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-03-10T06:59:59.999Z");
    expect(r.previousFrom.toISOString()).toBe("2026-02-24T08:00:00.000Z");
    const b = dayBuckets(r.from, r.to, "America/Los_Angeles");
    expect(b).toHaveLength(7);
    expect(b[0]).toBe("2026-03-03");
    expect(b.at(-1)).toBe("2026-03-09");
  });
  it("parseRange gives exact local midnights in a half-hour zone", () => {
    const r = parseRange(
      { range: "custom", from: "2026-03-01", to: "2026-03-10" },
      now,
      "Asia/Kolkata",
    );
    expect(r.from.toISOString()).toBe("2026-02-28T18:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-03-10T18:29:59.999Z");
    expect(r.days).toBe(10);
    expect(r.previousFrom.toISOString()).toBe("2026-02-18T18:30:00.000Z");
  });
  it("swaps a backwards custom range in a timezone", () => {
    const r = parseRange(
      { range: "custom", from: "2026-03-15", to: "2026-03-05" },
      now,
      "America/New_York",
    );
    expect(r.from.toISOString()).toBe("2026-03-05T05:00:00.000Z"); // EST
    expect(r.to.toISOString()).toBe("2026-03-16T03:59:59.999Z"); // EDT
    expect(r.days).toBe(11);
  });
  it("clamps a 400-day custom range in a timezone with one bucket per day", () => {
    const r = parseRange(
      { range: "custom", from: "2024-01-01", to: "2026-10-01" },
      now,
      "America/New_York",
    );
    expect(r.days).toBe(400);
    const b = dayBuckets(r.from, r.to, "America/New_York");
    expect(b).toHaveLength(400);
    expect(new Set(b).size).toBe(400);
    expect(b.at(-1)).toBe("2026-10-01");
    expect(r.to.toISOString()).toBe("2026-10-02T03:59:59.999Z");
  });
  it("starts a day whose midnight DST skips at the first instant that exists", () => {
    // Chile springs forward at 00:00 on 6 Sept 2026: the day starts at 01:00 -03
    expect(localMidnight("2026-09-06", "America/Santiago").toISOString()).toBe(
      "2026-09-06T04:00:00.000Z",
    );
  });
  it("UTC stays the default", () => {
    expect(parseRange({ range: "7d" }, now, "UTC")).toEqual(
      parseRange({ range: "7d" }, now),
    );
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
