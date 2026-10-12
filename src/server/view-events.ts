import type { TPrismaOrTransaction } from "@/server/db";
import type { ViewKind } from "@prisma/client";

// shortcut: a user-agent list catches mail scanners and link previews that run
// JS, not residential-proxy bots; swap for a maintained list if false views show up.
const ATYPICAL_UA =
  /bot|crawl|spider|preview|scan|monitor|headless|curl|wget|python|slackbot|facebookexternalhit|proofpoint|mimecast|barracuda|defender|safelinks/i;

export const isAtypicalSource = (userAgent: string) =>
  !userAgent || ATYPICAL_UA.test(userAgent);

// IPv4 -> /24, IPv6 -> /48; unparseable input is dropped, not stored
export function truncateIp(ip: string) {
  // drop "[v6]:port" brackets, "v4:port" and an IPv6 zone id before parsing
  const s = ip
    .trim()
    .replace(/^\[([^\]]*)\](?::\d+)?$/, "$1")
    .replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1")
    .replace(/%.*$/, "");
  const v4 = s.match(/^(?:[0-9a-f:]+:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/i);
  if (v4) return `${v4[1]}.0`;
  if (/^[0-9a-f:]*:[0-9a-f:]*$/i.test(s)) {
    const head = s.split("::")[0] ?? "";
    return `${head.split(":").slice(0, 3).filter(Boolean).join(":")}::`;
  }
  return "";
}

export type Visit = "first" | "return" | "repeat" | "bot";

const RETURN_AFTER_MS = 30 * 60 * 1000;
// a public beacon must not grow the table without bound: one row per class per
// recipient+target per 10s caps it at ~8.6k rows/day.
const MIN_GAP_MS = 10_000;

type NewView = {
  companyId: string;
  kind: ViewKind;
  targetId: string;
  recipientId: string;
  ip: string;
  userAgent: string;
};

// shortcut: read-then-write is not atomic, so two simultaneous first beacons can
// both report "first"; the alert job's singletonKey absorbs the duplicate email.
export async function recordView(
  db: TPrismaOrTransaction,
  v: NewView,
): Promise<Visit> {
  const isBot = isAtypicalSource(v.userAgent);
  const last = await db.viewEvent.findFirst({
    where: {
      kind: v.kind,
      targetId: v.targetId,
      recipientId: v.recipientId,
      isBot,
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (last && Date.now() - last.createdAt.getTime() < MIN_GAP_MS)
    return isBot ? "bot" : "repeat";

  await db.viewEvent.create({ data: { ...v, ip: truncateIp(v.ip), isBot } });

  if (isBot) return "bot";
  if (!last) return "first";
  return Date.now() - last.createdAt.getTime() > RETURN_AFTER_MS
    ? "return"
    : "repeat";
}
