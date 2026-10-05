import { generatePublicId } from "@/common/id";
import { Audit } from "@/server/audit";
import { assertBucketUsable, assertTenantOwns } from "@/server/tenant-guard";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodAddExistingSafeMutationSchema } from "../schema";

export const addExistingSafeProcedure = withAccessControl
  .input(ZodAddExistingSafeMutationSchema)
  .meta({ policies: { securities: { allow: ["create"] } } })
  .mutation(async ({ ctx, input }) => {
    const { userAgent, requestIp } = ctx;
    const user = ctx.session.user;
    const { documents, ...rest } = input;

    try {
      await ctx.tenant.db.$transaction(async (tx) => {
        const { companyId, memberId } = ctx.tenant;

        await assertTenantOwns(tx, companyId, input);

        const safe = await tx.safe.create({
          data: {
            publicId: generatePublicId(),
            companyId,
            ...rest,
            issueDate: new Date(input.issueDate),
            boardApprovalDate: new Date(input.boardApprovalDate),
          },
        });

        for (const doc of documents) {
          await assertBucketUsable(tx, companyId, doc.bucketId);
        }

        const bulkDocuments = documents.map((doc) => ({
          companyId,
          uploaderId: memberId,
          publicId: generatePublicId(),
          name: doc.name,
          bucketId: doc.bucketId,
          safeId: safe.id,
        }));

        await tx.document.createMany({
          data: bulkDocuments,
          skipDuplicates: true,
        });

        await Audit.create(
          {
            action: "safe.imported",
            companyId,
            actor: { type: "user", id: user.id },
            context: {
              userAgent,
              requestIp,
            },
            target: [{ type: "company", id: companyId }],
            summary: `${user.name} imported existing SAFEs.`,
          },
          tx,
        );
      });

      return {
        success: true,
        message: "SAFEs imported for the stakeholder.",
      };
    } catch (error) {
      console.error("Error adding existing SAFEs:", error);
      return {
        success: false,
        message: "Something went wrong.",
      };
    }
  });
