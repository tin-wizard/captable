import { getServerAuthSession } from "@/server/auth";
import { domainConfig, tenantOrigin } from "@/server/domains/config";
import { safeNextPath } from "@/server/domains/core/host";
import {
  htmlPage,
  issueHandoff,
  notFound,
  redirectTo,
  retryCount,
} from "@/server/domains/handoff";
import { resolveHostname } from "@/server/domains/registry";
import { getRequestHost } from "@/server/domains/request-host";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Canonical host: turn the login session into a one-time code for a company host.
export async function GET(request: NextRequest) {
  if ((await getRequestHost()).kind !== "canonical") return notFound();
  const { canonicalOrigin } = domainConfig();
  const { pathname, search, searchParams } = request.nextUrl;

  const session = await getServerAuthSession();
  if (!session?.user?.id)
    return redirectTo(
      `${canonicalOrigin}/login?callbackUrl=${encodeURIComponent(
        pathname + search,
      )}`,
      307,
    );

  const host = searchParams.get("host") ?? "";
  const stateHash = searchParams.get("s") ?? "";
  const n = searchParams.get("n") ?? "";
  const resolved = host ? await resolveHostname(host) : null;
  if (resolved?.status !== "ACTIVE" || !stateHash || !/^[\w-]{8}$/.test(n))
    return redirectTo(`${canonicalOrigin}/domain-not-found`, 307);

  const result = await issueHandoff({
    userId: session.user.id,
    companyId: resolved.companyId,
    targetHost: host,
    stateHash,
    next: safeNextPath(searchParams.get("next")),
  });
  if ("error" in result)
    return htmlPage(
      403,
      "You don't have access to this company",
      "Your account isn't an active member of this company.",
      { href: "/", label: "Go to your companies" },
    );

  const qs = new URLSearchParams({
    code: result.code,
    n,
    r: String(retryCount(searchParams.get("r"))),
  });
  return redirectTo(`${tenantOrigin(host)}/auth/handoff/callback?${qs}`, 303);
}
