import { Audit } from "@/server/audit";
import { assertTenantOwns } from "@/server/tenant-guard";
import {
  createTRPCRouter,
  withAccessControl,
  withTenant,
} from "@/trpc/api/trpc";
import { EquityPlanMutationSchema } from "./schema";

export const equityPlanRouter = createTRPCRouter({
  getPlans: withTenant.query(async ({ ctx }) => {
    const { tenant } = ctx;

    const data = await tenant.db.$transaction(async (tx) => {
      const { companyId } = ctx.tenant;

      const data = await tx.equityPlan.findMany({
        where: {
          companyId,
        },

        orderBy: {
          createdAt: "desc",
        },
      });

      return data;
    });

    return { data };
  }),

  create: withAccessControl
    .input(EquityPlanMutationSchema)
    .meta({ policies: { "cap-table-settings": { allow: ["create"] } } })
    .mutation(async ({ ctx, input }) => {
      const { userAgent, requestIp } = ctx;

      try {
        await ctx.tenant.db.$transaction(async (tx) => {
          const { companyId } = ctx.tenant;
          await assertTenantOwns(tx, companyId, input);

          const data = {
            companyId,
            name: input.name,
            planEffectiveDate: input.planEffectiveDate
              ? new Date(input.planEffectiveDate)
              : null,
            boardApprovalDate: new Date(input.boardApprovalDate),
            initialSharesReserved: input.initialSharesReserved,
            shareClassId: input.shareClassId,
            comments: input.comments,
            defaultCancellatonBehavior: input.defaultCancellatonBehavior,
          };

          await tx.equityPlan.create({ data });
          await Audit.create(
            {
              action: "equityPlan.created",
              companyId,
              actor: { type: "user", id: ctx.session.user.id },
              context: {
                requestIp,
                userAgent,
              },
              target: [{ type: "company", id: companyId }],
              summary: `${ctx.session.user.name} created an equity plan - ${input.name}`,
            },
            tx,
          );
        });

        return { success: true, message: "Equity plan created successfully." };
      } catch (error) {
        console.error("Error creating an equity plan:", error);
        return {
          success: false,
          message: "Oops, something went wrong. Please try again later.",
        };
      }
    }),

  update: withAccessControl
    .input(EquityPlanMutationSchema)
    .meta({ policies: { "cap-table-settings": { allow: ["update"] } } })
    .mutation(async ({ ctx, input }) => {
      try {
        const { userAgent, requestIp } = ctx;

        await ctx.tenant.db.$transaction(async (tx) => {
          const { companyId } = ctx.tenant;
          await assertTenantOwns(tx, companyId, input);

          const data = {
            name: input.name,
            planEffectiveDate: input.planEffectiveDate
              ? new Date(input.planEffectiveDate)
              : null,
            boardApprovalDate: new Date(input.boardApprovalDate),
            initialSharesReserved: input.initialSharesReserved,
            shareClassId: input.shareClassId,
            comments: input.comments,
            defaultCancellatonBehavior: input.defaultCancellatonBehavior,
          };

          await tx.equityPlan.update({
            where: { id: input.id, companyId },
            data,
          });

          await Audit.create(
            {
              action: "equityPlan.updated",
              companyId,
              actor: { type: "user", id: ctx.session.user.id },
              context: {
                requestIp,
                userAgent,
              },
              target: [{ type: "company", id: companyId }],
              summary: `${ctx.session.user.name} updated an equity plan - ${input.name}`,
            },
            tx,
          );
        });

        return { success: true, message: "Equity plan updated successfully." };
      } catch (error) {
        console.error("Error updating an equity plan:", error);
        return {
          success: false,
          message: "Oops, something went wrong. Please try again later.",
        };
      }
    }),
});
