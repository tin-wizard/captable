import { Audit } from "@/server/audit";
import { domainConfig, tenantOrigin } from "@/server/domains/config";
import { validateLabel } from "@/server/domains/core/subdomain";
import {
  CustomDomainError,
  addCustomDomain,
  listDomains,
  removeCustomDomain,
  setPrimaryDomain,
  verifyCustomDomain,
} from "@/server/domains/custom";
import {
  DomainTakenError,
  InvalidLabelError,
  PlatformRenameBlockedError,
  hostnameFor,
  isLabelAvailable,
  liveAliasWhere,
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
  if (!domainConfig().enabled)
    return { available: false, reason: null, suggestion: null };
  const reason = validateLabel(label);
  if (reason) return { available: false, reason, suggestion: null };
  // the company's own live alias can be claimed back
  const own =
    ownCompanyId &&
    (await db.companyDomain.count({
      where: {
        companyId: ownCompanyId,
        hostname: hostnameFor(label),
        ...liveAliasWhere(),
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

const adminOnly = withAccessControl.meta({
  policies: { company: { allow: ["update"] } },
});
const domainIdInput = z.object({ domainId: z.string().max(100) });

type AdminCtx = {
  db: Parameters<typeof Audit.create>[1];
  tenant: { companyId: string };
  session: { user: { id: string; name?: string | null } };
  userAgent: string;
  requestIp: string;
};

// The flag check runs past the access check, like rename. CustomDomainError
// codes become the message so the client can map its own copy.
async function custom<T>(fn: () => Promise<T>) {
  if (!domainConfig().enabled) throw new TRPCError({ code: "NOT_FOUND" });
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CustomDomainError)
      throw new TRPCError({
        code:
          e.code === "taken"
            ? "CONFLICT"
            : e.code === "not-found"
              ? "NOT_FOUND"
              : "BAD_REQUEST",
        message: e.code,
      });
    throw e;
  }
}

const audit = (
  ctx: AdminCtx,
  action:
    | "domain.added"
    | "domain.verified"
    | "domain.primary-changed"
    | "domain.removed",
  summary: string,
) =>
  Audit.create(
    {
      action,
      companyId: ctx.tenant.companyId,
      actor: { type: "user", id: ctx.session.user.id },
      context: { userAgent: ctx.userAgent, requestIp: ctx.requestIp },
      target: [{ type: "company", id: ctx.tenant.companyId }],
      summary: `${ctx.session.user.name} ${summary}`,
    },
    ctx.db,
  );

const hostnameOf = (ctx: AdminCtx, id: string) =>
  ctx.db.companyDomain
    .findFirstOrThrow({
      where: { id, companyId: ctx.tenant.companyId },
      select: { hostname: true },
    })
    .then((r) => r.hostname);

const customRouter = createTRPCRouter({
  list: adminOnly.query(({ ctx }) =>
    custom(async () => ({
      rows: await listDomains(ctx.tenant.companyId),
      dnsTarget: domainConfig().canonicalHost,
    })),
  ),

  add: adminOnly
    .input(z.object({ hostname: z.string().max(300) }))
    .mutation(({ ctx, input }) =>
      custom(async () => {
        const row = await addCustomDomain({
          companyId: ctx.tenant.companyId,
          raw: input.hostname,
          createdById: ctx.session.user.id,
        });
        await audit(ctx, "domain.added", `added the domain ${row.hostname}`);
        return row;
      }),
    ),

  verify: adminOnly.input(domainIdInput).mutation(({ ctx, input }) =>
    custom(async () => {
      const r = await verifyCustomDomain({
        companyId: ctx.tenant.companyId,
        domainId: input.domainId,
      });
      if (!r.ok) return r;
      await audit(
        ctx,
        "domain.verified",
        `verified the domain ${r.row.hostname}, now the company address`,
      );
      return { ok: true as const };
    }),
  ),

  setPrimary: adminOnly.input(domainIdInput).mutation(({ ctx, input }) =>
    custom(async () => {
      const { companyId } = ctx.tenant;
      await setPrimaryDomain({ companyId, domainId: input.domainId });
      const hostname = await hostnameOf(ctx, input.domainId);
      await audit(
        ctx,
        "domain.primary-changed",
        `changed the company address to ${hostname}`,
      );
    }),
  ),

  remove: adminOnly.input(domainIdInput).mutation(({ ctx, input }) =>
    custom(async () => {
      const { companyId } = ctx.tenant;
      await removeCustomDomain({ companyId, domainId: input.domainId });
      const hostname = await hostnameOf(ctx, input.domainId);
      await audit(ctx, "domain.removed", `removed the domain ${hostname}`);
    }),
  ),
});

export const domainRouter = createTRPCRouter({
  custom: customRouter,

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
    if (!domainConfig().enabled)
      return { enabled: false, hostname: null, primaryKind: null, aliases: [] };
    const { companyId } = ctx.tenant;
    const rows = await ctx.tenant.db.companyDomain.findMany({
      where: {
        companyId,
        OR: [{ isPrimary: true, status: "ACTIVE" }, liveAliasWhere()],
      },
      select: {
        hostname: true,
        kind: true,
        isPrimary: true,
        aliasExpiresAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const primary = rows.find((r) => r.isPrimary);
    return {
      enabled: true,
      hostname: primary?.hostname ?? null,
      primaryKind: primary?.kind ?? null,
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
        if (e instanceof PlatformRenameBlockedError)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "custom-primary",
          });
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
