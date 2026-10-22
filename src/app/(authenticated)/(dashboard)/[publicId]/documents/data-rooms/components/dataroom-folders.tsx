import { PageLayout } from "@/components/dashboard/page-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DocumentsSummaryItem } from "@/server/analytics/document";
import type { DataRoom } from "@prisma/client";
import {
  RiFolder3Fill as FolderIcon,
  RiMore2Fill as MoreIcon,
  RiAddFill,
} from "@remixicon/react";
import Link from "next/link";
import DataRoomPopover from "./data-room-popover";
import { RoomStats } from "./room-stats";

interface DataRoomProps extends DataRoom {
  _count: {
    documents: number;
  };
}

type FolderProps = {
  companyPublicId: string;
  folders: DataRoomProps[];
  // keyed by data room id; empty when the caller cannot read activity
  stats?: Record<string, DocumentsSummaryItem>;
};

const Folders = ({ companyPublicId, folders, stats = {} }: FolderProps) => {
  return (
    <div className="flex flex-col gap-y-3">
      <PageLayout
        title="Data room"
        description="A secure spaces to share multiple documents with investors, stakeholders and external parties."
        action={
          <DataRoomPopover
            trigger={
              <Button>
                <RiAddFill className="mr-2 h-5 w-5" />
                Data room
              </Button>
            }
          />
        }
      />

      <hr className="my-3" />

      <Card className="mt-3 border-none bg-transparent shadow-none">
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {folders.map((folder) => (
            <li
              key={folder.id}
              className="overflow-hidden rounded-md shadow-sm"
            >
              <Link
                href={`/${companyPublicId}/documents/data-rooms/${folder.publicId}`}
                className="group col-span-1 flex cursor-pointer rounded-md shadow-sm"
              >
                <div
                  className={cn(
                    "flex w-14 flex-shrink-0 items-center justify-center rounded-l-md border text-sm font-medium ",
                  )}
                >
                  <FolderIcon
                    className="h-6 w-6 text-primary/70"
                    aria-hidden="true"
                  />
                </div>
                <div className="flex flex-1 items-center justify-between truncate rounded-r-md border-y border-r border-border bg-card transition-colors group-hover:bg-muted">
                  <div className="flex-1 truncate px-4 py-2 text-sm">
                    <span className="font-medium text-foreground hover:text-muted-foreground">
                      {folder.name}
                    </span>
                    <p className="text-muted-foreground">
                      {folder._count.documents === 1
                        ? `${folder._count.documents} file`
                        : `${folder._count.documents} files`}
                    </p>
                  </div>
                  <div className="flex-shrink-0 pr-2">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-card text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-transparent focus:ring-offset-2"
                    >
                      <span className="sr-only">Open options</span>
                      <MoreIcon className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </Link>
              {stats[folder.id] && (
                <div className="rounded-b-md border-x border-b border-border bg-card">
                  <RoomStats stats={stats[folder.id] as DocumentsSummaryItem} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

export default Folders;
