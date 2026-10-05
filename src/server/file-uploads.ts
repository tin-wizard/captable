// Server-only S3 helpers. Deliberately not a server-action module (no
// directive): every export of one is a public, unauthenticated endpoint.
// Browsers go through the bucket tRPC procedures (presignUpload,
// presignPublicUpload, getUrl), which derive and check ownership.
import path from "node:path";
import { customId } from "@/common/id";
import { env } from "@/env";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import slugify from "@sindresorhus/slugify";

const region = env.UPLOAD_REGION;
const endpoint = env.UPLOAD_ENDPOINT;
const accessKeyId = env.UPLOAD_ACCESS_KEY_ID;
const secretAccessKey = env.UPLOAD_SECRET_ACCESS_KEY;
const hasCredentials = accessKeyId && secretAccessKey;
const PrivateBucket = env.UPLOAD_BUCKET_PRIVATE;
const PublicBucket = env.UPLOAD_BUCKET_PUBLIC;

const S3 = new S3Client({
  region,
  endpoint,
  credentials: hasCredentials
    ? {
        secretAccessKey,
        accessKeyId,
      }
    : undefined,
});

export type TypeKeyPrefixes =
  | "new-safes"
  | "existing-safes"
  | "signed-esign-doc"
  | "unsigned-esign-doc"
  | "stock-option-docs"
  | "company-logos"
  | "profile-avatars"
  | "generic-documents"
  | "shares-docs"
  | `data-room/${string}`;

export interface getPresignedUrlOptions {
  contentType: string;
  // exact byte length of the body; signed as content-length, so the PUT must
  // send exactly this many bytes
  size: number;
  expiresIn?: number;
  fileName: string;
  keyPrefix: TypeKeyPrefixes;
  // should be companyPublicId or memberId or userId
  identifier: string;
  bucketMode: "privateBucket" | "publicBucket";
}

const TEN_MINUTES_IN_SECONDS = 10 * 60;

export const getPresignedPutUrl = async ({
  contentType,
  size,
  expiresIn,
  fileName,
  keyPrefix,
  identifier,
  bucketMode,
}: getPresignedUrlOptions) => {
  const { name, ext: rawExt } = path.parse(fileName);
  // only a plain extension reaches the key and the public fileUrl
  const ext = /^\.[a-z0-9]{1,10}$/i.test(rawExt) ? rawExt : "";

  const Key = `${identifier}/${keyPrefix}-${slugify(name)}-${customId(
    12,
  )}${ext}`;

  // no declared type means octet-stream; this exact value is signed and must be
  // the Content-Type of the PUT (callers read it from the return value)
  const type = contentType || "application/octet-stream";

  const putObjectCommand = new PutObjectCommand({
    Bucket: bucketMode === "privateBucket" ? PrivateBucket : PublicBucket,
    Key,
    ContentType: type,
    ContentLength: size,
    ACL: bucketMode === "privateBucket" ? "private" : "public-read",
  });

  // the presigner hoists nothing for content-type by default: sign it, or the
  // uploader could store any type (e.g. text/html under a public-read key)
  const url: string = await getSignedUrl(S3, putObjectCommand, {
    expiresIn: expiresIn ?? TEN_MINUTES_IN_SECONDS,
    signableHeaders: new Set(["content-type"]),
  });

  const bucketUrl = new URL(url);
  bucketUrl.search = "";

  return {
    url,
    key: Key,
    bucketUrl: bucketUrl.toString(),
    contentType: type,
  };
};

export const getPresignedGetUrl = async (key: string) => {
  const getObjectCommand = new GetObjectCommand({
    Bucket: PrivateBucket,
    Key: key,
    // ResponseContentDisposition: `attachment; filename="${key}"`,
    ResponseContentDisposition: "inline",
  });

  const url = await getSignedUrl(S3, getObjectCommand, {
    expiresIn: TEN_MINUTES_IN_SECONDS,
  });

  return { key, url };
};

// Server-side upload (jobs, seeded templates): presign under a server-chosen
// identifier and PUT the bytes.
export const uploadFile = async (
  file: File,
  options: Pick<
    getPresignedUrlOptions,
    "expiresIn" | "keyPrefix" | "identifier"
  >,
  bucketMode: "publicBucket" | "privateBucket" = "privateBucket",
) => {
  // callers pass File-shaped objects whose .size is not the real length
  // (esign sets 0), so sign the length of the bytes actually sent
  const body = await file.arrayBuffer();
  const { url, key, bucketUrl, contentType } = await getPresignedPutUrl({
    contentType: file.type,
    fileName: file.name,
    size: body.byteLength,
    bucketMode,
    ...options,
  });
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Failed to upload file "${file.name}", failed with status code ${res.status}`,
    );
  }
  const { name, type, size } = file;
  return { key, name, mimeType: type, size, fileUrl: bucketUrl };
};

export type TUploadFile = Awaited<ReturnType<typeof uploadFile>>;

export const getFileFromS3 = async (key: string) => {
  const { url } = await getPresignedGetUrl(key);
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(
      `Failed to get file "${key}", failed with status code ${response.status}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
};
