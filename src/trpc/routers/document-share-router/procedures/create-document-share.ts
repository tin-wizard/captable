import { Audit } from "@/server/audit";
import { withTenant, type withTenantTrpcContextType } from "@/trpc/api/trpc";
import {
  DocumentShareMutationSchema,
  type TypeDocumentShareMutation,
} from "../schema";

interface CreateDocumentShareHandlerOptions {
  input: TypeDocumentShareMutation;
  ctx: withTenantTrpcContextType;
}

export const createDocumentShareHandler = async ({
  ctx,
  input,
}: CreateDocumentShareHandlerOptions) => {
  const user = ctx.session.user;
  const { userAgent, requestIp } = ctx;
  const { companyId } = ctx.tenant;

  const { recipients, ...rest } = input;

  try {
    await ctx.tenant.db.$transaction(async (tx) => {
      const owned = await tx.document.count({
        where: { id: rest.documentId, companyId },
      });
      if (!owned) throw new Error("Invalid document");

      const documentShare = await tx.documentShare.create({
        data: {
          ...rest,
          recipients: recipients ? [recipients] : [],
        },
      });

      await Audit.create(
        {
          companyId,
          action: "documentShare.created",
          actor: { type: "user", id: user.id },
          context: {
            requestIp,
            userAgent,
          },
          target: [{ type: "documentShare", id: documentShare.id }],
          summary: `${user.name} created a document share: ${documentShare.link}`,
        },
        tx,
      );
    });

    return { success: true, message: "Document share created successfully." };
  } catch {
    return {
      success: false,
      message: "Oops, something went wrong. Please try again later.",
    };
  }
};

export const createDocumentShareProcedure = withTenant
  .input(DocumentShareMutationSchema)
  .mutation((opts) => createDocumentShareHandler(opts));
