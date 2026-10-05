import { withTenant } from "@/trpc/api/trpc";

export const getOptionsProcedure = withTenant.query(
  async ({ ctx: { tenant } }) => {
    const data = await tenant.db.$transaction(async (tx) => {
      const { companyId } = tenant;

      const option = await tx.option.findMany({
        where: {
          companyId,
        },
        select: {
          id: true,
          grantId: true,
          quantity: true,
          exercisePrice: true,
          type: true,
          status: true,
          cliffYears: true,
          vestingYears: true,
          issueDate: true,
          expirationDate: true,
          vestingStartDate: true,
          boardApprovalDate: true,
          rule144Date: true,
          stakeholder: {
            select: {
              name: true,
            },
          },
          documents: {
            select: {
              id: true,
              name: true,
              uploader: {
                select: {
                  user: {
                    select: {
                      name: true,
                      image: true,
                    },
                  },
                },
              },
              bucket: {
                select: {
                  key: true,
                  mimeType: true,
                  size: true,
                },
              },
            },
          },
        },
      });

      return option;
    });

    return { data };
  },
);
