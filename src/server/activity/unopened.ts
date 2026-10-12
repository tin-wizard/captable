import type { TPrismaOrTransaction } from "@/server/db";

export const UNOPENED_AFTER_DAYS = 3;
export const NUDGE_COOLDOWN_MS = 24 * 3600 * 1000;
const CAP = 200;

// Works with the tenant client and the raw client: companyId is always filtered
// through the parent relation, so it is safe from the digest job as well.
export async function findUnopened(
  tx: TPrismaOrTransaction,
  companyId: string,
  opts: { kind?: "DATA_ROOM" | "UPDATE"; targetId?: string; now?: Date } = {},
): Promise<Unopened[]> {
  const now = opts.now ?? new Date();
  const waitedEnough = new Date(
    now.getTime() - UNOPENED_AFTER_DAYS * 86_400_000,
  );
  const live = [{ expiresAt: null }, { expiresAt: { gt: now } }];
  const base = { updatedAt: { lte: waitedEnough }, OR: live };

  const [rooms, updates] = await Promise.all([
    opts.kind === "UPDATE"
      ? []
      : tx.dataRoomRecipient.findMany({
          where: {
            ...base,
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
          orderBy: { updatedAt: "asc" },
          take: CAP,
        }),
    opts.kind === "DATA_ROOM"
      ? []
      : tx.updateRecipient.findMany({
          where: {
            ...base,
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
              select: { id: true, title: true, publicId: true, authorId: true },
            },
          },
          orderBy: { updatedAt: "asc" },
          take: CAP,
        }),
  ]);

  const ids = [...rooms.map((r) => r.id), ...updates.map((r) => r.id)];
  if (!ids.length) return [];
  // recipient ids are cuids, unique across both tables, so no kind filter is needed
  const opened = new Set(
    (
      await tx.viewEvent.findMany({
        where: { companyId, isBot: false, recipientId: { in: ids } },
        select: { recipientId: true },
        distinct: ["recipientId"],
      })
    ).map((e) => e.recipientId),
  );
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
  ].filter((i) => !opened.has(i.recipientId));
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
// shortcut: capped at 200 per kind and "waiting since" is the row's updatedAt,
// which any edit bumps; add a sharedAt column if that proves noisy.
