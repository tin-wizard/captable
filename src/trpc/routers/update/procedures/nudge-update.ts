import { sendReminder, throwIfRefused } from "@/server/activity/send-reminder";
import { withAccessControl } from "@/trpc/api/trpc";
import { z } from "zod";

export const nudgeUpdateProcedure = withAccessControl
  .input(z.object({ updateId: z.string(), recipientId: z.string() }))
  .meta({ policies: { updates: { allow: ["update"] } } })
  .mutation(async ({ ctx, input }) => {
    const { session, requestIp, userAgent } = ctx;
    const { db, companyId } = ctx.tenant;
    const { name: senderName, email: senderEmail, id: userId } = session.user;

    throwIfRefused(
      await sendReminder(db, {
        companyId,
        kind: "UPDATE",
        targetId: input.updateId,
        recipientId: input.recipientId,
        sender: { name: `${senderName}`, email: senderEmail },
        actor: { type: "user", id: userId },
        context: { requestIp, userAgent },
      }),
    );
    return { success: true };
  });
