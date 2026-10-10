import { domainConfig, tenantOrigin } from "@/server/domains/config";
import { safeNextPath } from "@/server/domains/core/host";
import {
  cookieBase,
  handoffCookieName,
  htmlPage,
  notFound,
  randomToken,
  redirectTo,
  retryCount,
  sha256,
} from "@/server/domains/handoff";
import { getRequestHost } from "@/server/domains/request-host";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Company host: bounce to the canonical host to pick up the login session.
export async function GET(request: NextRequest) {
  const host = await getRequestHost();
  const { canonicalOrigin } = domainConfig();
  if (host.kind === "alias")
    return redirectTo(
      `${tenantOrigin(host.redirectHost)}/auth/handoff/start${
        request.nextUrl.search
      }`,
      307,
    );
  if (host.kind === "unknown")
    return redirectTo(`${canonicalOrigin}/domain-not-found`, 307);
  if (host.kind !== "tenant") return notFound();

  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const r = retryCount(params.get("r"));
  if (r >= 2)
    // loop breaker: the state cookie keeps getting lost
    return htmlPage(
      200,
      "Sign-in didn't complete",
      "We couldn't finish signing you in to this company. Make sure your browser allows cookies for this site, then try again.",
      {
        href: `/auth/handoff/start?next=${encodeURIComponent(next)}`,
        label: "Try again",
      },
    );

  const s = randomToken();
  const n = s.slice(0, 8);
  const qs = new URLSearchParams({
    host: host.hostname,
    s: sha256(s),
    n,
    r: String(r),
    next,
  });
  const res = redirectTo(`${canonicalOrigin}/auth/handoff/issue?${qs}`, 303);
  // per-nonce name, so parallel tabs don't clobber each other's state
  res.cookies.set(handoffCookieName(n), s, { ...cookieBase(), maxAge: 300 });
  return res;
}
