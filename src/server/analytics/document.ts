import type { DocSeconds } from "@/server/activity/doc-seconds";
import { findUnopened } from "@/server/activity/unopened";
import type { TPrismaOrTransaction } from "@/server/db";
import { engagement } from "./engagement";
import { type RangeInput, dayBuckets, localDay, parseRange } from "./range";

// shortcut: at most 50,000 visits are read per call (a year of a very busy
// room is far below that); add SQL aggregation when a company reaches it.
const MAX_EVENTS = 50_000;
const TOP_COUNTRIES = 8;

export type ViewerRow = {
  recipientId: string;
  label: string;
  email: string;
  stakeholder: { id: string; name: string; shares: number | null } | null;
  visits: number;
  firstSeen: string | null;
  lastSeen: string | null;
  activeSeconds: number;
  pagesReached: number | null;
  score: number;
  engagementLabel: "hot" | "warm" | "cold";
  countries: string[];
};

export type DocumentAnalytics = {
  range: { from: string; to: string; days: number };
  kpis: {
    visits: number;
    viewers: number;
    avgActiveSeconds: number;
    completionRate: number | null;
    returnRate: number;
    previous: { visits: number; viewers: number; avgActiveSeconds: number };
    botsHidden: number;
  };
  series: { day: string; visits: number; viewers: number }[];
  documents:
    | null
    | {
        bucketId: string;
        name: string;
        pages: number | null;
        viewers: number;
        avgSeconds: number;
        completion: number | null;
        byPage: { page: number; seconds: number; viewers: number }[];
      }[];
  countries: { country: string; visits: number }[];
  engagementMix: { hot: number; warm: number; cold: number; unopened: number };
  viewers: { items: ViewerRow[]; nextCursor: string | null };
  legacyDetailFrom: string | null;
};

export type DocumentInput = RangeInput & {
  kind: "DATA_ROOM" | "UPDATE";
  targetId: string;
  includeBots?: boolean;
  viewerStatus?: "all" | "returned" | "unopened";
  country?: string[];
  search?: string;
  cursor?: string;
  limit?: number;
  canSeeHoldings: boolean;
  now?: Date;
  /** IANA zone the day buckets follow */
  tz?: string;
};

type Row = {
  id: string;
  recipientId: string;
  createdAt: Date;
  activeSeconds: number;
  docSeconds: unknown;
  country: string | null;
  isBot: boolean;
};

const mean = (n: number, d: number) => (d ? n / d : 0);
const sumValues = (p: Record<string, number>) =>
  Object.values(p).reduce((a, b) => a + b, 0);

// Everything for one data room or update. `db` must be the tenant client (or
// the caller must have verified `targetId` belongs to the company): events are
// filtered by kind and target, and recipients by their parent.
export async function getDocumentAnalytics(
  db: TPrismaOrTransaction,
  input: DocumentInput,
): Promise<DocumentAnalytics> {
  const tz = input.tz ?? "UTC";
  const range = parseRange(input, input.now, tz);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);

  const [events, recipients, everOpened] = await Promise.all([
    db.viewEvent.findMany({
      where: {
        kind: input.kind,
        targetId: input.targetId,
        createdAt: { gte: range.previousFrom, lte: range.to },
      },
      select: {
        id: true,
        recipientId: true,
        createdAt: true,
        activeSeconds: true,
        docSeconds: true,
        country: true,
        isBot: true,
      },
      orderBy: { createdAt: "asc" },
      take: MAX_EVENTS,
    }),
    input.kind === "DATA_ROOM"
      ? db.dataRoomRecipient.findMany({
          where: { dataRoomId: input.targetId },
          select: { id: true, name: true, email: true, stakeholderId: true },
          take: 2000,
        })
      : db.updateRecipient.findMany({
          where: { updateId: input.targetId },
          select: { id: true, name: true, email: true, stakeholderId: true },
          take: 2000,
        }),
    db.viewEvent.findMany({
      where: { kind: input.kind, targetId: input.targetId, isBot: false },
      select: { recipientId: true },
      distinct: ["recipientId"],
    }),
  ]);

  const fromMs = range.from.getTime();
  const all = events as Row[];
  const botsHidden = all.filter(
    (e) => e.isBot && e.createdAt.getTime() >= fromMs,
  ).length;
  const usable = input.includeBots ? all : all.filter((e) => !e.isBot);
  const current = usable.filter((e) => e.createdAt.getTime() >= fromMs);
  const previous = usable.filter((e) => e.createdAt.getTime() < fromMs);

  const stats = (rows: Row[]) => ({
    visits: rows.length,
    viewers: new Set(rows.map((r) => r.recipientId)).size,
    avgActiveSeconds: mean(
      rows.reduce((n, r) => n + r.activeSeconds, 0),
      rows.length,
    ),
  });
  const cur = stats(current);

  // per-day series, zero filled
  const perDay = new Map<string, { visits: number; viewers: Set<string> }>();
  for (const d of dayBuckets(range.from, range.to, tz))
    perDay.set(d, { visits: 0, viewers: new Set() });
  for (const e of current) {
    const bucket = perDay.get(localDay(e.createdAt, tz));
    if (bucket) {
      bucket.visits += 1;
      bucket.viewers.add(e.recipientId);
    }
  }

  // per recipient
  type Agg = {
    visits: number;
    first: Date;
    last: Date;
    active: number;
    countries: Set<string>;
    docs: DocSeconds;
  };
  const byRecipient = new Map<string, Agg>();
  for (const e of current) {
    const a = byRecipient.get(e.recipientId) ?? {
      visits: 0,
      first: e.createdAt,
      last: e.createdAt,
      active: 0,
      countries: new Set<string>(),
      docs: {} as DocSeconds,
    };
    a.visits += 1;
    a.active += e.activeSeconds;
    if (e.createdAt < a.first) a.first = e.createdAt;
    if (e.createdAt > a.last) a.last = e.createdAt;
    if (e.country) a.countries.add(e.country);
    const ds = (e.docSeconds ?? null) as DocSeconds | null;
    if (ds) {
      for (const [bucketId, doc] of Object.entries(ds)) {
        const prev = a.docs[bucketId] ?? { n: 0, p: {} };
        prev.n = Math.max(prev.n, doc.n);
        for (const [page, secs] of Object.entries(doc.p))
          prev.p[page] = Math.max(prev.p[page] ?? 0, secs);
        a.docs[bucketId] = prev;
      }
    }
    byRecipient.set(e.recipientId, a);
  }

  const returned = [...byRecipient.values()].filter(
    (a) => a.visits >= 2,
  ).length;

  // documents (data rooms only): which pages hold people
  let documents: DocumentAnalytics["documents"] = null;
  let completionRate: number | null = null;
  let legacyDetailFrom: string | null = null;
  const withDocs = current.filter((e) => e.docSeconds);
  if (input.kind === "DATA_ROOM" && withDocs.length) {
    const links = await db.dataRoomDocument.findMany({
      where: { dataRoomId: input.targetId },
      select: {
        document: { select: { bucketId: true, name: true } },
      },
    });
    const names = new Map(
      links.map((l) => [l.document.bucketId, l.document.name]),
    );
    const per = new Map<
      string,
      {
        n: number;
        visits: number;
        secs: number;
        viewers: Map<string, Set<string>>;
      }
    >();
    for (const e of withDocs) {
      for (const [bucketId, doc] of Object.entries(
        e.docSeconds as DocSeconds,
      )) {
        const d = per.get(bucketId) ?? {
          n: 0,
          visits: 0,
          secs: 0,
          viewers: new Map(),
        };
        d.n = Math.max(d.n, doc.n);
        d.visits += 1;
        d.secs += sumValues(doc.p);
        for (const [page, s] of Object.entries(doc.p)) {
          if (s <= 0) continue;
          const set = d.viewers.get(page) ?? new Set<string>();
          set.add(e.recipientId);
          d.viewers.set(page, set);
        }
        per.set(bucketId, d);
      }
    }
    let reached = 0;
    let opened = 0;
    documents = [...per.entries()].map(([bucketId, d]) => {
      const all = new Set<string>();
      for (const s of d.viewers.values()) for (const r of s) all.add(r);
      const last = d.viewers.get(String(d.n));
      reached += last?.size ?? 0;
      opened += all.size;
      const pages = Math.min(d.n, 500);
      return {
        bucketId,
        name: names.get(bucketId) ?? "(deleted)",
        pages: d.n || null,
        viewers: all.size,
        avgSeconds: mean(d.secs, d.visits),
        completion: all.size ? (last?.size ?? 0) / all.size : null,
        byPage: Array.from({ length: pages }, (_, i) => ({
          page: i + 1,
          seconds: 0,
          viewers: d.viewers.get(String(i + 1))?.size ?? 0,
        })),
      };
    });
    // seconds per page: average over visits that opened the document
    for (const doc of documents) {
      const d = per.get(doc.bucketId);
      if (!d) continue;
      const totals = new Map<number, number>();
      for (const e of withDocs) {
        const ds = (e.docSeconds as DocSeconds)[doc.bucketId];
        if (!ds) continue;
        for (const [page, s] of Object.entries(ds.p))
          totals.set(Number(page), (totals.get(Number(page)) ?? 0) + s);
      }
      for (const p of doc.byPage)
        p.seconds = mean(totals.get(p.page) ?? 0, d.visits);
    }
    completionRate = opened ? reached / opened : null;
    if (withDocs.length < current.length)
      legacyDetailFrom = localDay(withDocs[0]?.createdAt ?? range.from, tz);
  }

  // recipients, names and (when allowed) holdings
  const stakeholderIds = [
    ...new Set(
      recipients.map((r) => r.stakeholderId).filter((x): x is string => !!x),
    ),
  ];
  const stakeholders = stakeholderIds.length
    ? await db.stakeholder.findMany({
        where: { id: { in: stakeholderIds } },
        select: { id: true, name: true },
      })
    : [];
  const holdings = new Map<string, number>();
  if (input.canSeeHoldings && stakeholders.length) {
    const sums = await db.share.groupBy({
      by: ["stakeholderId"],
      where: {
        stakeholderId: { in: stakeholders.map((s) => s.id) },
        status: "ACTIVE",
      },
      _sum: { quantity: true },
    });
    for (const s of sums) holdings.set(s.stakeholderId, s._sum.quantity ?? 0);
  }
  const stakeholderById = new Map(stakeholders.map((s) => [s.id, s]));
  const recipientById = new Map(recipients.map((r) => [r.id, r]));
  const opened = new Set(everOpened.map((e) => e.recipientId));

  const rowFor = (recipientId: string): ViewerRow => {
    const rec = recipientById.get(recipientId);
    const a = byRecipient.get(recipientId);
    const st = rec?.stakeholderId
      ? stakeholderById.get(rec.stakeholderId)
      : undefined;
    let pagesReached: number | null = null;
    let pagesTotal: number | null = null;
    if (a && Object.keys(a.docs).length) {
      pagesReached = 0;
      pagesTotal = 0;
      for (const d of Object.values(a.docs)) {
        pagesReached += Object.values(d.p).filter((s) => s > 0).length;
        pagesTotal += d.n;
      }
    }
    const e = engagement({
      activeSeconds: a?.active ?? 0,
      visits: a?.visits ?? 0,
      pagesReached: pagesReached ?? 0,
      pagesTotal,
    });
    return {
      recipientId,
      label: rec?.name || rec?.email || "Unknown recipient",
      email: rec?.email ?? "",
      stakeholder: st
        ? {
            id: st.id,
            name: st.name,
            shares: input.canSeeHoldings ? holdings.get(st.id) ?? 0 : null,
          }
        : null,
      visits: a?.visits ?? 0,
      firstSeen: a ? a.first.toISOString() : null,
      lastSeen: a ? a.last.toISOString() : null,
      activeSeconds: a?.active ?? 0,
      pagesReached,
      score: a ? e.score : 0,
      engagementLabel: a ? e.label : "cold",
      countries: a ? [...a.countries] : [],
    };
  };

  const viewerRows = [...byRecipient.keys()].map(rowFor);
  const mix = { hot: 0, warm: 0, cold: 0, unopened: 0 };
  for (const v of viewerRows) mix[v.engagementLabel] += 1;
  const unopenedIds = recipients
    .filter((r) => !opened.has(r.id))
    .map((r) => r.id);
  mix.unopened = unopenedIds.length;

  // table: filter, sort, keyset-paginate
  const status = input.viewerStatus ?? "all";
  let table =
    status === "unopened"
      ? unopenedIds.map(rowFor)
      : viewerRows.filter((v) => status === "all" || v.visits >= 2);
  if (input.country?.length)
    table = table.filter((v) =>
      v.countries.some((c) => input.country?.includes(c)),
    );
  const q = input.search?.trim().toLowerCase();
  if (q)
    table = table.filter(
      (v) =>
        v.label.toLowerCase().includes(q) || v.email.toLowerCase().includes(q),
    );
  table.sort(
    (a, b) =>
      (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") ||
      b.recipientId.localeCompare(a.recipientId),
  );
  let start = 0;
  if (input.cursor) {
    const at = table.findIndex((v) => v.recipientId === input.cursor);
    if (at === -1)
      return empty(
        range,
        cur,
        previous,
        botsHidden,
        perDay,
        mix,
        completionRate,
      );
    start = at + 1;
  }
  const items = table.slice(start, start + limit);
  const nextCursor =
    start + limit < table.length
      ? items[items.length - 1]?.recipientId ?? null
      : null;

  // countries
  const countryCount = new Map<string, number>();
  for (const e of current)
    if (e.country)
      countryCount.set(e.country, (countryCount.get(e.country) ?? 0) + 1);

  const prev = stats(previous);
  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      days: range.days,
    },
    kpis: {
      visits: cur.visits,
      viewers: cur.viewers,
      avgActiveSeconds: cur.avgActiveSeconds,
      completionRate,
      returnRate: cur.viewers ? returned / cur.viewers : 0,
      previous: prev,
      botsHidden,
    },
    series: [...perDay.entries()].map(([d, v]) => ({
      day: d,
      visits: v.visits,
      viewers: v.viewers.size,
    })),
    documents,
    countries: [...countryCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_COUNTRIES)
      .map(([country, visits]) => ({ country, visits })),
    engagementMix: mix,
    viewers: { items, nextCursor },
    legacyDetailFrom,
  };
}

// a cursor that is not in this target's rows returns an empty page, never
// another company's data
function empty(
  range: ReturnType<typeof parseRange>,
  cur: { visits: number; viewers: number; avgActiveSeconds: number },
  previous: Row[],
  botsHidden: number,
  perDay: Map<string, { visits: number; viewers: Set<string> }>,
  mix: DocumentAnalytics["engagementMix"],
  completionRate: number | null,
): DocumentAnalytics {
  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      days: range.days,
    },
    kpis: {
      ...cur,
      completionRate,
      returnRate: 0,
      previous: {
        visits: previous.length,
        viewers: new Set(previous.map((p) => p.recipientId)).size,
        avgActiveSeconds: 0,
      },
      botsHidden,
    },
    series: [...perDay.entries()].map(([d, v]) => ({
      day: d,
      visits: v.visits,
      viewers: v.viewers.size,
    })),
    documents: null,
    countries: [],
    engagementMix: mix,
    viewers: { items: [], nextCursor: null },
    legacyDetailFrom: null,
  };
}

export type DocumentsSummaryItem = {
  targetId: string;
  publicId: string;
  name: string;
  viewers: number;
  visits: number;
  avgActiveSeconds: number;
  lastViewedAt: string | null;
  unopened: number;
  spark: { day: string; visits: number }[];
};

// One pass for every room or update of the company (no per-room queries).
export async function getDocumentsSummary(
  db: TPrismaOrTransaction,
  companyId: string,
  input: RangeInput & { kind: "DATA_ROOM" | "UPDATE"; now?: Date; tz?: string },
): Promise<DocumentsSummaryItem[]> {
  const tz = input.tz ?? "UTC";
  const range = parseRange(input, input.now, tz);
  const targets =
    input.kind === "DATA_ROOM"
      ? (
          await db.dataRoom.findMany({
            select: { id: true, publicId: true, name: true },
            orderBy: { createdAt: "desc" },
            take: 200,
          })
        ).map((t) => ({ id: t.id, publicId: t.publicId, name: t.name }))
      : (
          await db.update.findMany({
            select: { id: true, publicId: true, title: true },
            orderBy: { createdAt: "desc" },
            take: 200,
          })
        ).map((t) => ({ id: t.id, publicId: t.publicId, name: t.title }));
  if (!targets.length) return [];

  const [events, unopened] = await Promise.all([
    db.viewEvent.findMany({
      where: {
        kind: input.kind,
        isBot: false,
        targetId: { in: targets.map((t) => t.id) },
        createdAt: { gte: range.from, lte: range.to },
      },
      select: {
        targetId: true,
        recipientId: true,
        createdAt: true,
        activeSeconds: true,
      },
      take: MAX_EVENTS,
    }),
    findUnopened(db, companyId, { kind: input.kind }),
  ]);

  const days = dayBuckets(range.from, range.to, tz);
  return targets.map((t) => {
    const mine = events.filter((e) => e.targetId === t.id);
    const perDay = new Map(days.map((d) => [d, 0]));
    let last: Date | null = null;
    for (const e of mine) {
      const k = localDay(e.createdAt, tz);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
      if (!last || e.createdAt > last) last = e.createdAt;
    }
    return {
      targetId: t.id,
      publicId: t.publicId,
      name: t.name,
      viewers: new Set(mine.map((e) => e.recipientId)).size,
      visits: mine.length,
      avgActiveSeconds: mean(
        mine.reduce((n, e) => n + e.activeSeconds, 0),
        mine.length,
      ),
      lastViewedAt: last ? last.toISOString() : null,
      unopened: unopened.filter((u) => u.targetId === t.id).length,
      spark: days.map((d) => ({ day: d, visits: perDay.get(d) ?? 0 })),
    };
  });
}
