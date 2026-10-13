import { LINK_TTL_MS, effectiveExpiry } from "@/server/activity/link-state";
import type { TPrismaOrTransaction } from "@/server/db";

export const UNOPENED_AFTER_DAYS = 3;
export const NUDGE_COOLDOWN_MS = 24 * 3600 * 1000;
const CAP = 200;
// shortcut: 50 pages of candidates per kind, raise when a company needs more
const MAX_PAGES = 50;

type Page = { id: string; updatedAt: Date };
// keyset: rows strictly after the last one seen, in (updatedAt, id) order
const after = (last?: Page) =>
  last
    ? [
        {
          OR: [
            { updatedAt: { gt: last.updatedAt } },
            { updatedAt: last.updatedAt, id: { gt: last.id } },
          ],
        },
      ]
    : [];

// Works with the tenant client and the raw client: companyId is always filtered
// through the parent relation, so it is safe from the digest job as well.
export async function findUnopened(
  tx: TPrismaOrTransaction,
  companyId: string,
  opts: {
    kind?: "DATA_ROOM" | "UPDATE";
    targetId?: string;
    now?: Date;
    cap?: number;
    batch?: number;
    maxPages?: number;
    // only rows whose updatedAt is after this (bounds the window in the query,
    // before the cap)
    newerThan?: Date;
  } = {},
): Promise<Unopened[]> {
  const now = opts.now ?? new Date();
  const cap = opts.cap ?? CAP;
  const batch = opts.batch ?? cap;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const waitedEnough = new Date(
    now.getTime() - UNOPENED_AFTER_DAYS * 86_400_000,
  );
  // a null expiresAt (link sent before Phase 3) lives as long as its token
  const live = {
    OR: [
      { expiresAt: { gt: now } },
      {
        expiresAt: null,
        updatedAt: { gt: new Date(now.getTime() - LINK_TTL_MS) },
      },
    ],
  };
  const window = [
    { updatedAt: { lte: waitedEnough } },
    ...(opts.newerThan ? [{ updatedAt: { gt: opts.newerThan } }] : []),
  ];
  const orderBy = [{ updatedAt: "asc" as const }, { id: "asc" as const }];

  // page through candidates until `cap` unopened rows or none left, so opened
  // rows never crowd the unopened ones out
  async function unopenedOf<T extends Page>(
    fetch: (last?: Page) => Promise<T[]>,
  ): Promise<T[]> {
    const out: T[] = [];
    let last: T | undefined;
    for (let page = 0; page < maxPages; page++) {
      const rows = await fetch(last);
      if (!rows.length) break;
      // recipient ids are cuids, unique across both tables, so no kind filter is needed
      const opened = new Set(
        (
          await tx.viewEvent.findMany({
            where: {
              companyId,
              isBot: false,
              recipientId: { in: rows.map((r) => r.id) },
            },
            select: { recipientId: true },
            distinct: ["recipientId"],
          })
        ).map((e) => e.recipientId),
      );
      out.push(...rows.filter((r) => !opened.has(r.id)));
      if (out.length >= cap || rows.length < batch) break;
      last = rows[rows.length - 1];
    }
    return out.slice(0, cap);
  }

  const [rooms, updates] = await Promise.all([
    opts.kind === "UPDATE"
      ? []
      : unopenedOf((last) =>
          tx.dataRoomRecipient.findMany({
            where: {
              AND: [...window, live, ...after(last)],
              dataRoom: { companyId },
              ...(opts.targetId && { dataRoomId: opts.targetId }),
            },
            select: {
              id: true,
              email: true,
              name: true,
              updatedAt: true,
              expiresAt: true,
              lastNudgedAt: true,
              nudgeCount: true,
              nudgeOptOut: true,
              dataRoom: {
                select: {
                  id: true,
                  name: true,
                  publicId: true,
                  createdById: true,
                },
              },
            },
            orderBy,
            take: batch,
          }),
        ),
    opts.kind === "DATA_ROOM"
      ? []
      : unopenedOf((last) =>
          tx.updateRecipient.findMany({
            where: {
              AND: [...window, live, ...after(last)],
              update: { companyId, status: "PUBLIC", public: true },
              ...(opts.targetId && { updateId: opts.targetId }),
            },
            select: {
              id: true,
              email: true,
              name: true,
              updatedAt: true,
              expiresAt: true,
              lastNudgedAt: true,
              nudgeCount: true,
              nudgeOptOut: true,
              update: {
                select: {
                  id: true,
                  title: true,
                  publicId: true,
                  authorId: true,
                },
              },
            },
            orderBy,
            take: batch,
          }),
        ),
  ]);

  // a nudge bumps updatedAt, so the recipient leaves this list for 3 days by
  // design; the nudge mutation enforces the 24 h cooldown itself
  const cooled = (d: Date | null) =>
    d === null || now.getTime() - d.getTime() >= NUDGE_COOLDOWN_MS;
  // a nudge does not renew the link, so one dying within a day is not worth one
  const nudgeable = (r: {
    lastNudgedAt: Date | null;
    expiresAt: Date | null;
    updatedAt: Date;
  }) =>
    cooled(r.lastNudgedAt) &&
    effectiveExpiry(r.expiresAt, r.updatedAt).getTime() - now.getTime() >=
      NUDGE_COOLDOWN_MS;

  return [
    ...rooms.map((r) => ({
      kind: "DATA_ROOM" as const,
      targetId: r.dataRoom.id,
      targetName: r.dataRoom.name,
      targetPublicId: r.dataRoom.publicId,
      ownerMemberId: r.dataRoom.createdById,
      recipientId: r.id,
      email: r.email,
      name: r.name,
      waitingSince: r.updatedAt,
      lastNudgedAt: r.lastNudgedAt,
      nudgeCount: r.nudgeCount,
      nudgeOptOut: r.nudgeOptOut,
      nudgeable: nudgeable(r),
    })),
    ...updates.map((r) => ({
      kind: "UPDATE" as const,
      targetId: r.update.id,
      targetName: r.update.title,
      targetPublicId: r.update.publicId,
      ownerMemberId: r.update.authorId,
      recipientId: r.id,
      email: r.email,
      name: r.name,
      waitingSince: r.updatedAt,
      lastNudgedAt: r.lastNudgedAt,
      nudgeCount: r.nudgeCount,
      nudgeOptOut: r.nudgeOptOut,
      nudgeable: nudgeable(r),
    })),
  ];
}

export type Unopened = {
  kind: "DATA_ROOM" | "UPDATE";
  targetId: string;
  targetName: string;
  targetPublicId: string;
  ownerMemberId: string | null;
  recipientId: string;
  email: string;
  name: string | null;
  waitingSince: Date;
  lastNudgedAt: Date | null;
  nudgeCount: number;
  nudgeOptOut: boolean;
  nudgeable: boolean;
};
// shortcut: capped at 200 unopened per kind and "waiting since" is the row's
// updatedAt, which any edit bumps; add a sharedAt column if that proves noisy.
