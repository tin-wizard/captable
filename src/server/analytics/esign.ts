import type { TPrismaOrTransaction } from "@/server/db";
import { type RangeInput, dayBuckets, parseRange } from "./range";

const DAY = 86_400_000;
const HOUR = 3_600_000;
// shortcut: envelopes created in the window are read in one pass (2,000 cap);
// move to SQL aggregation when a company sends more than that in 400 days.
const MAX_TEMPLATES = 2000;
const MAX_AUDITS = 50_000;
const STUCK_DAYS = 3;
const ACTIONS = [
  "document.email.sent",
  "recipient.viewed",
  "recipient.signed",
] as const;

type Status = "DRAFT" | "PENDING" | "COMPLETE" | "CANCELLED";

export type EnvelopeRow = {
  templateId: string;
  publicId: string;
  name: string;
  status: Status;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  signers: { signed: number; total: number };
  hoursToComplete: number | null;
  waitingOn: { name: string; email: string; waitingDays: number }[];
  stuck: boolean;
};

export type EsignAnalytics = {
  range: { from: string; to: string; days: number };
  canSeeViews: boolean;
  kpis: {
    sent: number;
    completed: number;
    completionRate: number | null;
    medianHoursToSign: number | null;
    avgHoursToSign: number | null;
    pendingSigners: number;
    stuckSigners: number;
    previous: {
      sent: number;
      completed: number;
      medianHoursToSign: number | null;
    };
  };
  funnel: {
    sent: number;
    viewed: number | null;
    signed: number;
    completed: number;
  };
  series: { day: string; sent: number; completed: number }[];
  statusMix: Record<Status, number>;
  slowest: {
    email: string;
    name: string;
    signed: number;
    medianHours: number;
  }[];
  envelopes: { items: EnvelopeRow[]; nextCursor: string | null };
};

export type EsignInput = RangeInput & {
  status?: Status[];
  uploaderId?: string;
  signer?: string;
  stuck?: boolean;
  search?: string;
  cursor?: string;
  limit?: number;
  canSeeViews: boolean;
  now?: Date;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2
    ? (s[m] as number)
    : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const day = (d: Date) => d.toISOString().slice(0, 10);

type Timing = {
  recipientId: string;
  name: string;
  email: string;
  status: string;
  templateId: string;
  sentAt: Date | null;
  viewedAt: Date | null;
  signedAt: Date | null;
};

// Definitions: sent = first "document.email.sent" audit of the recipient;
// viewed = first "recipient.viewed"; signed = first "recipient.signed";
// time to sign = signed - sent; waiting = now - sent for unsigned recipients of
// a PENDING envelope; stuck = waiting for STUCK_DAYS or more.
export async function getEsignAnalytics(
  db: TPrismaOrTransaction,
  input: EsignInput,
): Promise<EsignAnalytics> {
  const now = input.now ?? new Date();
  const range = parseRange(input, now);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);

  const templates = await db.template.findMany({
    where: {
      createdAt: { gte: range.previousFrom, lte: range.to },
      ...(input.status?.length && { status: { in: input.status } }),
      ...(input.uploaderId && { uploaderId: input.uploaderId }),
      ...(input.search?.trim() && {
        name: { contains: input.search.trim(), mode: "insensitive" as const },
      }),
    },
    select: {
      id: true,
      publicId: true,
      name: true,
      status: true,
      createdAt: true,
      completedOn: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_TEMPLATES,
  });
  const ids = templates.map((t) => t.id);

  const [recipients, audits] = ids.length
    ? await Promise.all([
        db.esignRecipient.findMany({
          where: { templateId: { in: ids } },
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            templateId: true,
          },
        }),
        db.esignAudit.findMany({
          where: { templateId: { in: ids }, action: { in: [...ACTIONS] } },
          select: { recipientId: true, action: true, occurredAt: true },
          take: MAX_AUDITS,
        }),
      ])
    : [[], []];

  const first = new Map<string, Date>(); // `${action}:${recipientId}` -> earliest
  for (const a of audits) {
    if (!a.recipientId) continue;
    const key = `${a.action}:${a.recipientId}`;
    const prev = first.get(key);
    if (!prev || a.occurredAt < prev) first.set(key, a.occurredAt);
  }
  const timing = (r: (typeof recipients)[number]): Timing => ({
    recipientId: r.id,
    name: r.name ?? "",
    email: r.email,
    status: r.status,
    templateId: r.templateId,
    sentAt: first.get(`document.email.sent:${r.id}`) ?? null,
    viewedAt: input.canSeeViews
      ? first.get(`recipient.viewed:${r.id}`) ?? null
      : null,
    signedAt:
      first.get(`recipient.signed:${r.id}`) ??
      (r.status === "SIGNED" ? new Date(0) : null),
  });
  const byTemplate = new Map<string, Timing[]>();
  for (const r of recipients) {
    const list = byTemplate.get(r.templateId) ?? [];
    list.push(timing(r));
    byTemplate.set(r.templateId, list);
  }

  const fromMs = range.from.getTime();
  const rows = templates.map((t) => {
    const rs = byTemplate.get(t.id) ?? [];
    const sentAt = rs.reduce<Date | null>(
      (m, r) => (r.sentAt && (!m || r.sentAt < m) ? r.sentAt : m),
      null,
    );
    const waitingOn =
      t.status === "PENDING"
        ? rs
            .filter((r) => !r.signedAt && r.sentAt)
            .map((r) => ({
              name: r.name,
              email: r.email,
              waitingDays:
                Math.round(
                  ((now.getTime() - (r.sentAt as Date).getTime()) / DAY) * 10,
                ) / 10,
            }))
        : [];
    return {
      t,
      rs,
      sentAt,
      waitingOn,
      stuck: waitingOn.some((w) => w.waitingDays >= STUCK_DAYS),
    };
  });
  const inWindow = rows.filter((r) => r.t.createdAt.getTime() >= fromMs);
  const prevWindow = rows.filter((r) => r.t.createdAt.getTime() < fromMs);

  const signHours = (group: typeof rows) =>
    group.flatMap((r) =>
      r.rs
        .filter((x) => x.sentAt && x.signedAt && x.signedAt.getTime() > 0)
        .map(
          (x) =>
            ((x.signedAt as Date).getTime() - (x.sentAt as Date).getTime()) /
            HOUR,
        )
        .filter((h) => h >= 0),
    );
  const count = (group: typeof rows) => ({
    sent: group.filter((r) => r.sentAt).length,
    completed: group.filter((r) => r.t.status === "COMPLETE").length,
    hours: signHours(group),
  });
  const cur = count(inWindow);
  const prev = count(prevWindow);

  const unsignedInPending = inWindow.flatMap((r) =>
    r.t.status === "PENDING" ? r.rs.filter((x) => !x.signedAt) : [],
  );

  const perDay = new Map(
    dayBuckets(range.from, range.to).map((d) => [d, { sent: 0, completed: 0 }]),
  );
  for (const r of inWindow) {
    if (r.sentAt) {
      const b = perDay.get(day(r.sentAt));
      if (b) b.sent += 1;
    }
    if (r.t.completedOn) {
      const b = perDay.get(day(r.t.completedOn));
      if (b) b.completed += 1;
    }
  }

  const statusMix: Record<Status, number> = {
    DRAFT: 0,
    PENDING: 0,
    COMPLETE: 0,
    CANCELLED: 0,
  };
  for (const r of inWindow) statusMix[r.t.status as Status] += 1;

  const bySigner = new Map<string, { name: string; hours: number[] }>();
  for (const r of inWindow)
    for (const x of r.rs) {
      if (!x.sentAt || !x.signedAt || x.signedAt.getTime() === 0) continue;
      const k = x.email.toLowerCase();
      const e = bySigner.get(k) ?? { name: x.name, hours: [] };
      e.hours.push((x.signedAt.getTime() - x.sentAt.getTime()) / HOUR);
      bySigner.set(k, e);
    }

  // list: filters on the window, newest first, keyset cursor
  const signerQ = input.signer?.trim().toLowerCase();
  let list = inWindow.filter(
    (r) =>
      (!input.stuck || r.stuck) &&
      (!signerQ ||
        r.rs.some(
          (x) =>
            x.email.toLowerCase().includes(signerQ) ||
            x.name.toLowerCase().includes(signerQ),
        )),
  );
  let start = 0;
  if (input.cursor) {
    const at = list.findIndex((r) => r.t.id === input.cursor);
    if (at === -1) list = [];
    else start = at + 1;
  }
  const page = list.slice(start, start + limit);
  const items: EnvelopeRow[] = page.map((r) => ({
    templateId: r.t.id,
    publicId: r.t.publicId,
    name: r.t.name,
    status: r.t.status as Status,
    createdAt: r.t.createdAt.toISOString(),
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    completedAt: r.t.completedOn ? r.t.completedOn.toISOString() : null,
    signers: {
      signed: r.rs.filter((x) => x.signedAt).length,
      total: r.rs.length,
    },
    hoursToComplete:
      r.sentAt && r.t.completedOn
        ? (r.t.completedOn.getTime() - r.sentAt.getTime()) / HOUR
        : null,
    waitingOn: r.waitingOn,
    stuck: r.stuck,
  }));

  const allRecipients = inWindow.flatMap((r) => r.rs);
  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      days: range.days,
    },
    canSeeViews: input.canSeeViews,
    kpis: {
      sent: cur.sent,
      completed: cur.completed,
      completionRate: cur.sent ? cur.completed / cur.sent : null,
      medianHoursToSign: median(cur.hours),
      avgHoursToSign: avg(cur.hours),
      pendingSigners: unsignedInPending.length,
      stuckSigners: inWindow
        .flatMap((r) => r.waitingOn)
        .filter((w) => w.waitingDays >= STUCK_DAYS).length,
      previous: {
        sent: prev.sent,
        completed: prev.completed,
        medianHoursToSign: median(prev.hours),
      },
    },
    funnel: {
      sent: allRecipients.filter((x) => x.sentAt).length,
      viewed: input.canSeeViews
        ? allRecipients.filter((x) => x.viewedAt).length
        : null,
      signed: allRecipients.filter((x) => x.signedAt).length,
      completed: cur.completed,
    },
    series: [...perDay.entries()].map(([d, v]) => ({ day: d, ...v })),
    statusMix,
    slowest: [...bySigner.entries()]
      .map(([email, v]) => ({
        email,
        name: v.name,
        signed: v.hours.length,
        medianHours: median(v.hours) as number,
      }))
      .sort((a, b) => b.medianHours - a.medianHours)
      .slice(0, 5),
    envelopes: {
      items,
      nextCursor:
        start + limit < list.length
          ? page[page.length - 1]?.t.id ?? null
          : null,
    },
  };
}

export type EnvelopeDetail = {
  templateId: string;
  name: string;
  status: Status;
  createdAt: string;
  completedAt: string | null;
  signers: {
    recipientId: string;
    name: string;
    email: string;
    status: string;
    sentAt: string | null;
    viewedAt: string | null;
    signedAt: string | null;
    hoursToSign: number | null;
    waitingDays: number | null;
  }[];
  timeline: { at: string; action: string; summary: string }[];
};

export async function getEsignEnvelope(
  db: TPrismaOrTransaction,
  input: { templatePublicId: string; canSeeViews: boolean; now?: Date },
): Promise<EnvelopeDetail | null> {
  const now = input.now ?? new Date();
  const t = await db.template.findFirst({
    where: { publicId: input.templatePublicId },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      completedOn: true,
    },
  });
  if (!t) return null;
  const [recipients, audits] = await Promise.all([
    db.esignRecipient.findMany({
      where: { templateId: t.id },
      select: { id: true, name: true, email: true, status: true },
    }),
    db.esignAudit.findMany({
      where: { templateId: t.id },
      select: {
        recipientId: true,
        action: true,
        summary: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: "asc" },
      take: 500,
    }),
  ]);
  const at = (action: string, id: string) =>
    audits.find((a) => a.action === action && a.recipientId === id)
      ?.occurredAt ?? null;

  return {
    templateId: t.id,
    name: t.name,
    status: t.status as Status,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedOn ? t.completedOn.toISOString() : null,
    signers: recipients.map((r) => {
      const sentAt = at("document.email.sent", r.id);
      const signedAt = at("recipient.signed", r.id);
      const viewedAt = input.canSeeViews ? at("recipient.viewed", r.id) : null;
      return {
        recipientId: r.id,
        name: r.name ?? "",
        email: r.email,
        status: r.status,
        sentAt: sentAt?.toISOString() ?? null,
        viewedAt: viewedAt?.toISOString() ?? null,
        signedAt: signedAt?.toISOString() ?? null,
        hoursToSign:
          sentAt && signedAt
            ? (signedAt.getTime() - sentAt.getTime()) / HOUR
            : null,
        waitingDays:
          sentAt && !signedAt && t.status === "PENDING"
            ? Math.round(((now.getTime() - sentAt.getTime()) / DAY) * 10) / 10
            : null,
      };
    }),
    timeline: input.canSeeViews
      ? audits.map((a) => ({
          at: a.occurredAt.toISOString(),
          action: a.action,
          summary: a.summary,
        }))
      : [],
  };
}
