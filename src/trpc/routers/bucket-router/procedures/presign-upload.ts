import { getPresignedPutUrl } from "@/server/file-uploads";
import { withAccessControl, withAuth } from "@/trpc/api/trpc";
import {
  ZodPresignPublicUploadSchema,
  ZodPresignUploadSchema,
} from "../schema";

// Private company files: the key lives under the caller's company publicId.
export const presignUploadProcedure = withAccessControl
  .input(ZodPresignUploadSchema)
  .meta({ policies: { documents: { allow: ["create"] } } })
  .mutation(async ({ ctx: { tenant }, input }) => {
    const { publicId } = await tenant.db.company.findUniqueOrThrow({
      where: { id: tenant.companyId },
      select: { publicId: true },
    });
    return getPresignedPutUrl({
      ...input,
      identifier: publicId,
      bucketMode: "privateBucket",
    });
  });

// Public images (avatars, company logos) under the session user's id. Only a
// session is needed: a logo is uploaded during onboarding, before any
// membership exists. No Bucket row is created for these.
export const presignPublicUploadProcedure = withAuth
  .input(ZodPresignPublicUploadSchema)
  .mutation(({ ctx: { session }, input }) =>
    getPresignedPutUrl({
      ...input,
      identifier: session.user.id,
      bucketMode: "publicBucket",
    }),
  );
