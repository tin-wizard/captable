import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

const cols = [{ key: "a", label: "A" }];
const body = (v: string | number | null | Date) =>
  toCsv([{ a: v }], cols)
    .slice(1)
    .split("\r\n")[1] ?? "";

describe("toCsv", () => {
  it("starts with BOM, uses CRLF and ends with CRLF", () => {
    const out = toCsv([{ a: "x" }], cols);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe("﻿A\r\nx\r\n");
  });
  it("quotes commas, newlines and doubles quotes", () => {
    expect(body("a,b")).toBe('"a,b"');
    expect(body("a\nb")).toBe('"a\nb"');
    expect(body('say "hi"')).toBe('"say ""hi"""');
  });
  it.each(["=cmd", "+1", "-1", "@x", "\tx", "\rx"])("neutralises %j", (v) => {
    expect(body(v).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
  });
  it("leaves number values untouched, including negatives", () => {
    expect(body(-5)).toBe("-5");
    expect(body(3.5)).toBe("3.5");
  });
  it("writes null as empty and Date as ISO", () => {
    expect(body(null)).toBe("");
    expect(body(new Date("2026-10-13T10:00:00Z"))).toBe(
      "2026-10-13T10:00:00.000Z",
    );
  });
  it("uses labels as header and orders by columns", () => {
    const out = toCsv(
      [{ a: 1, b: "x" }],
      [
        { key: "b", label: "B, label" },
        { key: "a", label: "A" },
      ],
    );
    expect(out).toBe('﻿"B, label",A\r\nx,1\r\n');
  });
});
