import { randomBytes } from "node:crypto";
import { env } from "@/env";
import { type TPrismaOrTransaction, db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { domainConfig } from "./config";
import { normalizeCustomHostname } from "./core/custom-hostname";
import { type DnsDeps, checkDomainDns, realDnsDeps } from "./dns";
import { clearResolveCache, liveAliasWhere } from "./registry";

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
  | "not-verified";

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
  clearResolveCache();
  return asRow(row);
}

const serverIps = () =>
  (env.CUSTOM_DOMAIN_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// The previous primary becomes a permanent alias that redirects here.
async function makePrimary(
  tx: TPrismaOrTransaction,
  companyId: string,
  domainId: string,
) {
  await tx.companyDomain.updateMany({
    where: { companyId, isPrimary: true, id: { not: domainId } },
    data: { isPrimary: false, status: "ALIAS", aliasExpiresAt: null },
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

export async function verifyCustomDomain(
  i: { companyId: string; domainId: string },
  deps: DnsDeps = realDnsDeps,
): Promise<
  { ok: true; row: DomainRow } | { ok: false; owned: boolean; routed: boolean }
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

  try {
    await db.$transaction(async (tx) => {
      // re-check inside the transaction: the row may have been removed meanwhile
      const { count } = await tx.companyDomain.updateMany({
        where: { id: domainId, companyId, status: "PENDING" },
        data: { status: "ACTIVE", verifiedAt: new Date() },
      });
      if (count !== 1) throw new CustomDomainError("not-found");
      await makePrimary(tx, companyId, domainId);
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
  return { ok: true, row: asRow(verified) };
}

export async function setPrimaryDomain(i: {
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
          OR: [{ status: "ACTIVE" }, liveAliasWhere()],
        },
        select: { id: true },
      });
      if (!target) throw new CustomDomainError("not-found");
      await makePrimary(tx, companyId, domainId);
    });
  } finally {
    clearResolveCache();
  }
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
      await tx.companyDomain.update({
        where: { id: domainId, companyId },
        data: { status: "RELEASED", releasedAt: new Date(), isPrimary: false },
      });
      if (!target.isPrimary) return;
      // never zero addresses: the platform row sorts first, permanent aliases before expiring ones
      const next = await tx.companyDomain.findFirst({
        where: {
          companyId,
          id: { not: domainId },
          OR: [{ status: "ACTIVE" }, liveAliasWhere()],
        },
        orderBy: [
          { kind: "asc" },
          { aliasExpiresAt: { sort: "desc", nulls: "first" } },
        ],
        select: { id: true },
      });
      if (next) await makePrimary(tx, companyId, next.id);
    });
  } finally {
    clearResolveCache();
  }
}

// ACTIVE and ALIAS custom rows across all companies: the CORS allow-list and TLS ask.
export async function liveCustomHostnames(): Promise<string[]> {
  const rows = await db.companyDomain.findMany({
    where: { kind: "CUSTOM", status: { in: ["ACTIVE", "ALIAS"] } },
    select: { hostname: true },
    distinct: ["hostname"],
    orderBy: { hostname: "asc" },
  });
  return rows.map((r) => r.hostname);
}
