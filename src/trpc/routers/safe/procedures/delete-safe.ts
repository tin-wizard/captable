import { Audit } from "@/server/audit";
import { withTenant, type withTenantTrpcContextType } from "@/trpc/api/trpc";
import {
  type TypeZodDeleteSafesMutationSchema,
  ZodDeleteSafesMutationSchema,
} from "../schema";

export const deleteSafeProcedure = withTenant
  .input(ZodDeleteSafesMutationSchema)
  .mutation(async (args) => {
    return await deleteSafeHandler(args);
  });

interface deleteSafeHandlerOptions {
  input: TypeZodDeleteSafesMutationSchema;
  ctx: withTenantTrpcContextType;
}

export async function deleteSafeHandler({
  ctx: { tenant, session, requestIp, userAgent },
  input,
}: deleteSafeHandlerOptions) {
  const user = session.user;
  const { safeId } = input;
  try {
    await tenant.db.$transaction(async (tx) => {
      const { companyId } = tenant;

      const safe = await tx.safe.delete({
        where: {
          id: safeId,
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
          action: "safe.deleted",
          companyId,
          actor: { type: "user", id: session.user.id },
          context: {
            requestIp,
            userAgent,
          },
          target: [{ type: "company", id: companyId }],
          summary: `${user.name} deleted safe agreement of stakholder ${safe.stakeholder.name}`,
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
