import { ActivityTable } from "@/components/activity/activity-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Editor from "@/components/update/editor-client";
import { serverAccessControl } from "@/lib/rbac/access-control";
import { getServerTenant } from "@/server/tenant";

const getUpdate = async (publicId: string) => {
  const { db } = await getServerTenant();
  return await db.update.findFirstOrThrow({ where: { publicId } });
};

const UpdatePage = async (props: {
  params: Promise<{ publicId: string; updatePublicId: string }>;
}) => {
  const params = await props.params;

  const { publicId, updatePublicId } = params;

  if (updatePublicId === "new") {
    return <Editor companyPublicId={publicId} mode="new" />;
  }
  const update = await getUpdate(updatePublicId);
  const { allow } = await serverAccessControl();

  return (
    <>
      <Editor companyPublicId={publicId} update={update} mode="edit" />
      {allow(true, ["audits", "read"]) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTable kind="UPDATE" targetPublicId={updatePublicId} />
          </CardContent>
        </Card>
      )}
    </>
  );
};

export default UpdatePage;
