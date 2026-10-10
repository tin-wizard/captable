import { env } from "@/env";

export function domainConfig() {
  const canonical = new URL(env.NEXTAUTH_URL);
  return {
    enabled: env.DOMAINS_ENABLED === "1",
    canonicalHost: canonical.hostname,
    canonicalOrigin: canonical.origin,
    baseDomain: env.TENANT_BASE_DOMAIN ?? canonical.hostname,
    scheme:
      canonical.protocol === "https:" ? ("https" as const) : ("http" as const),
    port: canonical.port, // "" in production
  };
}

export function tenantOrigin(hostname: string) {
  const { scheme, port } = domainConfig();
  return `${scheme}://${hostname}${port ? `:${port}` : ""}`;
}
