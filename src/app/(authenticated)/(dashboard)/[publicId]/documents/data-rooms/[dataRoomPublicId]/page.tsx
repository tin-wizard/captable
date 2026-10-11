import { api } from "@/trpc/server";
import type { Bucket, DataRoom } from "@prisma/client";
import { notFound } from "next/navigation";
import DataRoomFiles from "../components/data-room-files";

const DataRoomSettinsPage = async (props: {
  params: Promise<{ publicId: string; dataRoomPublicId: string }>;
}) => {
  const params = await props.params;

  const { publicId, dataRoomPublicId } = params;

  const { dataRoom, documents, viewedBy } = await api.dataRoom.getDataRoom.query({
    dataRoomPublicId,
    include: {
      company: false,
      recipients: true,
      documents: true,
      views: true,
    },
  });
  const contacts = await api.common.getContacts.query();

  if (!dataRoom) {
    return notFound();
  }

  return (
    <DataRoomFiles
      contacts={contacts}
      dataRoom={dataRoom as DataRoom}
      documents={documents as Bucket[]}
      companyPublicId={publicId}
      viewedBy={viewedBy}
    />
  );
};

export default DataRoomSettinsPage;
