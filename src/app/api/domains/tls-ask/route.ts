// Caddy calls this before it asks Let's Encrypt for a certificate (on-demand TLS).
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { db } from "@/server/db";
import { liveAliasWhere } from "@/server/domains/registry";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// digests are equal-length whatever the input, so this never throws or leaks the length
const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export async function GET(request: NextRequest) {
  const secret = env.TLS_ASK_SECRET;
  const params = request.nextUrl.searchParams;
  if (
    env.DOMAINS_ENABLED !== "1" ||
    !secret ||
    !same(params.get("secret") ?? "", secret)
  )
    return new Response(null, { status: 404 });
  const domain = (params.get("domain") ?? "").toLowerCase();
  const live = domain
    ? await db.companyDomain.count({
        where: {
          hostname: domain,
          kind: "CUSTOM",
          OR: [{ status: "ACTIVE" }, liveAliasWhere()],
        },
      })
    : 0;
  return new Response(null, { status: live ? 200 : 404 });
}
