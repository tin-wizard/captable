import { describe, expect, it } from "vitest";
import { assertLocalTestDb } from "./setup";

describe("assertLocalTestDb", () => {
  it("accepts localhost", () => {
    expect(() =>
      assertLocalTestDb("postgres://u:p@localhost:54331/captable_test"),
    ).not.toThrow();
  });

  it("rejects Neon and any remote host", () => {
    expect(() =>
      assertLocalTestDb("postgres://u:p@ep-x.neon.tech/neondb"),
    ).toThrow();
    expect(() => assertLocalTestDb(undefined)).toThrow();
  });
});
