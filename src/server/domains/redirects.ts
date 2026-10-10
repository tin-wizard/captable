import { domainConfig, tenantOrigin } from "./config";
import type { RequestHost } from "./request-host";

// Profile/security belong to the user, not a company: they live on the canonical host.
export function isUserLevelPath(path: string): boolean {
  return /^\/[^/]+\/settings\/(profile|security)(\/|$|\?)/.test(path);
}

// tenant → canonical only for user-level paths, canonical → tenant only for the
// rest: disjoint sets, so no redirect loop. alias → primary is one hop.
export function layoutRedirect(input: {
  host: RequestHost;
  path: string;
  routePublicId: string;
  routeCompanyPrimaryHost: string | null;
}): { redirect: string } | { notFound: true } | null {
  const { host, path, routePublicId, routeCompanyPrimaryHost } = input;
  const userLevel = isUserLevelPath(path);
  switch (host.kind) {
    case "alias":
      return { redirect: tenantOrigin(host.redirectHost) + path };
    case "tenant":
      if (routePublicId !== host.publicId) return { notFound: true };
      return userLevel
        ? { redirect: domainConfig().canonicalOrigin + path }
        : null;
    case "canonical":
      return !userLevel && routeCompanyPrimaryHost
        ? { redirect: tenantOrigin(routeCompanyPrimaryHost) + path }
        : null;
    default:
      return { notFound: true };
  }
}
