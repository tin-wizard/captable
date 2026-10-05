import { getPresignedGetUrl } from "@/server/file-uploads";
import { withAccessControl } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { ZodGetBucketUrlSchema } from "../schema";

// Bucket is a tenant model: the scoped client only finds the caller's buckets.
export const getBucketUrlProcedure = withAccessControl
  .input(ZodGetBucketUrlSchema)
  .meta({ policies: { documents: { allow: ["read"] } } })
  .query(async ({ ctx: { tenant }, input }) => {
    const bucket = await tenant.db.bucket.findFirst({
      where: "bucketId" in input ? { id: input.bucketId } : { key: input.key },
      select: { key: true },
    });
    if (!bucket) throw new TRPCError({ code: "NOT_FOUND" });
    return getPresignedGetUrl(bucket.key);
  });
