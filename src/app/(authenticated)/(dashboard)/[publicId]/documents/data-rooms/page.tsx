import { FilterChips, SearchBox } from "@/components/analytics";
import EmptyState from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { serverAccessControl } from "@/lib/rbac/access-control";
import { getServerTenant } from "@/server/tenant";
import { api } from "@/trpc/server";
import { RiAddFill, RiFolderCheckFill } from "@remixicon/react";
import { Fragment } from "react";
import DataRoomPopover from "./components/data-room-popover";
import Folders from "./components/dataroom-folders";

const DataRoomPage = async (props: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await props.params;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const q = one(sp.q)?.trim().toLowerCase();
  const sort = one(sp.sort);

  const { publicId: companyPublicId } = params;

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

  const { allow } = await serverAccessControl();
  const summary = allow(true, ["audits", "read"])
    ? await api.analytics.documentsSummary.query({ kind: "DATA_ROOM" })
    : null;
  const stats = Object.fromEntries(
    (summary?.items ?? []).map((i) => [i.targetId, i]),
  );
  const shown = dataRooms
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) =>
      sort === "viewers"
        ? (stats[b.id]?.viewers ?? 0) - (stats[a.id]?.viewers ?? 0)
        : sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "unopened"
            ? (stats[b.id]?.unopened ?? 0) - (stats[a.id]?.unopened ?? 0)
            : 0,
    );

  return (
    <Fragment>
      {dataRooms.length > 0 ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <SearchBox placeholder="Search data rooms" />
            <FilterChips
              groups={[
                {
                  key: "sort",
                  label: "Sort by",
                  options: [
                    { value: "viewers", label: "Most viewers" },
                    { value: "unopened", label: "Not opened" },
                    { value: "name", label: "Name" },
                  ],
                },
              ]}
            />
          </div>
          <Folders
            companyPublicId={companyPublicId}
            folders={shown}
            stats={stats}
          />
        </>
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
