import { withAuth } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { ZodSwitchCompanyMutationSchema } from "../schema";

// Stays on withAuth + ctx.db: it reads the caller's own membership in
// *another* company, which a tenant-scoped client would hide.
export const switchCompanyProcedure = withAuth
  .input(ZodSwitchCompanyMutationSchema)
  .mutation(async ({ ctx, input }) => {
    const { db } = ctx;

    await db.$transaction(async (tx) => {
      const member = await tx.member.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
          status: "ACTIVE",
          isOnboarded: true,
        },
      });

      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await tx.member.update({
        where: {
          id: member.id,
        },
        data: {
          lastAccessed: new Date(),
        },
      });
    });

    return { success: true };
  });
