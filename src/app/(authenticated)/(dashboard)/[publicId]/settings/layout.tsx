import { PageLayout } from "@/components/dashboard/page-layout";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { Card } from "@/components/ui/card";
import { IS_BILLING_ENABLED } from "@/constants/stripe";
import { domainConfig } from "@/server/domains/config";
import { getRequestHost } from "@/server/domains/request-host";

const SettingsLayout = async ({ children }: { children: React.ReactNode }) => {
  const host = await getRequestHost();
  const canonicalOrigin =
    host.kind === "tenant" ? domainConfig().canonicalOrigin : null;
  return (
    <PageLayout title="Settings">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-3">
          <SettingsSidebar
            isBillingEnabled={IS_BILLING_ENABLED}
            canonicalOrigin={canonicalOrigin}
          />
        </div>
        <div className="col-span-12 md:col-span-9">
          <Card className="p-5">{children}</Card>
        </div>
      </div>
    </PageLayout>
  );
};

export default SettingsLayout;
