import { describe, expect, it } from "vitest";
import { countryName, formatDuration, topPages } from "./format";

describe("formatDuration", () => {
  it("renders m:ss", () => {
    expect(formatDuration(72)).toBe("1:12");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(3600)).toBe("60:00");
  });
  it("is a dash for zero or invalid", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-3)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("topPages", () => {
  it("returns the top n pages by seconds", () => {
    expect(topPages({ "1": 5, "3": 72, "2": 30, "4": 10 }, 3)).toEqual([
      { page: "3", seconds: 72 },
      { page: "2", seconds: 30 },
      { page: "4", seconds: 10 },
    ]);
  });
  it("drops non-positive entries and handles empty", () => {
    expect(topPages({ "1": 0 }, 3)).toEqual([]);
    expect(topPages({}, 3)).toEqual([]);
  });
});

describe("countryName", () => {
  it("names a valid code", () => {
    expect(countryName("US")).toBe("United States");
  });
  it("falls back for null or invalid codes", () => {
    expect(countryName(null)).toBeNull();
    expect(countryName("not a code")).toBe("not a code");
  });
});
