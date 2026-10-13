import { isValidTimezone } from "@/lib/timezone";
import { Audit } from "@/server/audit";
import { withAccessControl } from "@/trpc/api/trpc";
import { z } from "zod";

export const preferencesProcedure = withAccessControl
  .meta({ policies: { company: { allow: ["read"] } } })
  .query(({ ctx }) =>
    ctx.tenant.db.company.findFirstOrThrow({
      where: { id: ctx.tenant.companyId },
      select: { timezone: true, viewRetentionMonths: true, autoNudge: true },
    }),
  );

export const updatePreferencesProcedure = withAccessControl
  .meta({ policies: { company: { allow: ["update"] } } })
  .input(
    z.object({
      timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
      viewRetentionMonths: z.union([
        z.literal(6),
        z.literal(12),
        z.literal(24),
        z.literal(36),
        z.null(),
      ]),
      // optional so callers from before the switch keep working
      autoNudge: z.boolean().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { db, companyId } = ctx.tenant;
    const { user } = ctx.session;

    const company = await db.company.update({
      where: { id: companyId },
      data: input,
      select: { name: true },
    });

    await Audit.create(
      {
        action: "company.updated",
        companyId,
        actor: { type: "user", id: user.id },
        context: { userAgent: ctx.userAgent, requestIp: ctx.requestIp },
        target: [{ type: "company", id: companyId }],
        summary: `${user.name} changed company preferences for ${company.name}`,
      },
      db,
    );

    return input;
  });
