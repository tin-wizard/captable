import { env } from "@/env";
import type { AppRouter } from "@/trpc/api/root";
import type {
  ZodPresignPublicUploadSchema,
  ZodPresignUploadSchema,
} from "@/trpc/routers/bucket-router/schema";
import { getUrl, transformer } from "@/trpc/shared";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { toast } from "sonner";
import type { z } from "zod";

// Browser-side uploads. The server picks where a file lands (company publicId
// or user id) in the bucket procedures; this module never touches S3 config.
const client = createTRPCProxyClient<AppRouter>({
  transformer,
  links: [httpBatchLink({ url: getUrl() })],
});

type PrivatePrefix = z.infer<typeof ZodPresignUploadSchema>["keyPrefix"];
type PublicPrefix = z.infer<typeof ZodPresignPublicUploadSchema>["keyPrefix"];
type PublicType = z.infer<typeof ZodPresignPublicUploadSchema>["contentType"];

/**
 * usage
 * ```js
 * const { key } = await uploadFile(file, { keyPrefix: "generic-documents" });
 * // then register it: api.bucket.create({ key, ... })
 * ```
 */
export const uploadFile = async (
  file: File,
  { keyPrefix }: { keyPrefix: PrivatePrefix | PublicPrefix },
) => {
  const input = {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    // signed as content-length: the PUT below must send exactly these bytes
    size: file.size,
  };
  const isPublic =
    keyPrefix === "company-logos" || keyPrefix === "profile-avatars";
  const { url, key, bucketUrl } = isPublic
    ? await client.bucket.presignPublicUpload.mutate({
        ...input,
        // callers validate image types first (validateFile); the server rejects others
        contentType: input.contentType as PublicType,
        keyPrefix,
      })
    : await client.bucket.presignUpload.mutate({ ...input, keyPrefix });
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: await file.arrayBuffer(),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to upload file "${file.name}", failed with status code ${res.status}`,
    );
  }

  const { name, type, size } = file;
  let fileUrl = bucketUrl;

  const uploadDomain =
    process.env.NEXT_PUBLIC_UPLOAD_DOMAIN || env.NEXT_PUBLIC_UPLOAD_DOMAIN;

  if (isPublic && uploadDomain) {
    fileUrl = `${uploadDomain}/${key}`;
  }

  return {
    key,
    name,
    mimeType: type,
    size,
    fileUrl,
  };
};

export type TUploadFile = Awaited<ReturnType<typeof uploadFile>>;

// Opens one of the caller's company's files. getUrl refuses a bucket the
// company does not own (another company's, or a legacy one with no owner).
export const openFileOnTab = async (key: string) => {
  try {
    const { url } = await client.bucket.getUrl.query({ key });
    window.open(url, "_blank");
  } catch {
    toast.error("This file is not available");
  }
};
