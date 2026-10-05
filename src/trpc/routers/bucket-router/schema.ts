import { TAG } from "@/lib/tags";
import { z } from "zod";

// Upload caps in bytes. The presigned PUT signs the declared size as
// content-length, so S3 refuses a body of any other length.
export const MAX_PRIVATE_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PUBLIC_UPLOAD_BYTES = 5 * 1024 * 1024;
const size = (max: number) => z.number().int().positive().max(max);

export const ZodCreateBucketMutationSchema = z.object({
  name: z.string(),
  key: z.string(),
  mimeType: z.string(),
  size: size(MAX_PRIVATE_UPLOAD_BYTES),
  tags: z.array(z.nativeEnum(TAG)),
});

export type TypeZodCreateBucketMutationSchema = z.infer<
  typeof ZodCreateBucketMutationSchema
>;

const file = {
  fileName: z.string().min(1).max(255),
  contentType: z
    .string()
    .max(255)
    .regex(/^[\w.+-]+\/[\w.+-]+$/),
};

// The key's first segment (company publicId or user id) is always chosen by
// the server, never sent by the client: .strict() rejects any extra field.
export const ZodPresignUploadSchema = z
  .object({
    ...file,
    size: size(MAX_PRIVATE_UPLOAD_BYTES),
    keyPrefix: z.union([
      z.enum([
        "new-safes",
        "existing-safes",
        "signed-esign-doc",
        "unsigned-esign-doc",
        "stock-option-docs",
        "generic-documents",
        "shares-docs",
      ]),
      z.custom<`data-room/${string}`>(
        (v) => typeof v === "string" && /^data-room\/[\w-]+$/.test(v),
      ),
    ]),
  })
  .strict();

// public-read objects on the upload domain: raster images only, never
// text/html or image/svg+xml (stored XSS)
export const ZodPresignPublicUploadSchema = z
  .object({
    ...file,
    contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    size: size(MAX_PUBLIC_UPLOAD_BYTES),
    keyPrefix: z.enum(["company-logos", "profile-avatars"]),
  })
  .strict();

export const ZodGetBucketUrlSchema = z.union([
  z.object({ bucketId: z.string() }).strict(),
  z.object({ key: z.string() }).strict(),
]);
