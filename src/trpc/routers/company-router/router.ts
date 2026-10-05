import { Audit } from "@/server/audit";
import {
  createTRPCRouter,
  withAccessControl,
  withTenant,
} from "@/trpc/api/trpc";
import { ZodOnboardingMutationSchema } from "../onboarding-router/schema";
import { switchCompanyProcedure } from "./procedures/switch-company";

export const companyRouter = createTRPCRouter({
  getCompany: withTenant.query(async ({ ctx }) => {
    const { memberId } = ctx.tenant;

    const company = await ctx.tenant.db.member.findFirstOrThrow({
      where: {
        id: memberId,
      },
      select: {
        id: true,
        title: true,
        company: {
          select: {
            id: true,
            publicId: true,
            name: true,
            website: true,
            incorporationDate: true,
            incorporationType: true,
            incorporationState: true,
            incorporationCountry: true,
            state: true,
            city: true,
            zipcode: true,
            streetAddress: true,
            country: true,
            logo: true,
          },
        },
      },
    });
    return company;
  }),
  switchCompany: switchCompanyProcedure,
  updateCompany: withAccessControl
    .meta({ policies: { company: { allow: ["update"] } } })
    .input(ZodOnboardingMutationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { company } = input;
        const { incorporationDate, ...rest } = company;
        const { requestIp, userAgent, session } = ctx;
        const db = ctx.tenant.db;
        const { user } = session;
        const { companyId } = ctx.tenant;

        await db.company.update({
          where: {
            id: companyId,
          },
          data: {
            incorporationDate: new Date(incorporationDate),
            ...rest,
          },
        });

        await Audit.create(
          {
            action: "company.updated",
            companyId,
            actor: { type: "user", id: user.id },
            context: {
              userAgent,
              requestIp,
            },
            target: [{ type: "company", id: companyId }],
            summary: `${user.name} updated the company ${company.name}`,
          },
          db,
        );

        return {
          success: true,
          message: "successfully updated company",
        };
      } catch (error) {
        console.error("Error onboarding:", error);
        return {
          success: false,
          message:
            "Oops, something went wrong while onboarding. Please try again.",
        };
      }
    }),
});
