import { assertTenantOwns } from "@/server/tenant-guard";
import { createTRPCRouter, withTenant } from "@/trpc/api/trpc";
import { ShareClassMutationSchema } from "./schema";

import { Audit } from "@/server/audit";

export const shareClassRouter = createTRPCRouter({
  create: withTenant
    .input(ShareClassMutationSchema)
    .mutation(async ({ ctx, input }) => {
      const { userAgent, requestIp } = ctx;

      try {
        const prefix = (input.classType === "COMMON" ? "CS" : "PS") as
          | "CS"
          | "PS";

        await ctx.tenant.db.$transaction(async (tx) => {
          const { companyId } = ctx.tenant;

          const maxIdx = await tx.shareClass.count({
            where: {
              companyId,
            },
          });

          await assertTenantOwns(tx, companyId, {
            shareClassId: input.convertsToShareClassId,
          });

          const idx = maxIdx + 1;
          const data = {
            idx,
            prefix,
            companyId,
            name: input.name,
            classType: input.classType,
            initialSharesAuthorized: input.initialSharesAuthorized,
            boardApprovalDate: new Date(input.boardApprovalDate),
            stockholderApprovalDate: new Date(input.stockholderApprovalDate),
            votesPerShare: input.votesPerShare,
            parValue: input.parValue,
            pricePerShare: input.pricePerShare,
            seniority: input.seniority,
            conversionRights: input.conversionRights,
            convertsToShareClassId: input.convertsToShareClassId,
            liquidationPreferenceMultiple: input.liquidationPreferenceMultiple,
            participationCapMultiple: input.participationCapMultiple,
          };

          await tx.shareClass.create({ data });

          await Audit.create(
            {
              action: "shareClass.created",
              companyId,
              actor: { type: "user", id: ctx.session.user.id },
              context: {
                userAgent,
                requestIp,
              },
              target: [{ type: "company", id: companyId }],
              summary: `${ctx.session.user.name} created a share class - ${input.name}`,
            },
            tx,
          );
        });

        return { success: true, message: "Share class created successfully." };
      } catch (error) {
        console.error("Error creating shareClass:", error);
        return {
          success: false,
          message: "Oops, something went wrong. Please try again later.",
        };
      }
    }),

  update: withTenant
    .input(ShareClassMutationSchema)
    .mutation(async ({ ctx, input }) => {
      const { userAgent, requestIp } = ctx;

      try {
        const prefix = (input.classType === "COMMON" ? "CS" : "PS") as
          | "CS"
          | "PS";

        await ctx.tenant.db.$transaction(async (tx) => {
          const { companyId } = ctx.tenant;

          await assertTenantOwns(tx, companyId, {
            shareClassId: input.convertsToShareClassId,
          });

          const data = {
            prefix,
            name: input.name,
            classType: input.classType,
            initialSharesAuthorized: input.initialSharesAuthorized,
            boardApprovalDate: new Date(input.boardApprovalDate),
            stockholderApprovalDate: new Date(input.stockholderApprovalDate),
            votesPerShare: input.votesPerShare,
            parValue: input.parValue,
            pricePerShare: input.pricePerShare,
            seniority: input.seniority,
            conversionRights: input.conversionRights,
            convertsToShareClassId: input.convertsToShareClassId,
            liquidationPreferenceMultiple: input.liquidationPreferenceMultiple,
            participationCapMultiple: input.participationCapMultiple,
          };

          await tx.shareClass.update({
            where: { id: input.id, companyId },
            data,
          });

          await Audit.create(
            {
              action: "shareClass.updated",
              companyId,
              actor: { type: "user", id: ctx.session.user.id },
              context: {
                userAgent,
                requestIp,
              },
              target: [{ type: "company", id: companyId }],
              summary: `${ctx.session.user.name} updated a share class - ${input.name}`,
            },
            tx,
          );
        });

        return { success: true, message: "Share class updated successfully." };
      } catch (error) {
        console.error("Error updating shareClass:", error);
        return {
          success: false,
          message: "Oops, something went wrong. Please try again later.",
        };
      }
    }),

  get: withTenant.query(async ({ ctx: { tenant } }) => {
    const shareClass = await tenant.db.$transaction(async (tx) => {
      const { companyId } = tenant;

      return await tx.shareClass.findMany({
        where: {
          companyId,
        },
        select: {
          id: true,
          name: true,
          company: {
            select: {
              name: true,
            },
          },
        },
      });
    });
    return shareClass;
  }),
});
