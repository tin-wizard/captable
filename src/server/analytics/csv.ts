const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number | null | Date): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// UTF-8 BOM so Excel detects the encoding; CRLF per RFC 4180.
export function toCsv(
  rows: Record<string, string | number | null | Date>[],
  columns: { key: string; label: string }[],
): string {
  const header = columns.map((c) => cell(c.label)).join(",");
  const lines = rows.map((r) =>
    columns.map((c) => cell(r[c.key] ?? null)).join(","),
  );
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
}
