import { ActivityTable } from "@/components/activity/activity-table";
import { UnopenedList } from "@/components/activity/unopened-list";
import { analyticsParams } from "@/components/analytics";
import { DocumentAnalytics } from "@/components/analytics/document/document-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { serverAccessControl } from "@/lib/rbac/access-control";
import { api } from "@/trpc/server";
import type { Bucket, DataRoom } from "@prisma/client";
import { notFound } from "next/navigation";
import DataRoomFiles from "../components/data-room-files";

const DataRoomSettinsPage = async (props: {
  params: Promise<{ publicId: string; dataRoomPublicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await props.params;
  const filters = analyticsParams(await props.searchParams);

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

  const analytics = canViewActivity
    ? await api.analytics.document.query({
        kind: "DATA_ROOM",
        targetPublicId: dataRoomPublicId,
        ...filters,
      })
    : null;

  return (
    <>
      <DataRoomFiles
        contacts={contacts}
        dataRoom={dataRoom as DataRoom}
        documents={documents as Bucket[]}
        companyPublicId={publicId}
      />
      {canViewActivity && (
        <section aria-label="Analytics" className="mt-6 space-y-6">
          <h3 className="text-lg font-semibold">Analytics</h3>
          {analytics && (
            <DocumentAnalytics
              data={analytics}
              kind="DATA_ROOM"
              targetPublicId={dataRoomPublicId}
              filters={filters}
              roomName={(dataRoom as DataRoom).name}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Visit log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-y-6">
                <UnopenedList
                  kind="DATA_ROOM"
                  targetPublicId={dataRoomPublicId}
                  canNudge={allow(true, ["data-rooms", "update"])}
                />
                <ActivityTable
                  kind="DATA_ROOM"
                  targetPublicId={dataRoomPublicId}
                />
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </>
  );
};

export default DataRoomSettinsPage;
