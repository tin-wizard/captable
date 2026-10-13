import { describe, expect, it } from "vitest";
import { analyticsParams } from "./params";

describe("analyticsParams", () => {
  it("reads the kit's URL state", () => {
    expect(
      analyticsParams({
        range: "custom",
        from: "2026-01-01",
        to: "2026-01-31",
        bots: "1",
        status: "returned",
        country: "DE,fr,FR,XXX",
        q: "  ann ",
        cursor: "abc",
      }),
    ).toMatchObject({
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
      includeBots: true,
      viewerStatus: "returned",
      country: ["DE", "FR"],
      search: "ann",
      cursor: "abc",
    });
  });
  it("falls back for junk and takes the first of repeated params", () => {
    const p = analyticsParams({
      range: "forever",
      status: ["x", "y"],
      bots: "0",
    });
    expect(p.range).toBeUndefined();
    expect(p.viewerStatus).toBeUndefined();
    expect(p.includeBots).toBe(false);
    expect(p.country).toBeUndefined();
  });
});
