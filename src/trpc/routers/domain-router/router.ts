import { Audit } from "@/server/audit";
import { domainConfig, tenantOrigin } from "@/server/domains/config";
import { validateLabel } from "@/server/domains/core/subdomain";
import {
  DomainTakenError,
  InvalidLabelError,
  hostnameFor,
  isLabelAvailable,
  renamePlatformSubdomain,
  suggestAvailableLabel,
} from "@/server/domains/registry";
import {
  createTRPCRouter,
  withAccessControl,
  withAuth,
  withTenant,
} from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const labelInput = z.object({ label: z.string().max(100) });

async function availability(
  db: Parameters<typeof isLabelAvailable>[0],
  label: string,
  ownCompanyId?: string,
) {
  const reason = validateLabel(label);
  if (reason) return { available: false, reason, suggestion: null };
  // the company's own live alias can be claimed back
  const own =
    ownCompanyId &&
    (await db.companyDomain.count({
      where: {
        companyId: ownCompanyId,
        hostname: hostnameFor(label),
        status: "ALIAS",
        aliasExpiresAt: { gt: new Date() },
      },
    }));
  if (own || (await isLabelAvailable(db, label)))
    return { available: true, reason: null, suggestion: null };
  return {
    available: false,
    reason: "taken" as const,
    suggestion: await suggestAvailableLabel(db, label),
  };
}

export const domainRouter = createTRPCRouter({
  suggest: withAuth
    .input(z.object({ name: z.string().max(200) }))
    .query(async ({ ctx, input }) => {
      const { enabled, baseDomain } = domainConfig();
      if (!enabled) return { label: null, baseDomain, enabled };
      return {
        label: await suggestAvailableLabel(ctx.db, input.name),
        baseDomain,
        enabled,
      };
    }),

  checkAvailability: withAuth
    .input(labelInput)
    .query(({ ctx, input }) => availability(ctx.db, input.label)),

  checkRename: withTenant
    .input(labelInput)
    .query(({ ctx, input }) =>
      availability(ctx.tenant.db, input.label, ctx.tenant.companyId),
    ),

  current: withTenant.query(async ({ ctx }) => {
    const { companyId } = ctx.tenant;
    const rows = await ctx.tenant.db.companyDomain.findMany({
      where: {
        companyId,
        OR: [
          { isPrimary: true, status: "ACTIVE" },
          { status: "ALIAS", aliasExpiresAt: { gt: new Date() } },
        ],
      },
      select: {
        hostname: true,
        isPrimary: true,
        aliasExpiresAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      enabled: domainConfig().enabled,
      hostname: rows.find((r) => r.isPrimary)?.hostname ?? null,
      aliases: rows
        .filter((r) => !r.isPrimary && r.aliasExpiresAt)
        .map((r) => ({
          hostname: r.hostname,
          expiresAt: r.aliasExpiresAt as Date,
        })),
    };
  }),

  rename: withAccessControl
    .meta({ policies: { company: { allow: ["update"] } } })
    .input(labelInput)
    .mutation(async ({ ctx, input }) => {
      if (!domainConfig().enabled) throw new TRPCError({ code: "NOT_FOUND" });
      const { companyId } = ctx.tenant;
      const { user } = ctx.session;
      try {
        const hostname = await ctx.db.$transaction(async (tx) => {
          const { hostname } = await renamePlatformSubdomain(tx, {
            companyId,
            label: input.label,
            createdById: user.id,
          });
          await Audit.create(
            {
              action: "company.subdomain-renamed",
              companyId,
              actor: { type: "user", id: user.id },
              context: {
                userAgent: ctx.userAgent,
                requestIp: ctx.requestIp,
              },
              target: [{ type: "company", id: companyId }],
              summary: `${user.name} changed the company address to ${hostname}`,
            },
            tx,
          );
          return hostname;
        });
        const company = await ctx.tenant.db.company.findFirstOrThrow({
          where: { id: companyId },
          select: { publicId: true },
        });
        return { url: `${tenantOrigin(hostname)}/${company.publicId}` };
      } catch (e) {
        if (e instanceof InvalidLabelError)
          throw new TRPCError({ code: "BAD_REQUEST", message: e.reason });
        if (e instanceof DomainTakenError)
          throw new TRPCError({
            code: "CONFLICT",
            message: JSON.stringify({ suggestion: e.suggestion }),
          });
        throw e;
      }
    }),
});
