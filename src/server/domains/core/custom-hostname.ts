// Pure: also imported by client components.
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const BAD_TLDS = new Set(["localhost", "local", "internal", "invalid"]);

export type CustomHostnameResult =
  | { ok: true; hostname: string }
  | { ok: false; reason: "empty" | "format" | "platform" };

export function normalizeCustomHostname(
  raw: string,
  cfg: { canonicalHost: string; baseDomain: string },
): CustomHostnameResult {
  const h =
    raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .split(/[/?#]/)[0] ?? "";
  if (!h) return { ok: false, reason: "empty" };
  const labels = h.split(".");
  const tld = labels[labels.length - 1] ?? "";
  if (
    h.length > 253 ||
    labels.length < 2 ||
    !labels.every((l) => LABEL.test(l)) ||
    !TLD.test(tld) ||
    BAD_TLDS.has(tld)
  )
    return { ok: false, reason: "format" };
  const under = (d: string) => h === d || h.endsWith(`.${d}`);
  if (under(cfg.canonicalHost) || under(cfg.baseDomain))
    return { ok: false, reason: "platform" };
  return { ok: true, hostname: h };
}
