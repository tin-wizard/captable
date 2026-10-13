import {
  type DocumentAnalytics,
  getDocumentAnalytics,
} from "@/server/analytics/document";
import { canRead } from "@/server/analytics/permissions";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodDocumentAnalyticsSchema } from "../schema";
import { assertSourceRead, resolveTarget } from "./target";

export const documentProcedure = withAccessControl
  .meta({ policies: { audits: { allow: ["read"] } } })
  .input(ZodDocumentAnalyticsSchema)
  .query(async ({ ctx, input }): Promise<DocumentAnalytics | null> => {
    assertSourceRead(ctx.permissions, input.kind);
    const { db, companyId } = ctx.tenant;
    // unknown or foreign targets look exactly like "no data"
    const targetId = await resolveTarget(
      db as never,
      input.kind,
      input.targetPublicId,
    );
    if (!targetId) return null;
    const { timezone: tz } = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });

    return getDocumentAnalytics(db, {
      ...input,
      targetId,
      tz,
      canSeeHoldings: canRead(ctx.permissions, "securities"),
    });
  });
