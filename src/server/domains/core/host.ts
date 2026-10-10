// Pure: imported by proxy.ts and client components, so no Node/Next/Prisma imports.
const HOST_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function normalizeHost(raw: string | null): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return HOST_RE.test(host) ? host : null;
}

export type HostClass =
  | { kind: "canonical" }
  | { kind: "platform"; hostname: string; label: string }
  | { kind: "custom"; hostname: string }
  | { kind: "invalid" };

export function classifyHost(
  raw: string | null,
  cfg: { canonicalHost: string; baseDomain: string; enabled: boolean },
): HostClass {
  if (!cfg.enabled) return { kind: "canonical" };
  const host = normalizeHost(raw);
  if (!host) return { kind: "invalid" };
  if (host === cfg.canonicalHost) return { kind: "canonical" };
  const suffix = `.${cfg.baseDomain}`;
  if (host.endsWith(suffix)) {
    const label = host.slice(0, -suffix.length);
    return label.includes(".")
      ? { kind: "invalid" }
      : { kind: "platform", hostname: host, label };
  }
  return { kind: "custom", hostname: host };
}

export function safeNextPath(next: string | null | undefined): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  )
    return "/";
  try {
    const url = new URL(next, "https://placeholder.invalid");
    // Dot-segment removal can turn "/.//evil.com" into pathname "//evil.com" (protocol-relative).
    if (
      url.origin !== "https://placeholder.invalid" ||
      url.pathname.startsWith("//")
    )
      return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

// A company without a primary host has a relative home URL; from a company host that
// would resolve on the wrong host (404), so send it to the canonical origin instead.
export function companySwitchUrl(url: string, canonicalOrigin: string | null) {
  return canonicalOrigin && url.startsWith("/") ? canonicalOrigin + url : url;
}
