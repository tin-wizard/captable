import { db } from "@/server/db";
import { safeNextPath } from "@/server/domains/core/host";
import {
  consumeHandoff,
  cookieBase,
  handoffCookieName,
  notFound,
  redirectTo,
  retryCount,
} from "@/server/domains/handoff";
import { getRequestHost } from "@/server/domains/request-host";
import {
  TENANT_SESSION_SECONDS,
  mintTenantSession,
  tenantCookieName,
} from "@/server/domains/tenant-session";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Company host: redeem the one-time code for a host-bound session cookie.
export async function GET(request: NextRequest) {
  const host = await getRequestHost();
  if (host.kind !== "tenant") return notFound();
  const params = request.nextUrl.searchParams;
  const n = params.get("n") ?? "";
  const r = retryCount(params.get("r"));
  const stateCookie = handoffCookieName(n);
  const state = request.cookies.get(stateCookie)?.value;
  const code = params.get("code");

  const row =
    state && code
      ? await consumeHandoff({ code, state, host: host.hostname })
      : null;
  const user =
    row &&
    (await db.user.findUnique({
      where: { id: row.userId },
      select: { sessionVersion: true, name: true, email: true, image: true },
    }));
  if (!row || !user || row.companyId !== host.companyId)
    return redirectTo(`/auth/handoff/start?next=/&r=${r + 1}`, 303);

  const token = await mintTenantSession({
    sub: row.userId,
    cid: row.companyId,
    mid: row.memberId,
    pid: host.publicId,
    hst: host.hostname,
    sv: user.sessionVersion,
    name: user.name,
    email: user.email,
    picture: user.image,
  });
  // the stored next, never a query value
  const res = redirectTo(safeNextPath(row.next), 303);
  res.cookies.set(tenantCookieName(), token, {
    ...cookieBase(),
    maxAge: TENANT_SESSION_SECONDS,
  });
  res.cookies.set(stateCookie, "", { ...cookieBase(), maxAge: 0 });
  return res;
}
