import { ActivityTable } from "@/components/activity/activity-table";
import { UnopenedList } from "@/components/activity/unopened-list";
import { analyticsParams } from "@/components/analytics";
import { DocumentAnalytics } from "@/components/analytics/document/document-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Editor from "@/components/update/editor-client";
import { serverAccessControl } from "@/lib/rbac/access-control";
import { getServerTenant } from "@/server/tenant";
import { api } from "@/trpc/server";

const getUpdate = async (publicId: string) => {
  const { db } = await getServerTenant();
  return await db.update.findFirstOrThrow({ where: { publicId } });
};

const UpdatePage = async (props: {
  params: Promise<{ publicId: string; updatePublicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await props.params;
  const filters = analyticsParams(await props.searchParams);

  const { publicId, updatePublicId } = params;

  if (updatePublicId === "new") {
    return <Editor companyPublicId={publicId} mode="new" />;
  }
  const update = await getUpdate(updatePublicId);
  const { allow } = await serverAccessControl();
  const analytics = allow(true, ["audits", "read"])
    ? await api.analytics.document.query({
        kind: "UPDATE",
        targetPublicId: updatePublicId,
        ...filters,
      })
    : null;

  return (
    <>
      <Editor companyPublicId={publicId} update={update} mode="edit" />
      {analytics && (
        <section aria-label="Analytics" className="mt-6">
          <h3 className="mb-4 text-lg font-semibold">Analytics</h3>
          <DocumentAnalytics
            data={analytics}
            kind="UPDATE"
            targetPublicId={updatePublicId}
            filters={filters}
            roomName={update.title}
          />
        </section>
      )}
      {allow(true, ["audits", "read"]) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Visit log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-y-6">
              <UnopenedList
                kind="UPDATE"
                targetPublicId={updatePublicId}
                canNudge={allow(true, ["updates", "update"])}
              />
              <ActivityTable kind="UPDATE" targetPublicId={updatePublicId} />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
};

export default UpdatePage;
