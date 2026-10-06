import FileIcon from "@/components/common/file-icon";
import FilePreview from "@/components/file/preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UnAuthorizedState } from "@/components/ui/un-authorized-state";
import { hasPermission } from "@/lib/rbac";
import { getServerPermissions } from "@/lib/rbac/access-control";
import { getPresignedGetUrl } from "@/server/file-uploads";
import { getServerTenant } from "@/server/tenant";
import { RiArrowLeftSLine } from "@remixicon/react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";

const DocumentPreview = async (props: {
  params: Promise<{ publicId: string; bucketId: string }>;
}) => {
  const params = await props.params;

  const { publicId, bucketId } = params;

  // same grant as bucket.getUrl: no documents:read, no presigned URL
  const { permissions } = await getServerPermissions();
  if (!hasPermission(permissions, "documents", "read")) {
    return <UnAuthorizedState />;
  }

  const { db, companyId } = await getServerTenant();
  const document = await db.document.findFirst({
    where: {
      bucketId,
      bucket: { companyId },
    },

    include: { bucket: true },
  });

  if (!document || !document.bucket) {
    return notFound();
  }

  const file = document.bucket;
  const remoteFile = await getPresignedGetUrl(file.key);

  return (
    <Fragment>
      <div className="mb-5 flex">
        <Link href={`/${publicId}/documents`}>
          <Button
            variant="outline"
            size="icon"
            className="-mt-1 mr-3 flex items-center rounded-full"
          >
            <RiArrowLeftSLine className="h-5 w-5" />
          </Button>
        </Link>

        <FileIcon type={file.mimeType} />

        <h1 className="ml-3 text-2xl font-semibold tracking-tight">
          <span className="text-primary/60">{file.name}</span>
        </h1>
      </div>

      <Card className="p-5">
        <FilePreview
          name={file.name}
          url={remoteFile.url}
          mimeType={file.mimeType}
        />
      </Card>
    </Fragment>
  );
};

export default DocumentPreview;
