import { Audit } from "@/server/audit";
import type { TPrismaOrTransaction } from "@/server/db";
import { withTenant } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import {
  type TypeZodCreateBucketMutationSchema,
  ZodCreateBucketMutationSchema,
} from "../schema";

interface createBucketHandlerOptions {
  input: TypeZodCreateBucketMutationSchema;
  db: TPrismaOrTransaction;
  // owner of the bucket; callers on the global db (jobs) must pass it
  companyId: string;
  userAgent: string;
  requestIp: string;
  user?: {
    name: string;
    id: string;
  };
}

export const createBucketHandler = async ({
  db,
  input,
  companyId,
  userAgent,
  requestIp,
  user,
}: createBucketHandlerOptions) => {
  const bucket = await db.bucket.create({ data: { ...input, companyId } });

  await Audit.create(
    {
      action: "bucket.created",
      companyId,
      actor: { type: "user", id: user?.id || "" },
      context: {
        userAgent,
        requestIp,
      },
      target: [{ type: "bucket", id: bucket.id }],
      summary: `${user?.name} created the bucket ${bucket.name}`,
    },
    db,
  );

  return bucket;
};

export const createBucketProcedure = withTenant
  .input(ZodCreateBucketMutationSchema)
  .mutation(
    async ({
      ctx: {
        tenant: { db, companyId },
        userAgent,
        requestIp,
        session,
      },
      input,
    }) => {
      // only keys presignUpload could have issued to this company
      const { publicId } = await db.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { publicId: true },
      });
      // exact shape getPresignedPutUrl issues:
      // <publicId>/<keyPrefix>-<slug>-<customId(12)><.ext>
      const pub = publicId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const shape = new RegExp(
        `^${pub}/[\\w/-]+-[a-z0-9]{12}(\\.[a-zA-Z0-9]{1,10})?$`,
      );
      if (input.key.includes("..") || !shape.test(input.key)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid key" });
      }

      const { name, id } = session.user;

      return await createBucketHandler({
        input,
        db,
        companyId,
        userAgent,
        requestIp,
        user: { name: name || "", id },
      });
    },
  );
