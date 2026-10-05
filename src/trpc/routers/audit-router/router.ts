import { createTRPCRouter, withAccessControl } from "@/trpc/api/trpc";
import { allEsignAuditsProcedure } from "./procedures/all-esign-audits";
import { ZodGetAuditsQuerySchema } from "./schema";

export const auditRouter = createTRPCRouter({
  getAudits: withAccessControl
    .meta({ policies: { audits: { allow: ["read"] } } })
    .input(ZodGetAuditsQuerySchema)
    .query(async ({ ctx, input }) => {
      const { tenant } = ctx;
      const { companyId } = tenant;

      const data = await tenant.db.$transaction(async (tx) => {
        const data = await tx.audit.findMany({
          where: { companyId },
          orderBy: {
            occurredAt: "desc",
          },
          ...input,
        });
        return data;
      });

      return { data };
    }),

  allEsignAudits: allEsignAuditsProcedure,
});
