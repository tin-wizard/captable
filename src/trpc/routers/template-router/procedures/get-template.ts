import { getPresignedGetUrl } from "@/server/file-uploads";
import { withTenant } from "@/trpc/api/trpc";
import { ZodGetTemplateQuerySchema } from "../schema";

export const getTemplateProcedure = withTenant
  .input(ZodGetTemplateQuerySchema)
  .query(async ({ ctx, input }) => {
    const { companyId } = ctx.tenant;
    const { template } = await ctx.tenant.db.$transaction(async (tx) => {
      const template = await tx.template.findFirstOrThrow({
        where: {
          publicId: input.publicId,
          companyId: companyId,
          // the relation is not tenant-scoped: never sign a bucket the company doesn't own
          bucket: { companyId },
          ...(input.isDraftOnly && { status: "DRAFT" }),
        },
        select: {
          name: true,
          status: true,
          bucket: {
            select: {
              key: true,
            },
          },
          fields: {
            select: {
              id: true,
              name: true,
              width: true,
              height: true,
              top: true,
              left: true,
              required: true,
              defaultValue: true,
              readOnly: true,
              type: true,
              viewportHeight: true,
              viewportWidth: true,
              page: true,
              recipientId: true,
              prefilledValue: true,
              meta: true,
            },
            orderBy: {
              top: "asc",
            },
          },
          eSignRecipient: {
            select: {
              email: true,
              id: true,
              name: true,
            },
          },
        },
      });

      return { template };
    });

    const { key, url } = await getPresignedGetUrl(template.bucket.key);

    return {
      fields: template.fields,
      key,
      url,
      name: template.name,
      status: template.status,
      recipients: template.eSignRecipient,
    };
  });
