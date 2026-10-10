import { describe, expect, it } from "vitest";
import { nextAvailableLabel, suggestLabel, validateLabel } from "./subdomain";

describe("validateLabel", () => {
  it.each(["botski", "cls", "acme-capital", "a1b2c3"])("accepts %s", (l) =>
    expect(validateLabel(l)).toBeNull(),
  );
  it.each([
    "ab",
    "-abc",
    "abc-",
    "a--b",
    "xn--abc",
    "Botski",
    "bo_ski",
    "a".repeat(41),
    "",
  ])("rejects %s as format", (l) => expect(validateLabel(l)).toBe("format"));
  it.each([
    "www",
    "api",
    "app",
    "auth",
    "admin",
    "customers",
    "staging",
    "mail",
    "status",
    "docs",
  ])("rejects %s as reserved", (l) =>
    expect(validateLabel(l)).toBe("reserved"),
  );
});

describe("suggestLabel", () => {
  it.each([
    ["Botski", "botski"],
    ["CLS", "cls"],
    ["Konnect GmbH & Co. KG", "konnect-gmbh-co-kg"],
    ["Café Zürich", "cafe-zurich"],
    ["A", "a-co"],
    ["API", "api-co"],
    ["日本株式会社", "company"],
    ["   ", "company"],
  ])("%s -> %s", (name, label) => {
    expect(suggestLabel(name)).toBe(label);
    expect(validateLabel(suggestLabel(name))).toBeNull();
  });
  it("cuts long names to 40 characters without a trailing hyphen", () => {
    const s = suggestLabel("Very Long Company Name ".repeat(5));
    expect(s.length).toBeLessThanOrEqual(40);
    expect(validateLabel(s)).toBeNull();
  });
});

describe("nextAvailableLabel", () => {
  it("returns the base when free, else the first free suffix", () => {
    expect(nextAvailableLabel("botski", () => false)).toBe("botski");
    const taken = new Set(["botski", "botski-2"]);
    expect(nextAvailableLabel("botski", (l) => taken.has(l))).toBe("botski-3");
  });
  it("keeps suffixed labels within 40 characters", () => {
    const base = "a".repeat(40);
    expect(nextAvailableLabel(base, (l) => l === base)).toBe(
      `${"a".repeat(38)}-2`,
    );
  });
  it("gives up after -99", () => {
    expect(nextAvailableLabel("x-co", () => true)).toBeNull();
  });
});
