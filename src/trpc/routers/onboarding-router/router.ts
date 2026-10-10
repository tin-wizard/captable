import { generatePublicId } from "@/common/id";
import { createTRPCRouter, withAuth } from "@/trpc/api/trpc";
import { ZodOnboardingMutationSchema } from "./schema";

import { Audit } from "@/server/audit";
import { domainConfig } from "@/server/domains/config";
import { companyHomeUrl } from "@/server/domains/links";
import {
  DomainTakenError,
  InvalidLabelError,
  assignPlatformSubdomain,
  suggestAvailableLabel,
} from "@/server/domains/registry";

// HERE: Reusing this same router for new company, onboarding and edit company.
export const onboardingRouter = createTRPCRouter({
  onboard: withAuth
    .input(ZodOnboardingMutationSchema)
    .mutation(async ({ ctx, input }) => {
      const { userAgent, requestIp } = ctx;
      try {
        const { subdomain, ...companyData } = input.company;
        const { publicId, companyId } = await ctx.db.$transaction(
          async (tx) => {
            const publicId = generatePublicId();

            const company = await tx.company.create({
              data: {
                ...companyData,
                incorporationDate: new Date(companyData.incorporationDate),
                publicId,
              },
            });

            const user = await tx.user.update({
              where: {
                id: ctx.session.user.id,
              },
              data: {
                // email is never changed here: it is verified at sign-in, and an
                // unverified overwrite lets a user claim someone else's address
                name: `${input.user.name}`,
              },
              select: {
                id: true,
                name: true,
              },
            });

            await tx.member.create({
              data: {
                // the company creator is its first admin (there is no schema default)
                role: "ADMIN",
                isOnboarded: true,
                status: "ACTIVE",
                title: input.user.title,
                userId: user.id,
                companyId: company.id,
                lastAccessed: new Date(),
              },
            });

            await Audit.create(
              {
                action: "user.onboarded",
                companyId: company.id,
                actor: { type: "user", id: user.id },
                context: {
                  userAgent,
                  requestIp,
                },
                target: [{ type: "company", id: company.id }],
                summary: `${user.name} onboarded ${company.name}`,
              },
              tx,
            );

            await Audit.create(
              {
                action: "company.created",
                companyId: company.id,
                actor: { type: "user", id: user.id },
                context: {
                  userAgent,
                  requestIp,
                },
                target: [{ type: "company", id: company.id }],
                summary: `${user.name} created company ${company.name}`,
              },
              tx,
            );

            if (domainConfig().enabled) {
              const label =
                subdomain ??
                (await suggestAvailableLabel(tx, companyData.name, publicId));
              const { hostname } = await assignPlatformSubdomain(tx, {
                companyId: company.id,
                label: label ?? "",
                createdById: user.id,
              });
              await Audit.create(
                {
                  action: "company.subdomain-assigned",
                  companyId: company.id,
                  actor: { type: "user", id: user.id },
                  context: { userAgent, requestIp },
                  target: [{ type: "company", id: company.id }],
                  summary: `${user.name} assigned ${hostname} to ${company.name}`,
                },
                tx,
              );
            }

            return { publicId, companyId: company.id };
          },
        );

        const url = await companyHomeUrl(ctx.db, companyId, publicId);
        return {
          success: true as const,
          message: "successfully onboarded",
          publicId,
          url,
        };
      } catch (error) {
        if (error instanceof DomainTakenError) {
          return {
            success: false as const,
            message: "That company address is already taken.",
            field: "subdomain" as const,
            suggestion: error.suggestion,
          };
        }
        if (error instanceof InvalidLabelError) {
          return {
            success: false as const,
            message:
              error.reason === "reserved"
                ? "This company address is reserved."
                : "Use 3-40 lowercase letters, numbers or hyphens.",
            field: "subdomain" as const,
            suggestion: null,
          };
        }
        console.error("Error onboarding:", error);
        return {
          success: false as const,
          message:
            "Oops, something went wrong while onboarding. Please try again.",
        };
      }
    }),
});
