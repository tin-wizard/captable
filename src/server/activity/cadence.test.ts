import { describe, expect, it } from "vitest";
import { inWorkHours, nextStepWaitDays } from "./cadence";

describe("nextStepWaitDays", () => {
  it("waits 3 days for the first reminder, 4 for the second, never a third", () => {
    expect(nextStepWaitDays(0)).toBe(3);
    expect(nextStepWaitDays(1)).toBe(4);
    expect(nextStepWaitDays(2)).toBeNull();
    expect(nextStepWaitDays(3)).toBeNull();
  });
});

describe("inWorkHours", () => {
  it("is [09:00, 18:00) local", () => {
    expect(inWorkHours(new Date("2026-03-10T09:00:00Z"), "UTC")).toBe(true);
    expect(inWorkHours(new Date("2026-03-10T17:59:00Z"), "UTC")).toBe(true);
    expect(inWorkHours(new Date("2026-03-10T08:59:00Z"), "UTC")).toBe(false);
    expect(inWorkHours(new Date("2026-03-10T18:00:00Z"), "UTC")).toBe(false);
  });

  it("uses the company's zone", () => {
    // 20:00 UTC is 09:00 the next day in Auckland (NZDT, +13)
    const t = new Date("2026-03-10T20:00:00Z");
    expect(inWorkHours(t, "Pacific/Auckland")).toBe(true);
    expect(inWorkHours(t, "UTC")).toBe(false);
  });
});
