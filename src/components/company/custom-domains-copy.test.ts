import { describe, expect, it } from "vitest";
import {
  aRecordNote,
  canMakePrimary,
  cnameRecord,
  currentPlatformRow,
  domainStatusLabel,
  finishSetupHint,
  makePrimaryDialogCopy,
  removeDialogCopy,
  txtRecord,
  verifiedCopy,
} from "./custom-domains-copy";

describe("custom domain copy helpers", () => {
  it("builds the TXT challenge record", () => {
    expect(txtRecord("investors.acme.com", "tok123")).toEqual({
      name: "_dealroom-challenge.investors.acme.com",
      value: "tok123",
    });
  });

  it("builds the CNAME record", () => {
    expect(cnameRecord("investors.acme.com", "app.dealroom.test")).toEqual({
      name: "investors.acme.com",
      value: "app.dealroom.test",
    });
  });

  it("labels rows by status", () => {
    expect(domainStatusLabel({ status: "ACTIVE", isPrimary: true })).toBe(
      "Primary",
    );
    expect(domainStatusLabel({ status: "ALIAS", isPrimary: false })).toBe(
      "Redirects to primary",
    );
    expect(domainStatusLabel({ status: "ACTIVE", isPrimary: false })).toBe(
      "Redirects to primary",
    );
    expect(domainStatusLabel({ status: "PENDING", isPrimary: false })).toBe(
      "Pending verification",
    );
    // an expiring alias says until when
    expect(
      domainStatusLabel(
        {
          status: "ALIAS",
          isPrimary: false,
          aliasExpiresAt: new Date("2026-11-13T00:00:00Z"),
        },
        (d) => d.toISOString().slice(0, 10),
      ),
    ).toBe("Redirects until 2026-11-13");
    expect(
      domainStatusLabel({
        status: "ALIAS",
        isPrimary: false,
        aliasExpiresAt: null,
      }),
    ).toBe("Redirects to primary");
  });

  const row = (o: object) => ({
    hostname: "i.acme.com",
    kind: "CUSTOM" as const,
    status: "ACTIVE" as const,
    isPrimary: false,
    aliasExpiresAt: null,
    ...o,
  });

  it("only promotable rows can be made primary", () => {
    expect(canMakePrimary(row({}))).toBe(true);
    expect(canMakePrimary(row({ isPrimary: true }))).toBe(false);
    expect(canMakePrimary(row({ status: "PENDING" }))).toBe(false);
    expect(canMakePrimary(row({ kind: "PLATFORM", status: "ALIAS" }))).toBe(
      true,
    );
    expect(
      canMakePrimary(
        row({ kind: "PLATFORM", status: "ALIAS", aliasExpiresAt: new Date() }),
      ),
    ).toBe(false);
    // a custom alias is promotable until its expiry has passed
    const now = new Date("2026-10-14T12:00:00Z");
    const later = new Date("2026-11-13T12:00:00Z");
    expect(
      canMakePrimary(row({ status: "ALIAS", aliasExpiresAt: later }), now),
    ).toBe(true);
    expect(
      canMakePrimary(row({ status: "ALIAS", aliasExpiresAt: now }), later),
    ).toBe(false);
    expect(canMakePrimary(row({ status: "ALIAS" }), later)).toBe(true);
  });

  it("finds the current platform row, never an expiring rename alias", () => {
    const old = row({
      hostname: "old.d.io",
      kind: "PLATFORM",
      status: "ALIAS",
      aliasExpiresAt: new Date(),
    });
    const cur = row({
      hostname: "cur.d.io",
      kind: "PLATFORM",
      status: "ALIAS",
    });
    const custom = row({ isPrimary: true });
    expect(currentPlatformRow([old, cur, custom])?.hostname).toBe("cur.d.io");
    expect(
      currentPlatformRow([old, row({ hostname: "a.d.io", kind: "PLATFORM" })])
        ?.hostname,
    ).toBe("a.d.io");
    expect(currentPlatformRow([old, custom])).toBeUndefined();
  });

  it("hints to open a verified, not yet primary custom domain", () => {
    expect(finishSetupHint(row({ status: "ALIAS" }))).toBe(
      "Open i.acme.com to finish setup, then make it primary",
    );
    for (const r of [
      row({ status: "PENDING" }),
      row({ isPrimary: true }),
      row({ status: "ALIAS", aliasExpiresAt: new Date() }),
      row({ kind: "PLATFORM", status: "ALIAS" }),
    ])
      expect(finishSetupHint(r)).toBeNull();
  });

  it("dialog and toast copy", () => {
    expect(makePrimaryDialogCopy({ target: "b.com", current: "a.com" })).toBe(
      "a.com will redirect to b.com.",
    );
    // back to the platform address: the custom primary only redirects for a while
    expect(
      makePrimaryDialogCopy({
        target: "x.dealroom.tin.info",
        current: "i.acme.com",
        expiresInDays: 30,
      }),
    ).toBe("i.acme.com will redirect for 30 days, then stop working.");
    expect(removeDialogCopy(row({ status: "PENDING" }))).toBe(
      "Discard this setup. Nothing changes for visitors.",
    );
    expect(removeDialogCopy(row({ status: "ALIAS" }))).toBe(
      "i.acme.com will stop working.",
    );
    expect(
      removeDialogCopy(row({ isPrimary: true }), "x.dealroom.tin.info"),
    ).toBe(
      "i.acme.com will stop working and x.dealroom.tin.info becomes your address.",
    );
    expect(verifiedCopy("i.acme.com")).toBe(
      "i.acme.com is verified. Open https://i.acme.com once to finish setup, then choose Make primary.",
    );
    expect(aRecordNote(["1.2.3.4"])).toContain("1.2.3.4");
    expect(aRecordNote([])).toContain("Ask support");
  });
});
