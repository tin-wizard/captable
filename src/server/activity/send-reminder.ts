import { shareDataRoomEmailJob } from "@/jobs/share-data-room-email";
import { shareUpdateEmailJob } from "@/jobs/share-update-email";
import { encode } from "@/lib/jwt";
import { MAX_AUTO_NUDGES } from "@/server/activity/cadence";
import { effectiveExpiry, isExpired } from "@/server/activity/link-state";
import {
  NUDGE_COOLDOWN_MS,
  UNOPENED_AFTER_DAYS,
} from "@/server/activity/unopened";
import { Audit } from "@/server/audit";
import type { TPrisma } from "@/server/db";
import { companyUrl } from "@/server/domains/links";
import { runSerializable } from "@/server/tenant-guard";
import { TRPCError } from "@trpc/server";

export type ReminderResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "expired"
        | "expiring"
        | "opened"
        | "cooldown"
        | "too-soon"
        | "not-found"
        | "opted-out";
    };

type Refusal = Extract<ReminderResult, { sent: false }>["reason"];

// the manual nudge mutations throw exactly what they threw before the extraction
const REFUSALS: Record<Refusal, [TRPCError["code"], string]> = {
  "not-found": ["NOT_FOUND", "Recipient not found"],
  expired: ["BAD_REQUEST", "This link has expired. Share again to renew it."],
  expiring: [
    "BAD_REQUEST",
    "This link expires within a day. Share again to renew it.",
  ],
  opened: ["BAD_REQUEST", "They have already opened it."],
  "too-soon": [
    "BAD_REQUEST",
    "Wait a few days after sharing before sending a reminder.",
  ],
  cooldown: ["TOO_MANY_REQUESTS", "A reminder was sent in the last 24 hours."],
  // only automatic reminders honour the opt-out, so the manual path never gets it
  "opted-out": ["BAD_REQUEST", "They have opted out of reminders."],
};

export function throwIfRefused(result: ReminderResult) {
  if (result.sent) return;
  const [code, message] = REFUSALS[result.reason];
  throw new TRPCError({ code, message });
}

// One reminder to one recipient of a data room or an update. `db` may be the
// tenant client or the raw one: every query is scoped by companyId through the
// parent relation. Business refusals are returned, not thrown.
export async function sendReminder(
  db: TPrisma,
  args: {
    companyId: string;
    kind: "DATA_ROOM" | "UPDATE";
    targetId: string;
    recipientId: string;
    sender: { name: string; email?: string | null };
    actor: { type: "user" | "company"; id: string };
    // used by the hourly auto-nudge job: the waited-since threshold for its step
    auto?: { minWaitDays: number };
    context?: { requestIp: string; userAgent: string };
  },
): Promise<ReminderResult> {
  const { companyId, kind, targetId, recipientId, sender } = args;
  const isRoom = kind === "DATA_ROOM";
  const now = new Date();
  const waitedEnough = new Date(
    now.getTime() -
      (args.auto?.minWaitDays ?? UNOPENED_AFTER_DAYS) * 86_400_000,
  );

  const recipientSelect = {
    id: true,
    name: true,
    email: true,
    expiresAt: true,
    updatedAt: true,
    lastNudgedAt: true,
    nudgeCount: true,
    nudgeOptOut: true,
  } as const;
  const parentSelect = {
    id: true,
    publicId: true,
    company: { select: { name: true } },
  } as const;
  const rec = isRoom
    ? await db.dataRoomRecipient
        .findFirst({
          where: {
            id: recipientId,
            dataRoomId: targetId,
            dataRoom: { companyId },
          },
          select: {
            ...recipientSelect,
            dataRoom: { select: { ...parentSelect, name: true } },
          },
        })
        .then(
          (r) =>
            r && { ...r, parent: { ...r.dataRoom, title: r.dataRoom.name } },
        )
    : await db.updateRecipient
        .findFirst({
          where: {
            id: recipientId,
            updateId: targetId,
            update: { companyId, status: "PUBLIC", public: true },
          },
          select: {
            ...recipientSelect,
            update: { select: { ...parentSelect, title: true } },
          },
        })
        .then((r) => r && { ...r, parent: r.update });
  if (!rec) return { sent: false, reason: "not-found" };
  if (args.auto && rec.nudgeOptOut) return { sent: false, reason: "opted-out" };
  if (args.auto && rec.nudgeCount >= MAX_AUTO_NUDGES)
    return { sent: false, reason: "cooldown" };
  if (isExpired(effectiveExpiry(rec.expiresAt, rec.updatedAt), now))
    return { sent: false, reason: "expired" };
  if (
    effectiveExpiry(rec.expiresAt, rec.updatedAt).getTime() - now.getTime() <
    NUDGE_COOLDOWN_MS
  )
    return { sent: false, reason: "expiring" };
  const opened = await db.viewEvent.count({
    where: { companyId, kind, recipientId: rec.id, isBot: false },
  });
  if (opened) return { sent: false, reason: "opened" };

  // claim before sending: a double click must send once. Prisma's updateMany is
  // SELECT-then-UPDATE (the filter is not re-checked), so it runs SERIALIZABLE:
  // the loser conflicts, retries, and then finds nothing to claim
  const claim = {
    where: {
      id: rec.id,
      updatedAt: { lte: waitedEnough },
      // the per-recipient cap is enforced here, not only in the job's query
      ...(args.auto && { nudgeCount: { lt: MAX_AUTO_NUDGES } }),
      OR: [
        { lastNudgedAt: null },
        {
          lastNudgedAt: {
            lt: new Date(now.getTime() - NUDGE_COOLDOWN_MS),
          },
        },
      ],
    },
    // a manual reminder counts as one of the automatic two
    data: { lastNudgedAt: now, nudgeCount: { increment: 1 } },
  };
  const claimed = await runSerializable((options) =>
    db.$transaction(
      (tx) =>
        isRoom
          ? tx.dataRoomRecipient.updateMany(claim)
          : tx.updateRecipient.updateMany(claim),
      options,
    ),
  );
  // the 3-day wait is in the claim too, so it is atomic with the cooldown;
  // a recent nudge also bumps updatedAt, so report the cooldown for that case
  if (
    claimed.count !== 1 &&
    rec.updatedAt > waitedEnough &&
    !(
      rec.lastNudgedAt &&
      now.getTime() - rec.lastNudgedAt.getTime() < NUDGE_COOLDOWN_MS
    )
  )
    return { sent: false, reason: "too-soon" };
  if (claimed.count !== 1) return { sent: false, reason: "cooldown" };

  // a failed send must not leave the recipient in a 24 h cooldown with no email;
  // updatedAt is restored too, or the claim would restart the 3-day wait
  try {
    const token = await encode(
      isRoom
        ? { companyId, dataRoomId: rec.parent.id, recipientId: rec.id }
        : {
            companyId,
            updateId: rec.parent.id,
            publicId: rec.parent.publicId,
            recipientId: rec.id,
          },
    );
    const link = await companyUrl(
      db,
      companyId,
      `/${isRoom ? "data-rooms" : "updates"}/${
        rec.parent.publicId
      }?token=${token}`,
    );
    // only automatic reminders carry an opt-out (a person pressing the button
    // already knows who is asking)
    const unsubscribeLink = args.auto
      ? await companyUrl(
          db,
          companyId,
          `/unsubscribed?kind=${kind}&token=${token}`,
        )
      : undefined;
    const mail = {
      senderName: sender.name,
      recipientName: rec.name,
      companyName: rec.parent.company.name,
      link,
      email: rec.email,
      senderEmail: sender.email,
      reminder: true,
      ...(unsubscribeLink && { unsubscribeLink }),
    };
    if (isRoom)
      await shareDataRoomEmailJob.emit({ ...mail, dataRoom: rec.parent.title });
    else
      await shareUpdateEmailJob.emit({
        ...mail,
        update: { title: rec.parent.title },
      });
  } catch (e) {
    const release = {
      where: { id: rec.id, lastNudgedAt: now },
      data: {
        lastNudgedAt: rec.lastNudgedAt,
        updatedAt: rec.updatedAt,
        nudgeCount: rec.nudgeCount,
      },
    };
    await (isRoom
      ? db.dataRoomRecipient.updateMany(release)
      : db.updateRecipient.updateMany(release));
    throw e;
  }
  await Audit.create(
    {
      action: isRoom ? "dataroom.nudged" : "update.nudged",
      companyId,
      actor: args.actor,
      // the hourly job has no request to record
      context: args.context ?? { requestIp: "", userAgent: "" },
      target: [{ type: isRoom ? "dataroom" : "update", id: rec.parent.id }],
      summary: `${sender.name} sent a reminder to ${rec.email} for the ${
        isRoom ? "data room" : "update"
      } ${rec.parent.title}`,
    },
    db,
  );
  return { sent: true };
}
