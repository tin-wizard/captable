import type { TPrismaOrTransaction } from "@/server/db";
import { type DocumentsSummaryItem, getDocumentsSummary } from "./document";
import { type RangeInput, dayBuckets, localDay, parseRange } from "./range";

const MAX_EVENTS = 50_000;
const TOP_ITEMS = 50;
const TOP_COUNTRIES = 8;

export type CompanyEngagement = {
  range: { from: string; to: string; days: number };
  kpis: {
    visits: number;
    viewers: number;
    avgActiveSeconds: number;
    previous: { visits: number; viewers: number; avgActiveSeconds: number };
  };
  byKind: { DATA_ROOM: number; UPDATE: number; ESIGN: number };
  series: { day: string; visits: number }[];
  countries: { country: string; visits: number }[];
  topItems: (DocumentsSummaryItem & { kind: "DATA_ROOM" | "UPDATE" })[];
};

// Company-wide view activity (human visits only) and the busiest rooms and
// updates. `db` is the tenant client; companyId feeds the unopened lookup.
export async function getCompanyEngagement(
  db: TPrismaOrTransaction,
  companyId: string,
  input: RangeInput & { now?: Date; tz?: string },
): Promise<CompanyEngagement> {
  const tz = input.tz ?? "UTC";
  const range = parseRange(input, input.now, tz);
  const events = await db.viewEvent.findMany({
    where: {
      isBot: false,
      createdAt: { gte: range.previousFrom, lte: range.to },
    },
    select: {
      kind: true,
      createdAt: true,
      recipientId: true,
      activeSeconds: true,
      country: true,
    },
    take: MAX_EVENTS,
  });
  const fromMs = range.from.getTime();
  const current = events.filter((e) => e.createdAt.getTime() >= fromMs);
  const previous = events.filter((e) => e.createdAt.getTime() < fromMs);
  const stats = (rows: typeof events) => ({
    visits: rows.length,
    viewers: new Set(rows.map((r) => r.recipientId)).size,
    avgActiveSeconds: rows.length
      ? rows.reduce((n, r) => n + r.activeSeconds, 0) / rows.length
      : 0,
  });

  const perDay = new Map(
    dayBuckets(range.from, range.to, tz).map((d) => [d, 0]),
  );
  const byKind = { DATA_ROOM: 0, UPDATE: 0, ESIGN: 0 };
  const countries = new Map<string, number>();
  for (const e of current) {
    const k = localDay(e.createdAt, tz);
    if (perDay.has(k)) perDay.set(k, (perDay.get(k) ?? 0) + 1);
    byKind[e.kind] += 1;
    if (e.country)
      countries.set(e.country, (countries.get(e.country) ?? 0) + 1);
  }

  const [rooms, updates] = await Promise.all([
    getDocumentsSummary(db, companyId, { ...input, kind: "DATA_ROOM" }),
    getDocumentsSummary(db, companyId, { ...input, kind: "UPDATE" }),
  ]);
  const topItems = [
    ...rooms.map((r) => ({ ...r, kind: "DATA_ROOM" as const })),
    ...updates.map((r) => ({ ...r, kind: "UPDATE" as const })),
  ]
    .sort((a, b) => b.visits - a.visits || b.viewers - a.viewers)
    .slice(0, TOP_ITEMS);

  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      days: range.days,
    },
    kpis: { ...stats(current), previous: stats(previous) },
    byKind,
    series: [...perDay.entries()].map(([day, visits]) => ({ day, visits })),
    countries: [...countries.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_COUNTRIES)
      .map(([country, visits]) => ({ country, visits })),
    topItems,
  };
}
