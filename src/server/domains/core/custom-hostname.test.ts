import { describe, expect, it } from "vitest";
import { normalizeCustomHostname } from "./custom-hostname";

const cfg = {
  canonicalHost: "dealroom.tin.info",
  baseDomain: "dealroom.tin.info",
};
const ok = (raw: string) => normalizeCustomHostname(raw, cfg);

describe("normalizeCustomHostname", () => {
  it("accepts a plain subdomain and a pasted URL", () => {
    expect(ok("investors.implexus.io")).toEqual({
      ok: true,
      hostname: "investors.implexus.io",
    });
    expect(ok("  HTTPS://Investors.Implexus.io/path?x=1 ")).toEqual({
      ok: true,
      hostname: "investors.implexus.io",
    });
    expect(ok("implexus.io")).toEqual({ ok: true, hostname: "implexus.io" });
  });
  it("accepts punycode labels", () => {
    expect(ok("xn--bcher-kva.example.com")).toMatchObject({ ok: true });
  });
  it("refuses the platform domain and anything under it", () => {
    for (const h of [
      "dealroom.tin.info",
      "acme.dealroom.tin.info",
      "a.b.dealroom.tin.info",
    ])
      expect(ok(h)).toEqual({ ok: false, reason: "platform" });
  });
  it("refuses empty and badly formed input", () => {
    expect(ok("")).toEqual({ ok: false, reason: "empty" });
    for (const bad of [
      "localhost",
      "a.localhost",
      "10.0.0.1",
      "1.2.3.4",
      "[::1]",
      "a_b.example.com",
      "exa mple.com",
      "example.com:8080",
      "example.com.",
      "-a.example.com",
      "a..example.com",
      "bücher.example.com",
      "a.b",
      `${"x".repeat(64)}.com`,
      "example.internal",
      "example.local",
    ])
      expect(ok(bad), bad).toEqual({ ok: false, reason: "format" });
  });
});
