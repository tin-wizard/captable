import { env } from "@/env";
import { invariant } from "@/lib/error";
import { createOrRetrieveCustomer, stripe } from "@/server/stripe";
import { withAccessControl } from "@/trpc/api/trpc";
import type Stripe from "stripe";
import { ZodCheckoutMutationSchema } from "../schema";

export const checkoutProcedure = withAccessControl
  .input(ZodCheckoutMutationSchema)
  .meta({ policies: { billing: { allow: ["create"] } } })
  .mutation(async ({ ctx, input }) => {
    const { priceId, priceType } = input;
    const { tenant, session } = ctx;

    const { stripeSessionId } = await tenant.db.$transaction(async (tx) => {
      const { companyId } = tenant;

      let customer: string;
      try {
        customer = await createOrRetrieveCustomer({
          tx,
          companyId,
          email: "",
        });
      } catch (err) {
        console.error(err);
        throw new Error("Unable to access customer record.");
      }

      const params: Stripe.Checkout.SessionCreateParams = {
        allow_promotion_codes: true,
        billing_address_collection: "required",
        customer,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: priceType === "recurring" ? "subscription" : "payment",
        success_url: `${env.NEXT_PUBLIC_BASE_URL}/${session.user.companyPublicId}/settings/billing`,
      };

      let stripeSession: Stripe.Checkout.Session | undefined;
      try {
        stripeSession = await stripe.checkout.sessions.create(params);
      } catch (err) {
        console.error(err);
        throw new Error("Unable to create checkout session.");
      }

      invariant(stripeSession, "session not found");

      return { stripeSessionId: stripeSession.id };
    });

    return { stripeSessionId };
  });
