import { describe, expect, it } from "vitest";
import {
  classifyHost,
  companySwitchUrl,
  normalizeHost,
  safeNextPath,
} from "./host";

const cfg = {
  canonicalHost: "dealroom.tin.info",
  baseDomain: "dealroom.tin.info",
  enabled: true,
};

describe("normalizeHost", () => {
  it.each([
    ["Botski.Dealroom.Tin.Info", "botski.dealroom.tin.info"],
    ["botski.dealroom.tin.info:443", "botski.dealroom.tin.info"],
    ["botski.dealroom.tin.info.", "botski.dealroom.tin.info"],
  ])("%s -> %s", (a, b) => expect(normalizeHost(a)).toBe(b));
  it.each([null, "", "bad host", "a..b", "evil.com/path", "[::1]"])(
    "rejects %s",
    (h) => expect(normalizeHost(h)).toBeNull(),
  );
});

describe("classifyHost", () => {
  it("canonical", () =>
    expect(classifyHost("dealroom.tin.info", cfg)).toEqual({
      kind: "canonical",
    }));
  it("platform", () =>
    expect(classifyHost("botski.dealroom.tin.info", cfg)).toEqual({
      kind: "platform",
      hostname: "botski.dealroom.tin.info",
      label: "botski",
    }));
  it("two levels deep is invalid", () =>
    expect(classifyHost("a.b.dealroom.tin.info", cfg)).toEqual({
      kind: "invalid",
    }));
  it("sibling tin.info hosts are custom (resolved only if registered)", () =>
    expect(classifyHost("mattermost.tin.info", cfg)).toEqual({
      kind: "custom",
      hostname: "mattermost.tin.info",
    }));
  it("flag off: every host is canonical", () =>
    expect(
      classifyHost("botski.dealroom.tin.info", { ...cfg, enabled: false }),
    ).toEqual({
      kind: "canonical",
    }));
  it("dev: botski.localhost under base localhost", () =>
    expect(
      classifyHost("botski.localhost:3000", {
        canonicalHost: "localhost",
        baseDomain: "localhost",
        enabled: true,
      }),
    ).toEqual({
      kind: "platform",
      hostname: "botski.localhost",
      label: "botski",
    }));
});

describe("safeNextPath", () => {
  it.each([
    ["/abc/settings", "/abc/settings"],
    ["/abc?x=1#y", "/abc?x=1#y"],
    ["https://evil.com", "/"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
    ["javascript:alert(1)", "/"],
    [null, "/"],
    // Extra adversarial rows: none may resolve to another origin.
    ["/\t/evil.com", "/"],
    ["/%5Cevil.com", "/%5Cevil.com"],
    ["\\evil.com", "/"],
    ["/ /evil", "/%20/evil"],
    ["/.//evil.com", "/"],
    ["/..//evil.com", "/"],
    ["/a/..//evil.com", "/"],
    ["/%2e//evil.com", "/"],
    ["/%2e%2e//evil.com", "/"],
    [undefined, "/"],
    ["", "/"],
  ])("%s -> %s", (a, b) => expect(safeNextPath(a)).toBe(b));
});

describe("companySwitchUrl", () => {
  const canon = "https://dealroom.tin.info";
  it.each<[string, string | null, string]>([
    // company host, target has no primary: go via canonical, not this host
    ["/pubB", canon, "https://dealroom.tin.info/pubB"],
    // company host, target has a primary: absolute URL kept
    [
      "https://b.dealroom.tin.info/pubB",
      canon,
      "https://b.dealroom.tin.info/pubB",
    ],
    // canonical (null): unchanged
    ["/pubB", null, "/pubB"],
    [
      "https://b.dealroom.tin.info/pubB",
      null,
      "https://b.dealroom.tin.info/pubB",
    ],
  ])("%s from %s -> %s", (url, origin, out) =>
    expect(companySwitchUrl(url, origin)).toBe(out),
  );
});
