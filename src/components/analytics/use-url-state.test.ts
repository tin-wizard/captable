import { describe, expect, it } from "vitest";
import { applyPatch, readList, readRange } from "./use-url-state";

const q = (s: string) => new URLSearchParams(s);

describe("readRange", () => {
  it("defaults to 30d and ignores unknown values", () => {
    expect(readRange(q(""))).toEqual({ range: "30d" });
    expect(readRange(q("range=bogus"))).toEqual({ range: "30d" });
  });
  it("reads custom from/to only for custom", () => {
    expect(readRange(q("range=7d&from=2026-01-01"))).toEqual({ range: "7d" });
    expect(readRange(q("range=custom&from=2026-01-01&to=2026-01-31"))).toEqual({
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });
});

describe("applyPatch", () => {
  it("keeps unknown params and removes empty values", () => {
    const out = applyPatch(q("a=1&country=DE"), {
      country: null,
      status: "opened",
    });
    expect(out.get("a")).toBe("1");
    expect(out.has("country")).toBe(false);
    expect(out.get("status")).toBe("opened");
  });
  it("drops the cursor when a filter changes but not when only the cursor does", () => {
    expect(
      applyPatch(q("cursor=x&status=a"), { status: "b" }).has("cursor"),
    ).toBe(false);
    expect(applyPatch(q("status=a"), { cursor: "x" }).get("cursor")).toBe("x");
  });
  it("round trips lists", () => {
    const out = applyPatch(q(""), { country: ["DE", "FR"] });
    expect(readList(out, "country")).toEqual(["DE", "FR"]);
    expect(readList(q(""), "country")).toEqual([]);
  });
});
