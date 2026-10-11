import { PayloadType } from "@/lib/constants";
import { Audit } from "@/server/audit";
import { withAuth } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { ZodUpdateProfileMutationSchema } from "../schema";

export const updateProfileProcedure = withAuth
  .input(ZodUpdateProfileMutationSchema)
  .mutation(async ({ ctx: { session, db, requestIp, userAgent }, input }) => {
    const user = session.user;

    if (input.type === PayloadType.PROFILE_DATA) {
      const { fullName, loginEmail, workEmail, jobTitle } = input.payload;

      // the login email is a global identity; changing it needs a verified flow we don't have
      if (loginEmail.toLowerCase() !== user.email?.toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Changing the login email is not supported.",
        });
      }

      await db.$transaction(async (tx) => {
        const member = await tx.member.update({
          where: {
            status: "ACTIVE",
            id: user.memberId,
            companyId: user.companyId,
          },
          data: {
            title: jobTitle,
            workEmail,
            user: {
              update: {
                name: fullName,
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
            summary: `${user.name} updated the profile information.`,
          },
          tx,
        );
      });

      return { success: true };
    }

    if (input.type === PayloadType.PROFILE_AVATAR) {
      const { avatarUrl } = input.payload;

      await db.$transaction(async (tx) => {
        const member = await tx.member.update({
          where: {
            status: "ACTIVE",
            id: user.memberId,
            companyId: user.companyId,
          },
          data: {
            user: {
              update: {
                image: avatarUrl,
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
            summary: `${user.name} uploaded new profile image.`,
          },
          tx,
        );
      });

      return { success: true };
    }
  });
