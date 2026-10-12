import { describe, expect, it, vi } from "vitest";
import { toGeo } from "./geo";

describe("toGeo", () => {
  it("maps an IPinfo Lite record", () => {
    expect(
      toGeo({ country_code: "CA", asn: "AS64500", as_name: "Example Net Inc" }),
    ).toEqual({ country: "CA", asn: "AS64500", network: "Example Net Inc" });
  });

  it("drops empty values and handles a missing record", () => {
    expect(toGeo({ country_code: "", asn: "AS1" })).toEqual({ asn: "AS1" });
    expect(toGeo(null)).toEqual({});
  });
});

describe("lookupGeo", () => {
  it("returns {} when the database file does not exist", async () => {
    vi.resetModules();
    vi.stubEnv("IPINFO_DB_PATH", "/nonexistent/ipinfo_lite.mmdb");
    const { lookupGeo } = await import("./geo");
    expect(await lookupGeo("203.0.113.9")).toEqual({});
    vi.unstubAllEnvs();
  });
});
