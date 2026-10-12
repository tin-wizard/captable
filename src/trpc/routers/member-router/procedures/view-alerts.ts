import { withTenant } from "@/trpc/api/trpc";
import { z } from "zod";

// The caller's own preference. withTenant (not withAuth) so it is callable on
// company hosts; the tenant client forces companyId on Member.
export const getViewAlertsProcedure = withTenant.query(
  async ({ ctx: { tenant } }) => {
    const member = await tenant.db.member.findUniqueOrThrow({
      where: { id: tenant.memberId },
      select: { notifyOnView: true },
    });
    return member.notifyOnView;
  },
);

export const setViewAlertsProcedure = withTenant
  .input(z.object({ enabled: z.boolean() }))
  .mutation(async ({ ctx: { tenant }, input }) => {
    await tenant.db.member.update({
      where: { id: tenant.memberId },
      data: { notifyOnView: input.enabled },
    });
    return input.enabled;
  });
