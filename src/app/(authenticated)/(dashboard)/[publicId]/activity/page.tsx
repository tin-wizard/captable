import { ActivityTable } from "@/components/activity/activity-table";
import { Card } from "@/components/ui/card";
import { UnAuthorizedState } from "@/components/ui/un-authorized-state";
import { serverAccessControl } from "@/lib/rbac/access-control";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Activity",
};

const ActivityPage = async () => {
  const { allow } = await serverAccessControl();

  if (!allow(true, ["audits", "read"])) {
    return <UnAuthorizedState />;
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div className="gap-y-3">
        <h3 className="font-medium">Activity</h3>
        <p className="text-sm text-muted-foreground">
          Who has looked at what you shared
        </p>
      </div>
      <Card className="mt-3 p-4">
        <ActivityTable />
      </Card>
    </div>
  );
};

export default ActivityPage;
