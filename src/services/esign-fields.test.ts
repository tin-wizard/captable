import { describe, expect, it } from "vitest";
import { signerFieldValues } from "./esign-fields";

const f = (
  id: string,
  recipientId: string,
  extra: Partial<{
    readOnly: boolean;
    prefilledValue: string | null;
    defaultValue: string;
  }> = {},
) => ({
  id,
  recipientId,
  readOnly: false,
  prefilledValue: null,
  defaultValue: "",
  ...extra,
});

describe("signerFieldValues", () => {
  const fields = [
    f("mine", "r1"),
    f("theirs", "r2", { prefilledValue: "their-signature" }),
    f("sender", "r1", { readOnly: true, defaultValue: "ACME Ltd" }),
    f("senderPrefilled", "r2", {
      readOnly: true,
      prefilledValue: "2026-10-11",
    }),
  ];

  it("keeps the signer's own fields and drops everyone else's", () => {
    expect(
      signerFieldValues(fields, "r1", {
        mine: "sig",
        theirs: "forged",
        sender: "forged",
      }),
    ).toEqual({
      mine: "sig",
      sender: "ACME Ltd",
      senderPrefilled: "2026-10-11",
    });
  });

  it("ignores ids that are not fields of this envelope", () => {
    expect(signerFieldValues(fields, "r1", { nope: "x" })).toEqual({
      sender: "ACME Ltd",
      senderPrefilled: "2026-10-11",
    });
  });
});
