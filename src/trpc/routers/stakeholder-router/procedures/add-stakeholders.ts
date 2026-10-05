import { Audit } from "@/server/audit";
import { withAccessControl } from "@/trpc/api/trpc";
import { ZodAddStakeholderArrayMutationSchema } from "../schema";

export const addStakeholdersProcedure = withAccessControl
  .input(ZodAddStakeholderArrayMutationSchema)
  .meta({ policies: { stakeholder: { allow: ["create"] } } })
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
      try {
        const { user } = session;
        await db.$transaction(async (tx) => {
          // insert companyId in every input
          const inputDataWithCompanyId = input.map((stakeholder) => ({
            ...stakeholder,
            companyId,
          }));

          // skipped duplicates are not returned, so they are not audited
          const added = await tx.stakeholder.createManyAndReturn({
            data: inputDataWithCompanyId,
            skipDuplicates: true,
            select: { id: true, name: true },
          });

          for (const stakeholder of added) {
            await Audit.create(
              {
                action: "stakeholder.added",
                companyId,
                actor: { type: "user", id: user.id },
                context: {
                  userAgent,
                  requestIp,
                },
                target: [{ type: "stakeholder", id: stakeholder.id }],
                summary: `${user.name} added stakeholder ${stakeholder.name} for the company ID ${companyId}`,
              },
              tx,
            );
          }
        });

        return {
          success: true,
          message: "Stakeholders added successfully!",
        };
      } catch (_error) {
        return {
          success: false,
          message: "Oops, something went wrong. Please try again later.",
        };
      }
    },
  );
