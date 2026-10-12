import { shareUpdateEmailJob } from "@/jobs/share-update-email";
import { encode } from "@/lib/jwt";
import { effectiveExpiry, isExpired } from "@/server/activity/link-state";
import {
  NUDGE_COOLDOWN_MS,
  UNOPENED_AFTER_DAYS,
} from "@/server/activity/unopened";
import { Audit } from "@/server/audit";
import { companyUrl } from "@/server/domains/links";
import { runSerializable } from "@/server/tenant-guard";
import { withAccessControl } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const nudgeUpdateProcedure = withAccessControl
  .input(z.object({ updateId: z.string(), recipientId: z.string() }))
  .meta({ policies: { updates: { allow: ["update"] } } })
  .mutation(async ({ ctx, input }) => {
    const { session, requestIp, userAgent } = ctx;
    const { db, companyId } = ctx.tenant;
    const { name: senderName, email: senderEmail, id: userId } = session.user;
    const now = new Date();
    const waitedEnough = new Date(
      now.getTime() - UNOPENED_AFTER_DAYS * 86_400_000,
    );

    const rec = await db.updateRecipient.findFirst({
      where: {
        id: input.recipientId,
        updateId: input.updateId,
        update: { companyId, status: "PUBLIC", public: true },
      },
      select: {
        id: true,
        name: true,
        email: true,
        expiresAt: true,
        updatedAt: true,
        lastNudgedAt: true,
        update: {
          select: {
            id: true,
            title: true,
            publicId: true,
            company: { select: { name: true } },
          },
        },
      },
    });
    if (!rec)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Recipient not found",
      });
    if (isExpired(effectiveExpiry(rec.expiresAt, rec.updatedAt), now))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This link has expired. Share again to renew it.",
      });
    if (
      effectiveExpiry(rec.expiresAt, rec.updatedAt).getTime() - now.getTime() <
      NUDGE_COOLDOWN_MS
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This link expires within a day. Share again to renew it.",
      });
    const opened = await db.viewEvent.count({
      where: { companyId, kind: "UPDATE", recipientId: rec.id, isBot: false },
    });
    if (opened)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "They have already opened it.",
      });

    // claim before sending: a double click must send once. Prisma's updateMany is
    // SELECT-then-UPDATE (the filter is not re-checked), so it runs SERIALIZABLE:
    // the loser conflicts, retries, and then finds nothing to claim
    const claimed = await runSerializable((options) =>
      db.$transaction(
        (tx) =>
          tx.updateRecipient.updateMany({
            where: {
              id: rec.id,
              updatedAt: { lte: waitedEnough },
              OR: [
                { lastNudgedAt: null },
                {
                  lastNudgedAt: {
                    lt: new Date(now.getTime() - NUDGE_COOLDOWN_MS),
                  },
                },
              ],
            },
            data: { lastNudgedAt: now },
          }),
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
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Wait a few days after sharing before sending a reminder.",
      });
    if (claimed.count !== 1)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "A reminder was sent in the last 24 hours.",
      });

    // a failed send must not leave the recipient in a 24 h cooldown with no email;
    // updatedAt is restored too, or the claim would restart the 3-day wait
    try {
      const token = await encode({
        companyId,
        updateId: rec.update.id,
        publicId: rec.update.publicId,
        recipientId: rec.id,
      });
      const link = await companyUrl(
        db,
        companyId,
        `/updates/${rec.update.publicId}?token=${token}`,
      );

      await shareUpdateEmailJob.emit({
        senderName: `${senderName}`,
        recipientName: rec.name,
        companyName: rec.update.company.name,
        update: { title: rec.update.title },
        link,
        email: rec.email,
        senderEmail,
        reminder: true,
      });
    } catch (e) {
      await db.updateRecipient.updateMany({
        where: { id: rec.id, lastNudgedAt: now },
        data: { lastNudgedAt: rec.lastNudgedAt, updatedAt: rec.updatedAt },
      });
      throw e;
    }
    await Audit.create(
      {
        action: "update.nudged",
        companyId,
        actor: { type: "user", id: userId },
        context: { userAgent, requestIp },
        target: [{ type: "update", id: rec.update.id }],
        summary: `${senderName} sent a reminder to ${rec.email} for the update ${rec.update.title}`,
      },
      db,
    );
    return { success: true };
  });
