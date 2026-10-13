import { domainConfig, tenantOrigin } from "./config";
import type { RequestHost } from "./request-host";

/** Enter a company host with the canonical session (start validates `next`). */
export function handoffStartUrl(hostname: string, next: string) {
  return `${tenantOrigin(
    hostname,
  )}/auth/handoff/start?next=${encodeURIComponent(next)}`;
}

// Profile/security belong to the user, not a company: they live on the canonical host.
export function isUserLevelPath(path: string): boolean {
  return /^\/[^/]+\/settings\/(profile|security)(\/|$|\?)/.test(path);
}

// Absolute to canonical when rendered on a company host, where these pages can't load.
export function userLevelHref(
  canonicalOrigin: string | null,
  publicId: string,
  page: "profile" | "security",
): string {
  return `${canonicalOrigin ?? ""}/${publicId}/settings/${page}`;
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
        ? // only signed-in users get here: enter via the handoff, not the company login page
          { redirect: handoffStartUrl(routeCompanyPrimaryHost, path) }
        : null;
    default:
      return { notFound: true };
  }
}
