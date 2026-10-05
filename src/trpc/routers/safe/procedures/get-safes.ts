import { withTenant } from "@/trpc/api/trpc";

export const getSafesProcedure = withTenant.query(
  async ({ ctx: { tenant } }) => {
    const data = await tenant.db.$transaction(async (tx) => {
      const { companyId } = tenant;
      const data = await tx.safe.findMany({
        where: {
          companyId,
        },
        select: {
          id: true,
          publicId: true,
          type: true,
          status: true,
          capital: true,
          safeTemplate: true,
          valuationCap: true,
          discountRate: true,
          mfn: true,
          proRata: true,
          additionalTerms: true,
          issueDate: true,
          boardApprovalDate: true,
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

      return data;
    });

    return { data };
  },
);
