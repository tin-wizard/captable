import { getRoleById } from "@/lib/rbac/access-control";
import { Audit } from "@/server/audit";
import {
  assertAdmin,
  assertMayManageMember,
  assertNotLastActiveAdmin,
  runSerializable,
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

      await runSerializable((options) =>
        tenant.db.$transaction(async (tx) => {
          const current = await assertMayManageMember(
            tx,
            companyId,
            tenant.role,
            memberId,
          );
          // no roleId: leave the role alone (it used to clear it)
          const role =
            roleId === undefined
              ? undefined
              : await getRoleById({ tx, id: roleId, companyId });

          // the UI always resends roleId: only a different role is a change
          const roleChanged =
            role &&
            (role.role !== current?.role ||
              role.customRoleId !== current?.customRoleId);
          if (roleChanged) {
            assertAdmin(
              tenant.role,
              "Only an admin can change a member's role.",
            );
            if (role.role !== "ADMIN") {
              await assertNotLastActiveAdmin(tx, companyId, memberId);
            }
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
        }, options),
      );

      return { success: true };
    },
  );
