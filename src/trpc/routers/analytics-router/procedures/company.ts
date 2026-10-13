import { getCompanyEngagement } from "@/server/analytics/company";
import { getEsignAnalytics } from "@/server/analytics/esign";
import { getHoldings } from "@/server/analytics/holdings";
import { canRead } from "@/server/analytics/permissions";
import { withAccessControl } from "@/trpc/api/trpc";
import { z } from "zod";
import { ZodRange } from "../schema";

// The Reports page. Each block is present only when the caller's role may read
// its source, so a role never receives a total it could not see elsewhere.
export const companyProcedure = withAccessControl
  .input(z.object({ ...ZodRange }))
  .query(async ({ ctx, input }) => {
    const { db, companyId } = ctx.tenant;
    const perms = ctx.permissions;
    const audits = canRead(perms, "audits");
    const { timezone: tz } = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });

    const [engagement, esign, holdings] = await Promise.all([
      audits && (canRead(perms, "data-rooms") || canRead(perms, "updates"))
        ? getCompanyEngagement(db, companyId, { ...input, tz })
        : null,
      canRead(perms, "templates")
        ? getEsignAnalytics(db, {
            ...input,
            tz,
            limit: 5,
            canSeeViews: audits,
          })
        : null,
      canRead(perms, "securities") ? getHoldings(db) : null,
    ]);
    return { engagement, esign, holdings };
  });
