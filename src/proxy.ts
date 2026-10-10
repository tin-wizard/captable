import { logger } from "@/lib/logger";
import { domainConfig } from "@/server/domains/config";
import { classifyHost, safeNextPath } from "@/server/domains/core/host";
import { validateLabel } from "@/server/domains/core/subdomain";
import { NextResponse } from "next/server";
import { type NextRequest, userAgent } from "next/server";
import { env } from "./env";

export function logLine(req: { method: string; url: string }, ip: string) {
  // path only: query strings carry share-link and reset tokens
  return `${req.method} ${new URL(req.url).pathname} ${ip}`;
}

const CSRF_EXEMPT = ["/api/stripe/webhook", "/api/v1/"];
const CANONICAL_ONLY = [
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/set-password",
  "/check-email",
  "/email-sent",
  "/password-updated",
  "/new",
  "/verify-member",
  "/onboarding",
  "/company/new",
  "/logout",
];

export function isSameOrigin(
  req: { method: string; headers: Headers },
  host: string,
) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function tenantAuthRedirect(
  pathname: string,
  search: URLSearchParams,
): string | null {
  if (pathname === "/login") {
    return `/auth/handoff/start?next=${encodeURIComponent(
      safeNextPath(search.get("callbackUrl")),
    )}`;
  }
  if (
    CANONICAL_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  )
    return `canonical:${pathname}`;
  return null;
}

const log = logger.child({ module: "middleware" });

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const { pathname, searchParams, search } = request.nextUrl;

  if (env.LOGS || env.NODE_ENV === "production" || env.NODE_ENV === "staging") {
    const ip = request.headers.get("x-real-ip") ?? "";
    const time = new Date().toISOString();
    const { device, browser, isBot } = userAgent(request);
    log.info({ time, device, browser, isBot }, logLine(request, ip));
  }

  if (
    !CSRF_EXEMPT.some((p) => pathname.startsWith(p)) &&
    !isSameOrigin(request, host)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const cfg = domainConfig();
  const cls = classifyHost(host, cfg);
  if (
    cls.kind === "invalid" ||
    (cls.kind === "platform" && validateLabel(cls.label) === "format")
  ) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (cls.kind === "platform") {
    const target = tenantAuthRedirect(pathname, searchParams);
    if (target?.startsWith("canonical:")) {
      return NextResponse.redirect(
        `${cfg.canonicalOrigin}${target.slice("canonical:".length)}${search}`,
        307,
      );
    }
    if (target) return NextResponse.redirect(new URL(target, request.url), 307);
  }

  const headers = new Headers(request.headers);
  headers.set("x-dr-path", `${pathname}${search}`); // set() replaces any inbound value
  const res = NextResponse.next({ request: { headers } });
  if (cls.kind === "platform") res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export const config = {
  // Matcher ignores _next/static, _next/image, or favicon.ico
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
