import { bumpSessionVersion } from "@/server/auth";
import { domainConfig } from "@/server/domains/config";
import { cookieBase, notFound, redirectTo } from "@/server/domains/handoff";
import { getRequestHost } from "@/server/domains/request-host";
import {
  readTenantSession,
  tenantCookieName,
} from "@/server/domains/tenant-session";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Company host: end the session everywhere, then sign out of canonical.
export async function POST(request: NextRequest) {
  const { enabled, canonicalOrigin } = domainConfig();
  if (!enabled) return notFound();
  const host = await getRequestHost();
  if (host.kind !== "tenant") return notFound();
  const claims = await readTenantSession(
    request.cookies.get(tenantCookieName())?.value,
    host.hostname,
  );
  // server-side, so this works even when the canonical session is already gone
  if (claims) await bumpSessionVersion(claims.sub);
  const res = redirectTo(`${canonicalOrigin}/logout`, 303);
  res.cookies.set(tenantCookieName(), "", { ...cookieBase(), maxAge: 0 });
  return res;
}
