import { createTRPCRouter } from "@/trpc/api/trpc";
import { createBucketProcedure } from "./procedures/create-bucket";
import { getBucketUrlProcedure } from "./procedures/get-url";
import {
  presignPublicUploadProcedure,
  presignUploadProcedure,
} from "./procedures/presign-upload";

export const bucketRouter = createTRPCRouter({
  create: createBucketProcedure,
  presignUpload: presignUploadProcedure,
  presignPublicUpload: presignPublicUploadProcedure,
  getUrl: getBucketUrlProcedure,
});
