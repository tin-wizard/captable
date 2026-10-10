// Framework-free label rules for {label}.<TENANT_BASE_DOMAIN> (extraction-ready).
export const LABEL_MIN = 3;
export const LABEL_MAX = 40;

export const RESERVED_LABELS: ReadonlySet<string> = new Set([
  "www",
  "api",
  "app",
  "auth",
  "login",
  "admin",
  "dashboard",
  "mail",
  "email",
  "smtp",
  "status",
  "docs",
  "help",
  "support",
  "blog",
  "static",
  "assets",
  "cdn",
  "files",
  "uploads",
  "customers",
  "staging",
  "dev",
  "test",
  "demo",
  "internal",
  "dealroom",
  "tin",
  "billing",
  "account",
  "accounts",
  "security",
]);

const LABEL_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export function validateLabel(label: string): "format" | "reserved" | null {
  if (!LABEL_RE.test(label) || label.includes("--")) return "format";
  if (RESERVED_LABELS.has(label)) return "reserved";
  return null;
}

export function suggestLabel(companyName: string): string {
  const slug = companyName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LABEL_MAX)
    .replace(/-+$/, "");
  if (!slug) return "company";
  if (validateLabel(slug) === null) return slug;
  const padded = `${slug.slice(0, LABEL_MAX - 3)}-co`;
  return validateLabel(padded) === null ? padded : "company";
}

export function nextAvailableLabel(
  base: string,
  isTaken: (label: string) => boolean,
): string | null {
  if (!isTaken(base)) return base;
  for (let n = 2; n <= 99; n++) {
    const suffix = `-${n}`;
    const candidate = `${base
      .slice(0, LABEL_MAX - suffix.length)
      .replace(/-+$/, "")}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  return null;
}
