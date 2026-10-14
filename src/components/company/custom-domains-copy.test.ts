import { describe, expect, it } from "vitest";
import {
  aRecordNote,
  canMakePrimary,
  cnameRecord,
  domainStatusLabel,
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
  });

  it("dialog and toast copy", () => {
    expect(makePrimaryDialogCopy("b.com", "a.com")).toBe(
      "a.com will redirect to b.com.",
    );
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
    expect(verifiedCopy("i.acme.com", "x.d.io")).toBe(
      "i.acme.com is verified and is now your address. x.d.io redirects to it.",
    );
    expect(aRecordNote(["1.2.3.4"])).toContain("1.2.3.4");
    expect(aRecordNote([])).toContain("Ask support");
  });
});
