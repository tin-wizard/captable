import { Audit } from "@/server/audit";
import { assertNotLastActiveAdmin } from "@/server/tenant-guard";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodToggleActivationMutationSchema } from "../schema";

export const toggleActivation = withAccessControl
  .input(ZodToggleActivationMutationSchema)
  .meta({ policies: { members: { allow: ["update"] } } })
  .mutation(
    async ({ ctx: { session, tenant, requestIp, userAgent }, input }) => {
      const { companyId } = tenant;
      const user = session.user;
      const { memberId, status } = input;

      await tenant.db.$transaction(async (tx) => {
        if (status !== "ACTIVE") {
          await assertNotLastActiveAdmin(tx, companyId, memberId);
        }

        const member = await tx.member.update({
          where: {
            id: memberId,
            companyId,
          },
          data: {
            status,
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
            action: status ? "member.activated" : "member.deactivated",
            companyId,
            actor: { type: "user", id: user.id },
            context: {
              requestIp,
              userAgent,
            },
            target: [{ type: "user", id: member.userId }],
            summary: `${user.name} ${status ? "activated" : "deactivated"} ${
              member.user?.name
            } from ${member?.company.name}`,
          },
          tx,
        );
      });

      return { success: true };
    },
  );
