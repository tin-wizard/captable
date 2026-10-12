import { ActivityTable } from "@/components/activity/activity-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { serverAccessControl } from "@/lib/rbac/access-control";
import { api } from "@/trpc/server";
import type { Bucket, DataRoom } from "@prisma/client";
import { notFound } from "next/navigation";
import DataRoomFiles from "../components/data-room-files";

const DataRoomSettinsPage = async (props: {
  params: Promise<{ publicId: string; dataRoomPublicId: string }>;
}) => {
  const params = await props.params;

  const { publicId, dataRoomPublicId } = params;

  const { dataRoom, documents } = await api.dataRoom.getDataRoom.query({
    dataRoomPublicId,
    include: {
      company: false,
      recipients: true,
      documents: true,
    },
  });
  const contacts = await api.common.getContacts.query();
  const { allow } = await serverAccessControl();
  const canViewActivity = allow(true, ["audits", "read"]);

  if (!dataRoom) {
    return notFound();
  }

  return (
    <>
      <DataRoomFiles
        contacts={contacts}
        dataRoom={dataRoom as DataRoom}
        documents={documents as Bucket[]}
        companyPublicId={publicId}
      />
      {canViewActivity && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTable kind="DATA_ROOM" targetPublicId={dataRoomPublicId} />
          </CardContent>
        </Card>
      )}
    </>
  );
};

export default DataRoomSettinsPage;
