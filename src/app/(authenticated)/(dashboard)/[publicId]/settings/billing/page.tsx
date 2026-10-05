import { PlanDetails } from "@/components/billing/plan-details";
import { PageLayout } from "@/components/dashboard/page-layout";
import { UnAuthorizedState } from "@/components/ui/un-authorized-state";
import { hasPermission } from "@/lib/rbac";
import { getServerPermissions } from "@/lib/rbac/access-control";
import { api } from "@/trpc/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Billing",
};
const BillingPage = async () => {
  // billing.getSubscription needs billing:read; render the forbidden state
  // instead of an error page
  const { permissions } = await getServerPermissions();
  if (!hasPermission(permissions, "billing", "read")) {
    return <UnAuthorizedState />;
  }

  const [{ products }, { subscription }] = await Promise.all([
    api.billing.getProducts.query(),
    api.billing.getSubscription.query(),
  ]);

  return (
    <PageLayout title="Billing" description="Manage payments and billing">
      <PlanDetails products={products} subscription={subscription} />
    </PageLayout>
  );
};

export default BillingPage;
