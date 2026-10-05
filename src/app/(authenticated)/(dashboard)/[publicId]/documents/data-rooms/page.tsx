"use server";

import EmptyState from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { getServerTenant } from "@/server/tenant";
import { RiAddFill, RiFolderCheckFill } from "@remixicon/react";
import { Fragment } from "react";
import DataRoomPopover from "./components/data-room-popover";
import Folders from "./components/dataroom-folders";

const DataRoomPage = async ({
  params: { publicId: companyPublicId },
}: {
  params: { publicId: string };
}) => {
  const { db } = await getServerTenant();
  const dataRooms = await db.dataRoom.findMany({
    include: {
      _count: {
        select: { documents: true },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <Fragment>
      {dataRooms.length > 0 ? (
        <Folders companyPublicId={companyPublicId} folders={dataRooms} />
      ) : (
        <Fragment>
          <EmptyState
            icon={<RiFolderCheckFill />}
            title="You don't have any data rooms yet."
            subtitle="A secure spaces to share multiple documents with investors, stakeholders and external parties."
          >
            <DataRoomPopover
              trigger={
                <Button>
                  <RiAddFill className="mr-2 h-5 w-5" />
                  Create a data room
                </Button>
              }
            />
          </EmptyState>
        </Fragment>
      )}
    </Fragment>
  );
};

export default DataRoomPage;
