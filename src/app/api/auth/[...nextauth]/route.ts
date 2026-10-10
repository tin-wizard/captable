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

// Company hosts only expose session/csrf so useSession() works; sign-in stays on canonical.
async function handler(req: NextRequest, ctx: Ctx) {
  if (!domainConfig().enabled || (await getRequestHost()).kind !== "tenant")
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return nextAuth(req, ctx) as Promise<Response>;
  const action = (await ctx.params).nextauth.join("/");
  if (action === "session")
    return NextResponse.json((await getServerAuthSession()) ?? {});
  if (action === "csrf" && req.method === "GET")
    return NextResponse.json({ csrfToken: "" });
  return notFound();
}

export { handler as GET, handler as POST };
