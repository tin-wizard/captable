import { getPermissions } from "@/lib/rbac/access-control";
import { tenantDb } from "@/server/tenant-db";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Session } from "next-auth";
import { ApiError } from "../error";

export const sessionCookieAuthMiddleware = () =>
  createMiddleware(async (c, next) => {
    await authenticateWithSessionCookie(c);
    await next();
  });

export async function authenticateWithSessionCookie(c: Context) {
  const authUrl = process.env.NEXTAUTH_URL;
  if (!authUrl || !getCookie(c, determineCookieName(authUrl))) {
    throw unauthorized();
  }

  // outside the try: a cross-site write is 403, not a failed login
  assertSameOriginWrite(c, authUrl);

  try {
    await validateSessionCookie(authUrl, c);
  } catch (_error) {
    throw unauthorized();
  }
}

const unauthorized = () =>
  new ApiError({
    code: "UNAUTHORIZED",
    message: "Failed to authenticate with session cookie",
  });

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

// CSRF: the session cookie is an ambient credential, so a write it authorizes
// must come from the app itself. Browsers send Origin on every cross-origin
// POST (and Sec-Fetch-Site on all requests); a request with neither is a
// non-browser client, which cannot hold the victim's cookie, and is allowed.
// The request's own origin is accepted too: a cross-site page can set neither
// Host nor Origin on the victim's request, so they match only same-origin.
function assertSameOriginWrite(c: Context, authUrl: string) {
  if (SAFE_METHODS.includes(c.req.method)) return;
  const origin = c.req.header("origin");
  const allowed = [new URL(authUrl).origin, new URL(c.req.url).origin];
  if (
    c.req.header("sec-fetch-site") === "cross-site" ||
    (origin !== undefined && !allowed.includes(origin))
  ) {
    throw new ApiError({
      code: "FORBIDDEN",
      message: "Cross-origin requests cannot use the session cookie",
    });
  }
}

function determineCookieName(authUrl: string): string {
  return authUrl.startsWith("https://")
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}

async function validateSessionCookie(authUrl: string, c: Context) {
  const session = await fetchSessionFromAuthUrl(authUrl, c);
  // next-auth answers 200 with {} for a missing or undecodable cookie
  if (!session?.user?.id || !session.user.memberId) {
    throw new Error("Not authenticated");
  }
  const companyIdParam = c.req.param("companyId");
  const { db } = c.get("services");

  const { err, val } = await getPermissions({
    db,
    session: {
      ...session,
      user: {
        ...session.user,
        ...(companyIdParam && { companyId: companyIdParam }),
      },
    },
  });

  if (err) {
    throw err;
  }

  c.set("session", { membership: val.membership });
  // the verified member row's company (equal to the path companyId when present)
  c.set("tenantDb", tenantDb(db, val.membership.companyId));
}

async function fetchSessionFromAuthUrl(
  authUrl: string,
  c: Context,
): Promise<Session> {
  const newUrl = new URL("/api/auth/session", authUrl).toString();

  const response = await fetch(
    new Request(newUrl, {
      method: "GET",
      // only the cookie: the original body and its content headers must not reach a GET
      headers: { cookie: c.req.header("cookie") ?? "" },
    }),
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Failed to fetch session from auth service");
  }

  return data as Session;
}
