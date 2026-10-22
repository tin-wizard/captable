import FileIcon from "@/components/common/file-icon";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Bucket } from "@prisma/client";
import Link from "next/link";

type DocumentExplorerProps = {
  shared?: boolean;
  jwtToken?: string;
  companyPublicId: string;
  dataRoomPublicId: string;
  documents: Bucket[];
};

const DataRoomFileExplorer = ({
  jwtToken,
  shared,
  documents,
  companyPublicId,
  dataRoomPublicId,
}: DocumentExplorerProps) => {
  return (
    <Card className="border-none bg-transparent shadow-none">
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {documents.map((document) => (
          <li key={document.id}>
            <Link
              href={
                shared
                  ? `/data-rooms/${dataRoomPublicId}/${document.id}?token=${jwtToken}`
                  : `/${companyPublicId}/documents/${document.id}`
              }
              className="group col-span-1 flex cursor-pointer rounded-md"
            >
              <div
                className={cn(
                  "flex w-14 flex-shrink-0 items-center justify-center rounded-l-md border text-sm font-medium ",
                )}
              >
                <FileIcon type={document.mimeType} />
              </div>
              <div className="flex flex-1 items-center justify-between truncate rounded-r-md border-y border-r border-border bg-card transition-colors group-hover:bg-muted">
                <div className="text-md flex-1 truncate px-4 py-2">
                  <span className="font-medium text-foreground hover:text-muted-foreground">
                    {document.name}
                  </span>
                  <p className="text-xs text-muted-foreground">{`${
                    document.mimeType
                  } - ${(document.size / 1024 / 1024).toFixed(2)} MB`}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export default DataRoomFileExplorer;
