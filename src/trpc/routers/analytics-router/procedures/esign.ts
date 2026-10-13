import { getEsignAnalytics } from "@/server/analytics/esign";
import { canRead } from "@/server/analytics/permissions";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodEsignAnalyticsSchema } from "../schema";

// templates:read for the envelopes; who opened what (viewed times, slowest
// signers' views) additionally needs audits:read.
export const esignProcedure = withAccessControl
  .meta({ policies: { templates: { allow: ["read"] } } })
  .input(ZodEsignAnalyticsSchema)
  .query(({ ctx, input }) =>
    getEsignAnalytics(ctx.tenant.db, {
      ...input,
      canSeeViews: canRead(ctx.permissions, "audits"),
    }),
  );
