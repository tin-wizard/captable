import { describe, expect, it } from "vitest";
import {
  cnameRecord,
  domainStatusLabel,
  txtRecord,
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
});
