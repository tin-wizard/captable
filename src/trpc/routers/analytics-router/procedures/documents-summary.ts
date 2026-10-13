import { getDocumentsSummary } from "@/server/analytics/document";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodDocumentsSummarySchema } from "../schema";
import { assertSourceRead } from "./target";

export const documentsSummaryProcedure = withAccessControl
  .meta({ policies: { audits: { allow: ["read"] } } })
  .input(ZodDocumentsSummarySchema)
  .query(async ({ ctx, input }) => {
    assertSourceRead(ctx.permissions, input.kind);
    const { db, companyId } = ctx.tenant;
    return {
      items: await getDocumentsSummary(db, companyId, input),
    };
  });
