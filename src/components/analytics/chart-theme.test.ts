import { describe, expect, it } from "vitest";
import { formatMoney } from "./chart-theme";

describe("formatMoney", () => {
  it("drops a trailing .0 and keeps one decimal when it matters", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(150_000)).toBe("$150K");
    expect(formatMoney(800_000)).toBe("$800K");
    expect(formatMoney(3_100_000)).toBe("$3.1M");
    expect(formatMoney(2_400_000)).toBe("$2.4M");
  });
});
