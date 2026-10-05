import { generatePublicId } from "@/common/id";
import { Audit } from "@/server/audit";
import { assertBucketUsable, assertTenantOwns } from "@/server/tenant-guard";
import { withTenant } from "@/trpc/api/trpc";
import { ZodAddOptionMutationSchema } from "../schema";

export const addOptionProcedure = withTenant
  .input(ZodAddOptionMutationSchema)
  .mutation(async ({ ctx, input }) => {
    const { userAgent, requestIp } = ctx;
    try {
      const user = ctx.session.user;
      const documents = input.documents;

      await ctx.tenant.db.$transaction(async (tx) => {
        const { companyId } = ctx.tenant;

        await assertTenantOwns(tx, companyId, input);

        const data = {
          companyId,
          stakeholderId: input.stakeholderId,
          equityPlanId: input.equityPlanId,
          notes: input.notes,
          grantId: input.grantId,
          quantity: input.quantity,
          exercisePrice: input.exercisePrice,
          type: input.type,
          status: input.status,
          cliffYears: input.cliffYears,
          vestingYears: input.vestingYears,
          issueDate: new Date(input.issueDate),
          expirationDate: new Date(input.expirationDate),
          vestingStartDate: new Date(input.vestingStartDate),
          boardApprovalDate: new Date(input.boardApprovalDate),
          rule144Date: new Date(input.rule144Date),
        };

        const option = await tx.option.create({ data });

        for (const doc of documents) {
          await assertBucketUsable(tx, companyId, doc.bucketId);
        }

        const bulkDocuments = documents.map((doc) => ({
          companyId,
          uploaderId: user.memberId,
          publicId: generatePublicId(),
          name: doc.name,
          bucketId: doc.bucketId,
          optionId: option.id,
        }));

        await tx.document.createMany({
          data: bulkDocuments,
          skipDuplicates: true,
        });

        await Audit.create(
          {
            action: "option.created",
            companyId,
            actor: { type: "user", id: user.id },
            context: {
              userAgent,
              requestIp,
            },
            target: [{ type: "company", id: companyId }],
            summary: `${user.name} added stock option for stakeholder ${input.stakeholderId}`,
          },
          tx,
        );
      });

      return { success: true, message: "🎉 Successfully added an option" };
    } catch (error) {
      console.error("Error adding options:", error);
      return {
        success: false,
        message: "Please use unique Grant Id.",
      };
    }
  });
