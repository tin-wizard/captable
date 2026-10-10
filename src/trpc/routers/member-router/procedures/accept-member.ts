import { Audit } from "@/server/audit";
import { companyHomeUrl } from "@/server/domains/links";
import { checkVerificationToken } from "@/server/member";
import { withAuth } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { ZodAcceptMemberMutationSchema } from "../schema";

export const acceptMemberProcedure = withAuth
  .input(ZodAcceptMemberMutationSchema)
  .mutation(async ({ ctx, input }) => {
    const user = ctx.session.user;
    const { userAgent, requestIp } = ctx;

    // the token must be valid, unexpired, issued to this user's email, and
    // for exactly the member being accepted
    const invite = await checkVerificationToken(input.token, user.email);
    if (invite.memberId !== input.memberId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "invalid invite" });
    }

    const { publicId, companyId } = await ctx.db.$transaction(async (trx) => {
      await trx.verificationToken.delete({
        where: {
          token: input.token,
        },
      });

      await trx.user.update({
        where: {
          id: user.id,
        },
        data: {
          name: input.name,
        },
      });

      const member = await trx.member.update({
        where: {
          id: input.memberId,
        },
        data: {
          status: "ACTIVE",
          lastAccessed: new Date(),
          isOnboarded: true,
          userId: user.id,
          workEmail: input.workEmail,
        },
        select: {
          company: {
            select: {
              publicId: true,
              name: true,
              id: true,
            },
          },
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
          action: "member.accepted",
          companyId: member.company.id,
          actor: { type: "user", id: user.id },
          context: {
            requestIp,
            userAgent,
          },
          target: [{ type: "user", id: member.userId }],
          summary: `${member?.user?.name} joined ${member.company.name}`,
        },
        trx,
      );

      return {
        publicId: member.company.publicId,
        companyId: member.company.id,
      };
    });

    return {
      success: true,
      publicId,
      url: await companyHomeUrl(ctx.db, companyId, publicId),
    };
  });
