import { getEsignAnalytics } from "@/server/analytics/esign";
import { canRead } from "@/server/analytics/permissions";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodEsignAnalyticsSchema } from "../schema";

// templates:read for the envelopes; who opened what (viewed times, slowest
// signers' views) additionally needs audits:read.
export const esignProcedure = withAccessControl
  .meta({ policies: { templates: { allow: ["read"] } } })
  .input(ZodEsignAnalyticsSchema)
  .query(async ({ ctx, input }) => {
    const { db, companyId } = ctx.tenant;
    const { timezone: tz } = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });
    return getEsignAnalytics(db, {
      ...input,
      tz,
      canSeeViews: canRead(ctx.permissions, "audits"),
    });
  });
