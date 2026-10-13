import EmptyState from "@/components/common/empty-state";
import { OfficeViewer } from "@/components/file/office-viewer";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { fileType } from "@/lib/mime";
import { RiFileUnknowFill as UnknownFileIcon } from "@remixicon/react";
import type { ReactNode } from "react";

type FilePreviewProps = {
  name: string;
  url: string;
  mimeType?: string;
};

const ImagePreview = ({ url, name }: FilePreviewProps) => {
  return <img className="rounded" src={url} alt={name} />;
};

const AuditPreview = ({ url, name, mimeType }: FilePreviewProps) => {
  return (
    // biome-ignore lint/a11y/useMediaCaption: <explanation>
    <audio controls className="w-full">
      <source src={url} type={mimeType} />
      Your browser does not support the audio element.
    </audio>
  );
};

const VideoPreview = ({ url, name, mimeType }: FilePreviewProps) => {
  return (
    // biome-ignore lint/a11y/useMediaCaption: <explanation>
    <video controls className="w-full rounded">
      <source src={url} type={mimeType} />
      Your browser does not support the video type.
    </video>
  );
};

// The raw URL is never exposed as a link here: downloading goes through the
// caller's button (tracked on public pages), or not at all.
const UnknownPreview = ({
  mimeType,
  downloadButton,
}: {
  mimeType: string;
  downloadButton?: ReactNode;
}) => {
  return (
    <EmptyState
      title="Preview not available"
      subtitle={
        downloadButton
          ? `This file type - ${mimeType} is not yet supported by the previewer. You can download the file by clicking the button below.`
          : `This file type - ${mimeType} is not yet supported by the previewer.`
      }
      icon={<UnknownFileIcon />}
    >
      {downloadButton ?? (
        <p className="text-sm text-muted-foreground">
          Downloads are turned off for this data room.
        </p>
      )}
    </EmptyState>
  );
};

const FilePreview = ({
  url,
  name,
  mimeType,
  downloadButton,
}: FilePreviewProps & { downloadButton?: ReactNode }) => {
  mimeType = mimeType || "";
  const type = fileType(mimeType);
  const viewer = renderViewer(type, url, name, mimeType);
  if (!viewer)
    return (
      <UnknownPreview mimeType={mimeType} downloadButton={downloadButton} />
    );
  return (
    <>
      {downloadButton && (
        <div className="mb-4 flex justify-end">{downloadButton}</div>
      )}
      {viewer}
    </>
  );
};

const renderViewer = (
  type: ReturnType<typeof fileType>,
  url: string,
  name: string,
  mimeType: string,
) => {
  switch (type) {
    case "pdf":
      return <PdfViewer file={url} />;
    case "image":
      return <ImagePreview url={url} name={name} />;
    case "audio":
      return <AuditPreview url={url} name={name} mimeType={mimeType} />;
    case "video":
      return <VideoPreview url={url} name={name} mimeType={mimeType} />;
    case "doc":
    case "excel":
    case "powerpoint":
      return <OfficeViewer url={url} />;
    default:
      return null;
  }
};

export default FilePreview;
