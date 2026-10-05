import { getRoleById } from "@/lib/rbac/access-control";
import { Audit } from "@/server/audit";
import {
  assertMayGrantRole,
  assertNotLastActiveAdmin,
} from "@/server/tenant-guard";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodUpdateMemberMutationSchema } from "../schema";

export const updateMemberProcedure = withAccessControl
  .input(ZodUpdateMemberMutationSchema)
  .meta({
    policies: {
      members: { allow: ["update"] },
    },
  })
  .mutation(
    async ({ ctx: { session, tenant, requestIp, userAgent }, input }) => {
      const { memberId, name, roleId, ...rest } = input;
      const { companyId } = tenant;
      const user = session.user;

      await tenant.db.$transaction(async (tx) => {
        // no roleId: leave the role alone (it used to clear it)
        const role =
          roleId === undefined
            ? undefined
            : await getRoleById({ tx, id: roleId, companyId });

        assertMayGrantRole(tenant.role, role?.role);
        if (role && role.role !== "ADMIN") {
          await assertNotLastActiveAdmin(tx, companyId, memberId);
        }

        const member = await tx.member.update({
          where: {
            status: "ACTIVE",
            id: memberId,
            companyId,
          },
          data: {
            ...rest,
            ...(role && {
              role: role.role,
              customRole: {
                ...(role.customRoleId
                  ? {
                      connect: {
                        id: role.customRoleId,
                      },
                    }
                  : { disconnect: true }),
              },
            }),
            user: {
              update: {
                name,
              },
            },
          },
          select: {
            userId: true,
            user: {
              select: {
                name: true,
              },
            },
          },
        });

        await Audit.create(
          {
            action: "member.updated",
            companyId: user.companyId,
            actor: { type: "user", id: user.id },
            context: {
              requestIp,
              userAgent,
            },
            target: [{ type: "user", id: member.userId }],
            summary: `${user.name} updated ${member.user?.name} details`,
          },
          tx,
        );
      });

      return { success: true };
    },
  );
