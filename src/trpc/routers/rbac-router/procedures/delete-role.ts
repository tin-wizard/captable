import { getRoleById } from "@/lib/rbac/access-control";
import { Audit } from "@/server/audit";
import { assertAdmin } from "@/server/tenant-guard";
import { withAccessControl } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { ZodDeleteRoleMutationSchema } from "../schema";

export const deleteRoleProcedure = withAccessControl
  .meta({
    policies: {
      roles: { allow: ["delete"] },
    },
  })
  .input(ZodDeleteRoleMutationSchema)
  .mutation(async ({ ctx, input }) => {
    const {
      tenant: { companyId },
      userAgent,
      requestIp,
      session,
    } = ctx;
    assertAdmin(ctx.tenant.role);
    await ctx.tenant.db.$transaction(async (tx) => {
      const role = await getRoleById({ id: input.roleId, companyId, tx });
      const { user } = session;
      if (!role.customRoleId) {
        throw new Error("default roles cannot be deleted");
      }

      // members holding it would be left CUSTOM with no role: every request
      // of theirs would then fail
      const holders = await tx.member.count({
        where: { companyId, customRoleId: role.customRoleId },
      });
      if (holders) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This role is assigned to ${holders} member(s); give them another role first.`,
        });
      }

      const existingRole = await tx.customRole.delete({
        where: { id: role.customRoleId, companyId },
      });

      await Audit.create(
        {
          action: "role.deleted",
          companyId: user.companyId,
          actor: { type: "user", id: user.id },
          context: {
            userAgent,
            requestIp,
          },
          target: [{ type: "role", id: existingRole.id }],
          summary: `${user.name} deleted the role ${existingRole.name}`,
        },
        tx,
      );
    });
    return {};
  });
