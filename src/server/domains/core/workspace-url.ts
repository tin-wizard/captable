// Pure: imported by a client component, so no Node/Next/Prisma imports.
import { safeNextPath } from "./host";
import { validateLabel } from "./subdomain";

type Input = {
  label: string;
  baseDomain: string;
  scheme: "http" | "https";
  port: string;
  next?: string | null;
};

export function workspaceLoginUrl(
  input: Input,
): { ok: true; url: string } | { ok: false; reason: "empty" | "format" } {
  const { baseDomain, scheme, port } = input;
  const raw = (
    input.label
      .trim()
      .toLowerCase()
      .replace(/^([a-z][a-z0-9+.-]*:)?\/\//, "")
      .split(/[/?#]/)[0] ?? ""
  ).replace(/:\d+$/, "");
  const suffix = `.${baseDomain.toLowerCase()}`;
  const label = raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw;

  if (!label) return { ok: false, reason: "empty" };
  // Only "format" rejects: a reserved label (e.g. "tin") can be a real company.
  if (label.includes(".") || validateLabel(label) === "format")
    return { ok: false, reason: "format" };

  const next = safeNextPath(input.next);
  const query = next === "/" ? "" : `?callbackUrl=${encodeURIComponent(next)}`;
  return {
    ok: true,
    url: `${scheme}://${label}.${baseDomain}${
      port ? `:${port}` : ""
    }/login${query}`,
  };
}
