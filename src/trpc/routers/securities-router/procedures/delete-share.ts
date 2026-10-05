import { Audit } from "@/server/audit";
import {
  withAccessControl,
  type withTenantTrpcContextType,
} from "@/trpc/api/trpc";
import {
  type TypeZodDeleteShareMutationSchema,
  ZodDeleteShareMutationSchema,
} from "../schema";

export const deleteShareProcedure = withAccessControl
  .input(ZodDeleteShareMutationSchema)
  .meta({ policies: { securities: { allow: ["delete"] } } })
  .mutation(async (args) => {
    return await deleteShareHandler(args);
  });

interface deleteShareHandlerOptions {
  input: TypeZodDeleteShareMutationSchema;
  ctx: withTenantTrpcContextType;
}

export async function deleteShareHandler({
  ctx: { tenant, session, requestIp, userAgent },
  input,
}: deleteShareHandlerOptions) {
  const user = session.user;
  const { shareId } = input;
  try {
    await tenant.db.$transaction(async (tx) => {
      const { companyId } = tenant;

      const share = await tx.share.delete({
        where: {
          id: shareId,
          companyId,
        },
        select: {
          id: true,
          stakeholder: {
            select: {
              id: true,
              name: true,
            },
          },
          company: {
            select: {
              name: true,
            },
          },
        },
      });

      await Audit.create(
        {
          action: "share.deleted",
          companyId: user.companyId,
          actor: { type: "user", id: session.user.id },
          context: {
            requestIp,
            userAgent,
          },
          target: [{ type: "share", id: share.id }],
          summary: `${user.name} deleted share of stakholder ${share.stakeholder.name}`,
        },
        tx,
      );
    });

    return { success: true };
  } catch (err) {
    console.error(err);
    return {
      success: false,
      message: "Oops, something went wrong while deleting option.",
    };
  }
}
