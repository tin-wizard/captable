import { Audit } from "@/server/audit";
import { withAccessControl } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const setAutoNudgeProcedure = withAccessControl
  .input(z.object({ updateId: z.string(), enabled: z.boolean() }))
  .meta({ policies: { updates: { allow: ["update"] } } })
  .mutation(async ({ ctx, input }) => {
    const { db, companyId } = ctx.tenant;
    const { user } = ctx.session;
    const update = await db.update.findFirst({
      where: { id: input.updateId, companyId },
      select: { id: true, title: true },
    });
    if (!update) throw new TRPCError({ code: "NOT_FOUND" });

    await db.$transaction(async (tx) => {
      await tx.update.update({
        where: { id: update.id },
        data: { autoNudge: input.enabled },
      });
      await Audit.create(
        {
          action: "update.updated",
          companyId,
          actor: { type: "user", id: user.id },
          context: { userAgent: ctx.userAgent, requestIp: ctx.requestIp },
          target: [{ type: "update", id: update.id }],
          summary: `${user.name} turned automatic reminders ${
            input.enabled ? "on" : "off"
          } for the update ${update.title}`,
        },
        tx,
      );
    });
    return { enabled: input.enabled };
  });

export const stopUpdateRemindersProcedure = withAccessControl
  .input(
    z.object({
      updateId: z.string(),
      recipientId: z.string(),
      stopped: z.boolean(),
    }),
  )
  .meta({ policies: { updates: { allow: ["update"] } } })
  .mutation(async ({ ctx, input }) => {
    const { db, companyId } = ctx.tenant;
    const { user } = ctx.session;
    const rec = await db.updateRecipient.findFirst({
      where: {
        id: input.recipientId,
        updateId: input.updateId,
        update: { companyId },
      },
      select: {
        id: true,
        email: true,
        updatedAt: true,
        update: { select: { id: true, title: true } },
      },
    });
    if (!rec) throw new TRPCError({ code: "NOT_FOUND" });

    await db.$transaction(async (tx) => {
      await tx.updateRecipient.update({
        where: { id: rec.id },
        // updatedAt is passed so the 3-day wait of the reminder claim is not restarted
        data: { nudgeOptOut: input.stopped, updatedAt: rec.updatedAt },
      });
      await Audit.create(
        {
          action: "update.updated",
          companyId,
          actor: { type: "user", id: user.id },
          context: { userAgent: ctx.userAgent, requestIp: ctx.requestIp },
          target: [{ type: "update", id: rec.update.id }],
          summary: `${user.name} ${
            input.stopped ? "stopped" : "resumed"
          } automatic reminders to ${rec.email} for the update ${
            rec.update.title
          }`,
        },
        tx,
      );
    });
    return { stopped: input.stopped };
  });
