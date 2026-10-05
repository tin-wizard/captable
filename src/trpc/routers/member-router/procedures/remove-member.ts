import { Audit } from "@/server/audit";
import { withTenant, type withTenantTrpcContextType } from "@/trpc/api/trpc";
import {
  type TypeZodRemoveMemberMutationSchema,
  ZodRemoveMemberMutationSchema,
} from "../schema";

type TenantDb = withTenantTrpcContextType["tenant"]["db"];
type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export const removeMemberProcedure = withTenant
  .input(ZodRemoveMemberMutationSchema)
  .mutation(async ({ ctx, input }) =>
    ctx.tenant.db.$transaction((tx) =>
      removeMemberHandler({ ctx, db: tx, input }),
    ),
  );

interface removeMemberHandlerOptions {
  input: TypeZodRemoveMemberMutationSchema;
  // tenant-scoped client (or transaction) the delete and audit run on
  db: TenantDb | TenantTx;
  ctx: Pick<
    withTenantTrpcContextType,
    "session" | "requestIp" | "userAgent" | "tenant"
  >;
}

export async function removeMemberHandler({
  ctx: { session, requestIp, userAgent, tenant },
  db,
  input,
}: removeMemberHandlerOptions) {
  const user = session.user;
  const { memberId } = input;
  const { companyId } = tenant;

  const member = await db.member.delete({
    where: {
      id: memberId,
      companyId,
    },
    select: {
      userId: true,
      user: {
        select: {
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
      action: "member.removed",
      companyId,
      actor: { type: "user", id: user.id },
      context: {
        requestIp,
        userAgent,
      },
      target: [{ type: "user", id: member.userId }],
      summary: `${user.name} removed ${member.user?.name} from ${member?.company?.name}`,
    },
    db,
  );

  return { success: true };
}
