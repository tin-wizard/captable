import { withAccessControl } from "@/trpc/api/trpc";
import { ZodCancelTemplateMutationSchema } from "../schema";

export const cancelTemplateProcedure = withAccessControl
  .input(ZodCancelTemplateMutationSchema)
  .meta({ policies: { templates: { allow: ["update"] } } })
  .mutation(async ({ input, ctx }) => {
    const { templateId, publicId } = input;
    const { companyId } = ctx.tenant;
    const res = await ctx.tenant.db.$transaction(async (tx) => {
      const template = await tx.template.findFirst({
        where: {
          id: templateId,
          companyId,
          publicId,
        },
      });

      if (!template) {
        return { message: "Invalid Template ID", success: false };
      }

      await tx.template.update({
        where: {
          id: template.id,
        },
        data: {
          status: "CANCELLED",
        },
      });

      return {
        message: "Successfully set the document status to CANCELLED",
        success: true,
      };
    });

    return res;
  });
