import NextAuth from "next-auth";

import { authOptions, getServerAuthSession } from "@/server/auth";
import { domainConfig } from "@/server/domains/config";
import { notFound } from "@/server/domains/handoff";
import { getRequestHost } from "@/server/domains/request-host";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const nextAuth = NextAuth(authOptions);

type Ctx = { params: Promise<{ nextauth: string[] }> };

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

// Company hosts only expose session/csrf so useSession() works; sign-in stays on canonical.
async function handler(req: NextRequest, ctx: Ctx) {
  const kind = domainConfig().enabled
    ? (await getRequestHost()).kind
    : "canonical";
  if (kind === "canonical")
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return nextAuth(req, ctx) as Promise<Response>;
  if (kind !== "tenant") return notFound();
  const action = (await ctx.params).nextauth.join("/");
  if (action === "session")
    return NextResponse.json((await getServerAuthSession()) ?? {}, NO_STORE);
  if (action === "csrf" && req.method === "GET")
    return NextResponse.json({ csrfToken: "" }, NO_STORE);
  return notFound();
}

export { handler as GET, handler as POST };
