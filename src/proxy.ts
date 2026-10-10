import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { type NextRequest, userAgent } from "next/server";
import { env } from "./env";

export function logLine(req: { method: string; url: string }, ip: string) {
  // path only: query strings carry share-link and reset tokens
  return `${req.method} ${new URL(req.url).pathname} ${ip}`;
}

const log = logger.child({ module: "middleware" });
// This function can be marked `async` if using `await` inside
export function proxy(request: NextRequest) {
  if (env.LOGS || env.NODE_ENV === "production" || env.NODE_ENV === "staging") {
    // NextRequest.ip and .geo were removed in Next 15
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const time = new Date().toISOString();
    const { device, browser, isBot } = userAgent(request);

    log.info({ time, device, browser, isBot }, logLine(request, ip));
  }
  return NextResponse.next();
}

export const config = {
  // Matcher ignores _next/static, _next/image, or favicon.ico
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
