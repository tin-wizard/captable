// Caddy calls this before it asks Let's Encrypt for a certificate (on-demand TLS).
import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { db } from "@/server/db";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

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
          status: { in: ["ACTIVE", "ALIAS"] },
        },
      })
    : 0;
  return new Response(null, { status: live ? 200 : 404 });
}
