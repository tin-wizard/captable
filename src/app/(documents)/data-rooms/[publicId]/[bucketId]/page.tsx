import FilePreview from "@/components/file/preview";
import { DownloadButton } from "@/components/share/download-button";
import { ExpiredLink } from "@/components/share/expired-link";
import { NdaGate } from "@/components/share/nda-gate";
import { SharePageLayout } from "@/components/share/page-layout";
import { ViewBeacon } from "@/components/share/view-beacon";
import { type JWTVerifyResult, decode } from "@/lib/jwt";
import { isExpired } from "@/server/activity/link-state";
import { getNdaState } from "@/server/activity/nda";
import { db } from "@/server/db";
import { assertHostOwns } from "@/server/domains/links";
import { getPresignedGetUrl } from "@/server/file-uploads";
import { RiFolder3Fill as FolderIcon } from "@remixicon/react";
import Link from "next/link";
import { notFound } from "next/navigation";

const DataRoomPage = async (props: {
  params: Promise<{ publicId: string; bucketId: string }>;
  searchParams: Promise<{ token: string }>;
}) => {
  const searchParams = await props.searchParams;

  const { token } = searchParams;

  const params = await props.params;

  const { publicId, bucketId } = params;

  let decodedToken: JWTVerifyResult | null = null;

  try {
    decodedToken = await decode(token);
  } catch {
    return notFound();
  }

  const { companyId, dataRoomId, recipientId } = decodedToken.payload;
  if (!companyId || !recipientId || !dataRoomId) {
    return notFound();
  }

  const recipient = await db.dataRoomRecipient.findFirst({
    where: { id: recipientId, dataRoomId },
    select: { id: true, expiresAt: true },
  });

  if (!recipient) {
    return notFound();
  }

  const dataRoom = await db.dataRoom.findFirst({
    where: {
      publicId,
    },

    include: {
      company: true,
      documents: {
        include: {
          document: {
            include: {
              bucket: true,
            },
          },
        },
      },
    },
  });

  if (!dataRoom) {
    return notFound();
  }

  const dataRoomFile = dataRoom.documents.find(
    (doc) => doc.document.bucket.id === bucketId,
  );

  if (
    dataRoomId !== dataRoom.id ||
    dataRoom?.companyId !== companyId ||
    !dataRoomFile
  ) {
    return notFound();
  }

  await assertHostOwns(dataRoom.companyId);

  // before any file list or presigned URL is produced
  if (isExpired(recipient.expiresAt)) {
    return <ExpiredLink companyName={dataRoom.company.name} />;
  }

  const file = dataRoomFile?.document.bucket;

  if (!file) {
    return notFound();
  }

  const company = dataRoom.company;

  // the gate also holds on a direct bucket URL: no presigned URL before acceptance
  const nda = await getNdaState(db, {
    kind: "DATA_ROOM",
    targetId: dataRoom.id,
    recipientId: recipient.id,
    companyId: dataRoom.companyId,
  });
  if (nda.required && !nda.accepted) {
    return (
      <SharePageLayout
        company={{ name: company.name, logo: company.logo }}
        title={null}
      >
        <NdaGate
          kind="DATA_ROOM"
          token={token}
          companyName={company.name}
          text={nda.text}
        />
      </SharePageLayout>
    );
  }

  const remoteFile = await getPresignedGetUrl(file.key);

  return (
    <SharePageLayout
      company={{
        name: company.name,
        logo: company.logo,
      }}
      title={
        <div className="flex">
          <FolderIcon
            className="mr-3 mt-1 h-6 w-6 text-primary/60"
            aria-hidden="true"
          />

          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-primary/60">Data room / </span>
            <Link
              href={`/data-rooms/${publicId}?token=${token}`}
              className="text-primary/60 hover:text-primary/90 hover:underline"
            >
              {dataRoom.name}
            </Link>
            {` / ${file.name}`}
          </h1>
        </div>
      }
    >
      <ViewBeacon kind="DATA_ROOM" token={token} bucketId={file.id} />
      <FilePreview
        name={file.name}
        url={remoteFile.url}
        mimeType={file.mimeType}
        downloadButton={
          dataRoom.allowDownload ? (
            <DownloadButton token={token} bucketId={file.id} />
          ) : undefined
        }
      />
    </SharePageLayout>
  );
};

export default DataRoomPage;
