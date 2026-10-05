import { Audit } from "@/server/audit";
import { revokeExistingInviteTokens } from "@/server/member";
import { runSerializable } from "@/server/tenant-guard";
import { withAccessControl } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { ZodRevokeInviteMutationSchema } from "../schema";
import { removeMemberHandler } from "./remove-member";

export const revokeInviteProcedure = withAccessControl
  .input(ZodRevokeInviteMutationSchema)
  .meta({ policies: { members: { allow: ["delete"] } } })
  .mutation(async ({ ctx, input }) => {
    const { tenant, session, requestIp, userAgent } = ctx;
    const user = session.user;
    const { memberId } = input;

    await runSerializable((options) =>
      tenant.db.$transaction(async (tx) => {
        // Look the member up through the caller's company first: another
        // company's invite must be indistinguishable from a missing one, and
        // nothing (tokens, names) may be touched or read before this passes.
        const member = await tx.member.findFirst({
          where: { id: memberId, companyId: tenant.companyId },
          select: {
            userId: true,
            user: { select: { name: true, email: true } },
            company: { select: { name: true } },
          },
        });

        if (!member) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "member not found",
          });
        }

        // the stored email, not the client-supplied one, names the tokens
        const email = member.user.email;
        if (email) {
          await revokeExistingInviteTokens({ memberId, email, tx });
        }

        await Audit.create(
          {
            action: "member.revoked-invite",
            companyId: tenant.companyId,
            actor: { type: "user", id: user.id },
            context: {
              requestIp,
              userAgent,
            },
            target: [{ type: "user", id: member.userId }],
            summary: `${user.name} revoked ${member.user?.name} to join ${member.company?.name}`,
          },
          tx,
        );

        await removeMemberHandler({ ctx, db: tx, input: { memberId } });
      }, options),
    );

    return { success: true };
  });
