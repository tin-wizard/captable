import { withAccessControl } from "@/trpc/api/trpc";

export const getStakeholdersProcedure = withAccessControl
  .meta({ policies: { stakeholder: { allow: ["read"] } } })
  .query(async ({ ctx }) => {
    const { db, companyId } = ctx.tenant;
    const data = await db.stakeholder.findMany({
      where: {
        companyId,
      },
      include: {
        company: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return data;
  });
