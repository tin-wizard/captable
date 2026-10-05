import { generatePublicId } from "@/common/id";
import { Audit } from "@/server/audit";
import type { PrismaTransactionalClient } from "@/server/db";
import { assertBucketUsable } from "@/server/tenant-guard";
import { withTenant } from "@/trpc/api/trpc";
import {
  type TypeZodCreateTemplateMutationSchema,
  ZodCreateTemplateMutationSchema,
} from "../schema";

interface CreateTemplateHandlerProps {
  ctx: {
    db: PrismaTransactionalClient;
    requestIp: string;
    userAgent: string;
    user: {
      id: string;
      name: string;
      companyId: string;
    };
  };

  input: TypeZodCreateTemplateMutationSchema & {
    companyId: string;
    uploaderId: string;
  };
}

export async function createTemplateHandler({
  ctx: { db, user, userAgent, requestIp },
  input: { recipients, ...rest },
}: CreateTemplateHandlerProps) {
  await assertBucketUsable(db, rest.companyId, rest.bucketId);
  const publicId = generatePublicId();
  const template = await db.template.create({
    data: {
      status: "DRAFT",
      publicId,
      ...rest,
    },
    select: {
      id: true,
      publicId: true,
      name: true,
    },
  });

  await Audit.create(
    {
      action: "template.created",
      companyId: user.companyId,
      actor: { type: "user", id: user.id },
      context: {
        userAgent,
        requestIp,
      },
      target: [{ type: "template", id: template.id }],
      summary: `${user.name} added templateField for template ID ${template.id}`,
    },
    db,
  );

  await db.esignRecipient.createMany({
    data: recipients.map((recipient) => ({
      ...recipient,
      templateId: template.id,
    })),
  });

  return template;
}

export const createTemplateProcedure = withTenant
  .input(ZodCreateTemplateMutationSchema)
  .mutation(async ({ ctx, input }) => {
    const { requestIp, userAgent, session } = ctx;

    const user = {
      name: session.user.name || "",
      id: session.user.id,
      companyId: session.user.companyId,
    };

    const { companyId, memberId: uploaderId } = ctx.tenant;

    const data = await ctx.tenant.db.$transaction(async (tx) => {
      return await createTemplateHandler({
        input: {
          ...input,
          companyId,
          uploaderId,
        },
        ctx: { db: tx, requestIp, userAgent, user },
      });
    });

    return data;
  });
