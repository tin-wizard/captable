import { headers } from "next/headers";
import { cache } from "react";
import { domainConfig } from "./config";
import { classifyHost } from "./core/host";
import { validateLabel } from "./core/subdomain";
import { resolveHostname } from "./registry";

export type RequestHost =
  | { kind: "canonical" }
  | { kind: "tenant"; hostname: string; companyId: string; publicId: string }
  | { kind: "alias"; redirectHost: string }
  | { kind: "unknown" };

export async function resolveRequestHost(
  rawHost: string | null,
): Promise<RequestHost> {
  const cls = classifyHost(rawHost, domainConfig());
  if (cls.kind === "canonical") return cls;
  if (cls.kind === "invalid") return { kind: "unknown" };
  if (cls.kind === "platform" && validateLabel(cls.label) === "format")
    return { kind: "unknown" }; // no DB hit
  // custom hosts resolve only once Phase 6 registers CUSTOM rows
  const hit = await resolveHostname(cls.hostname);
  if (!hit) return { kind: "unknown" };
  if (hit.status === "ALIAS") {
    return hit.primaryHostname
      ? { kind: "alias", redirectHost: hit.primaryHostname }
      : { kind: "unknown" };
  }
  return {
    kind: "tenant",
    hostname: cls.hostname,
    companyId: hit.companyId,
    publicId: hit.publicId,
  };
}

export const getRequestHost = cache(async () =>
  resolveRequestHost((await headers()).get("host")),
);
