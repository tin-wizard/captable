import { getEsignEnvelope } from "@/server/analytics/esign";
import { canRead } from "@/server/analytics/permissions";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodEsignEnvelopeSchema } from "../schema";

export const esignEnvelopeProcedure = withAccessControl
  .meta({ policies: { templates: { allow: ["read"] } } })
  .input(ZodEsignEnvelopeSchema)
  .query(({ ctx, input }) =>
    getEsignEnvelope(ctx.tenant.db, {
      templatePublicId: input.templatePublicId,
      canSeeViews: canRead(ctx.permissions, "audits"),
    }),
  );
