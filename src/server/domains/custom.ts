import { randomBytes } from "node:crypto";
import { env } from "@/env";
import { type TPrismaOrTransaction, db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { domainConfig } from "./config";
import { normalizeCustomHostname } from "./core/custom-hostname";
import { syncCustomOriginsCors } from "./cors";
import { type DnsDeps, checkDomainDns, realDnsDeps } from "./dns";
import {
  ALIAS_DAYS,
  clearResolveCache,
  liveAliasWhere,
  releaseExpiredAliases,
} from "./registry";

// Hostnames are global, so like registry.ts this uses the unscoped db and puts
// companyId in every where itself.

const MAX_CUSTOM = 5;

export type CustomDomainErrorCode =
  | "empty"
  | "format"
  | "platform"
  | "taken"
  | "limit"
  | "not-found"
  | "not-verified"
  | "last-address";

export class CustomDomainError extends Error {
  constructor(public code: CustomDomainErrorCode) {
    super(`custom domain: ${code}`);
  }
}

export type DomainRow = {
  id: string;
  hostname: string;
  kind: "PLATFORM" | "CUSTOM";
  status: "PENDING" | "ACTIVE" | "ALIAS";
  isPrimary: boolean;
  verificationToken: string | null;
  verifiedAt: Date | null;
};

const select = {
  id: true,
  hostname: true,
  kind: true,
  status: true,
  isPrimary: true,
  verificationToken: true,
  verifiedAt: true,
} satisfies Prisma.CompanyDomainSelect;

// Only ever called with non-RELEASED rows.
const asRow = (r: Prisma.CompanyDomainGetPayload<{ select: typeof select }>) =>
  r as DomainRow;

const LIVE_OR_PENDING = { not: "RELEASED" } as const;

export async function listDomains(companyId: string): Promise<DomainRow[]> {
  const rows = await db.companyDomain.findMany({
    where: { companyId, status: LIVE_OR_PENDING },
    select,
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(asRow);
}

export async function addCustomDomain(i: {
  companyId: string;
  raw: string;
  createdById: string;
}): Promise<DomainRow> {
  const res = normalizeCustomHostname(i.raw, domainConfig());
  if (!res.ok) throw new CustomDomainError(res.reason);
  const { hostname } = res;
  const { companyId } = i;
  // custom aliases can expire too (after switching back to the platform address)
  await releaseExpiredAliases(hostname);

  const existing = await db.companyDomain.findFirst({
    where: { companyId, hostname, status: LIVE_OR_PENDING },
    select,
  });
  if (existing) return asRow(existing);

  // only a verified (ACTIVE/ALIAS) claim owns a hostname; PENDING never blocks
  const owned = await db.companyDomain.count({
    where: {
      hostname,
      companyId: { not: companyId },
      status: { in: ["ACTIVE", "ALIAS"] },
    },
  });
  if (owned) throw new CustomDomainError("taken");

  const count = await db.companyDomain.count({
    where: { companyId, kind: "CUSTOM", status: LIVE_OR_PENDING },
  });
  if (count >= MAX_CUSTOM) throw new CustomDomainError("limit");

  const row = await db.companyDomain.create({
    data: {
      companyId,
      hostname,
      kind: "CUSTOM",
      status: "PENDING",
      isPrimary: false,
      verificationToken: randomBytes(16).toString("hex"),
      createdById: i.createdById,
    },
    select,
  });
  return asRow(row);
}

const serverIps = () =>
  (env.CUSTOM_DOMAIN_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Rows that may become primary: any live CUSTOM row, but of the PLATFORM rows
// only the current one (ACTIVE, or the permanent alias kept while a custom
// domain is primary), never an expiring alias left by a rename.
const promotable = () =>
  ({
    OR: [
      { kind: "CUSTOM", OR: [{ status: "ACTIVE" }, liveAliasWhere()] },
      {
        kind: "PLATFORM",
        OR: [{ status: "ACTIVE" }, { status: "ALIAS", aliasExpiresAt: null }],
      },
    ],
  }) satisfies Prisma.CompanyDomainWhereInput;

// The previous primary becomes an alias that redirects here. It is permanent
// only while a custom domain is primary (that keeps the platform address);
// back on a platform address, the demoted row expires like a rename alias.
async function makePrimary(
  tx: TPrismaOrTransaction,
  companyId: string,
  target: { id: string; kind: "PLATFORM" | "CUSTOM" },
) {
  const domainId = target.id;
  await tx.companyDomain.updateMany({
    where: { companyId, isPrimary: true, id: { not: domainId } },
    data: {
      isPrimary: false,
      status: "ALIAS",
      aliasExpiresAt:
        target.kind === "CUSTOM"
          ? null
          : new Date(Date.now() + ALIAS_DAYS * 864e5),
    },
  });
  await tx.companyDomain.update({
    where: { id: domainId, companyId },
    data: { isPrimary: true, status: "ACTIVE", aliasExpiresAt: null },
  });
}

const isHostnameConflict = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === "P2002" &&
  JSON.stringify(e.meta ?? {}).includes("hostname");

// After the domain transaction has committed; never throws. true = synced.
async function syncCors(): Promise<boolean> {
  try {
    const hosts = await liveCustomHostnames();
    const r = await syncCustomOriginsCors(hosts.map((h) => `https://${h}`));
    return !r.skipped && r.ok;
  } catch {
    return false;
  }
}

export async function verifyCustomDomain(
  i: { companyId: string; domainId: string },
  deps: DnsDeps = realDnsDeps,
): Promise<
  | { ok: true; row: DomainRow; corsSynced: boolean }
  | { ok: false; owned: boolean; routed: boolean }
> {
  const { companyId, domainId } = i;
  const row = await db.companyDomain.findFirst({
    where: { id: domainId, companyId, kind: "CUSTOM", status: "PENDING" },
  });
  if (!row?.verificationToken) throw new CustomDomainError("not-found");

  const { canonicalHost, baseDomain } = domainConfig();
  const flags = await checkDomainDns(
    {
      hostname: row.hostname,
      token: row.verificationToken,
      canonicalHost,
      baseDomain,
      serverIps: serverIps(),
    },
    deps,
  );
  if (!flags.owned || !flags.routed) return { ok: false, ...flags };

  await releaseExpiredAliases(row.hostname);
  try {
    await db.$transaction(async (tx) => {
      // re-check inside the transaction: the row may have been removed meanwhile
      const { count } = await tx.companyDomain.updateMany({
        where: { id: domainId, companyId, status: "PENDING" },
        data: { status: "ACTIVE", verifiedAt: new Date() },
      });
      if (count !== 1) throw new CustomDomainError("not-found");
      await makePrimary(tx, companyId, { id: domainId, kind: "CUSTOM" });
    });
  } catch (e) {
    if (isHostnameConflict(e)) throw new CustomDomainError("taken");
    throw e;
  } finally {
    clearResolveCache();
  }
  const verified = await db.companyDomain.findFirstOrThrow({
    where: { id: domainId, companyId },
    select,
  });
  return { ok: true, row: asRow(verified), corsSynced: await syncCors() };
}

export async function setPrimaryDomain(i: {
  companyId: string;
  domainId: string;
}) {
  const { companyId, domainId } = i;
  try {
    await db.$transaction(async (tx) => {
      const target = await tx.companyDomain.findFirst({
        where: { id: domainId, companyId, ...promotable() },
        select: { id: true, kind: true },
      });
      if (!target) throw new CustomDomainError("not-found");
      await makePrimary(tx, companyId, target);
    });
  } finally {
    clearResolveCache();
  }
  return { corsSynced: await syncCors() };
}

export async function removeCustomDomain(i: {
  companyId: string;
  domainId: string;
}) {
  const { companyId, domainId } = i;
  try {
    await db.$transaction(async (tx) => {
      const target = await tx.companyDomain.findFirst({
        where: {
          id: domainId,
          companyId,
          kind: "CUSTOM",
          status: { in: ["PENDING", "ACTIVE", "ALIAS"] },
        },
        select: { isPrimary: true },
      });
      if (!target) throw new CustomDomainError("not-found");
      // never zero addresses: pick the successor before releasing anything;
      // the current platform row sorts first
      const next = target.isPrimary
        ? await tx.companyDomain.findFirst({
            where: { companyId, id: { not: domainId }, ...promotable() },
            orderBy: [
              { kind: "asc" },
              { aliasExpiresAt: { sort: "desc", nulls: "first" } },
            ],
            select: { id: true, kind: true },
          })
        : null;
      if (target.isPrimary && !next)
        throw new CustomDomainError("last-address");
      await tx.companyDomain.update({
        where: { id: domainId, companyId },
        data: { status: "RELEASED", releasedAt: new Date(), isPrimary: false },
      });
      if (next) await makePrimary(tx, companyId, next);
    });
  } finally {
    clearResolveCache();
  }
  return { corsSynced: await syncCors() };
}

// ACTIVE and ALIAS custom rows across all companies: the CORS allow-list and TLS ask.
export async function liveCustomHostnames(): Promise<string[]> {
  const rows = await db.companyDomain.findMany({
    where: { kind: "CUSTOM", OR: [{ status: "ACTIVE" }, liveAliasWhere()] },
    select: { hostname: true },
    distinct: ["hostname"],
    orderBy: { hostname: "asc" },
  });
  return rows.map((r) => r.hostname);
}
