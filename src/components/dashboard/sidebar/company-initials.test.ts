import { describe, expect, it } from "vitest";
import { companyInitials } from "./company-initials";

describe("companyInitials", () => {
  it("takes the first letters of the first two words", () => {
    expect(companyInitials("Lock'd Technologies Ltd")).toBe("LT");
    expect(companyInitials("Konnect")).toBe("K");
    expect(companyInitials("  implexus   inc. ")).toBe("II");
  });
  it("handles empty names and non-latin letters", () => {
    expect(companyInitials("")).toBe("?");
    expect(companyInitials("   ")).toBe("?");
    expect(companyInitials("élan data")).toBe("ÉD");
  });
});
