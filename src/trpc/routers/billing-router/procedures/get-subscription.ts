import { withTenant } from "@/trpc/api/trpc";

export const getSubscriptionProcedure = withTenant.query(async ({ ctx }) => {
  const { tenant } = ctx;

  const { subscription } = await tenant.db.$transaction(async (tx) => {
    const { companyId } = tenant;

    const customer = await tx.billingCustomer.findFirst({
      where: {
        companyId,
      },
      select: {
        id: true,
      },
    });

    if (!customer) {
      return { subscription: null };
    }

    const subscription = await tx.billingSubscription.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: ["active", "trialing"],
        },
      },
      include: {
        price: {
          select: {
            product: {
              select: {
                name: true,
              },
            },
            unitAmount: true,
          },
        },
      },
    });

    return { subscription };
  });

  return { subscription };
});
