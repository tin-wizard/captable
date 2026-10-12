import { withAuth } from "@/trpc/api/trpc";
import { z } from "zod";

// The caller's own preference, scoped by their member id and company, in the
// same shape as get-profile.
export const getViewAlertsProcedure = withAuth.query(
  async ({
    ctx: {
      db,
      session: { user },
    },
  }) => {
    const member = await db.member.findUniqueOrThrow({
      where: { id: user.memberId, companyId: user.companyId },
      select: { notifyOnView: true },
    });
    return member.notifyOnView;
  },
);

export const setViewAlertsProcedure = withAuth
  .input(z.object({ enabled: z.boolean() }))
  .mutation(
    async ({
      ctx: {
        db,
        session: { user },
      },
      input,
    }) => {
      await db.member.update({
        where: { id: user.memberId, companyId: user.companyId },
        data: { notifyOnView: input.enabled },
      });
      return input.enabled;
    },
  );
