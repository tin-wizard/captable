import { env } from "@/env";
import { getPermissions } from "@/lib/rbac/access-control";
import {
  SESSION_COOKIE,
  isSessionVersionCurrent,
  sessionFromToken,
} from "@/server/auth";
import { domainConfig } from "@/server/domains/config";
import { tenantDb } from "@/server/tenant-db";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { parse } from "hono/utils/cookie";
import type { Session } from "next-auth";
import { decode } from "next-auth/jwt";
import { ApiError } from "../error";

export const sessionCookieAuthMiddleware = () =>
  createMiddleware(async (c, next) => {
    await authenticateWithSessionCookie(c);
    await next();
  });

export async function authenticateWithSessionCookie(c: Context) {
  const cookieHeader = c.req.header("cookie") ?? "";
  if (!parse(cookieHeader, SESSION_COOKIE)[SESSION_COOKIE]) {
    throw unauthorized();
  }

  // outside the try: a cross-site write is 403, not a failed login
  assertSameOriginWrite(c);

  try {
    await validateSessionCookie(cookieHeader, c);
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
function assertSameOriginWrite(c: Context) {
  if (SAFE_METHODS.includes(c.req.method)) return;
  const origin = c.req.header("origin");
  const allowed = [domainConfig().canonicalOrigin, new URL(c.req.url).origin];
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

// In-process decode of the canonical NextAuth JWT (no self-HTTP hairpin).
// Only the __Host- name is read, so a sibling-set __Secure- cookie is ignored.
export async function sessionFromCookieHeader(
  cookieHeader: string,
): Promise<Session | null> {
  const raw = parse(cookieHeader, SESSION_COOKIE)[SESSION_COOKIE];
  if (!raw) return null;
  const token = await decode({ token: raw, secret: env.NEXTAUTH_SECRET });
  if (!token?.sub) return null;
  if (!(await isSessionVersionCurrent(token.sub, token.sv))) return null;
  return sessionFromToken(token);
}

async function validateSessionCookie(cookieHeader: string, c: Context) {
  const session = await sessionFromCookieHeader(cookieHeader);
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
