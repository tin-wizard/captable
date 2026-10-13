import { describe, expect, it } from "vitest";
import { isValidTimezone } from "./timezone";

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects the rest", () => {
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Phobos")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
