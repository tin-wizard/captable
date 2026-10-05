import { withTenant } from "@/trpc/api/trpc";

export const getAllTemplateProcedure = withTenant.query(async ({ ctx }) => {
  const { companyId } = ctx.tenant;
  const { documents } = await ctx.tenant.db.$transaction(async (tx) => {
    const documents = await tx.template.findMany({
      where: {
        companyId,
      },
      select: {
        id: true,
        publicId: true,
        status: true,
        completedOn: true,
        name: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return { documents };
  });

  return { documents };
});
