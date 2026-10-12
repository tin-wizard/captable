import type { TPrismaOrTransaction } from "@/server/db";

export const UNOPENED_AFTER_DAYS = 3;
export const NUDGE_COOLDOWN_MS = 24 * 3600 * 1000;
const CAP = 200;

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
  } = {},
): Promise<Unopened[]> {
  const now = opts.now ?? new Date();
  const cap = opts.cap ?? CAP;
  const batch = opts.batch ?? cap;
  const waitedEnough = new Date(
    now.getTime() - UNOPENED_AFTER_DAYS * 86_400_000,
  );
  const live = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  const base = { updatedAt: { lte: waitedEnough } };
  const orderBy = [{ updatedAt: "asc" as const }, { id: "asc" as const }];

  // page through candidates until `cap` unopened rows or none left, so opened
  // rows never crowd the unopened ones out
  async function unopenedOf<T extends Page>(
    fetch: (last?: Page) => Promise<T[]>,
  ): Promise<T[]> {
    const out: T[] = [];
    let last: T | undefined;
    for (;;) {
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
              ...base,
              AND: [live, ...after(last)],
              dataRoom: { companyId },
              ...(opts.targetId && { dataRoomId: opts.targetId }),
            },
            select: {
              id: true,
              email: true,
              name: true,
              updatedAt: true,
              lastNudgedAt: true,
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
              ...base,
              AND: [live, ...after(last)],
              update: { companyId, status: "PUBLIC", public: true },
              ...(opts.targetId && { updateId: opts.targetId }),
            },
            select: {
              id: true,
              email: true,
              name: true,
              updatedAt: true,
              lastNudgedAt: true,
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
      nudgeable: cooled(r.lastNudgedAt),
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
      nudgeable: cooled(r.lastNudgedAt),
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
  nudgeable: boolean;
};
// shortcut: capped at 200 unopened per kind and "waiting since" is the row's
// updatedAt, which any edit bumps; add a sharedAt column if that proves noisy.
