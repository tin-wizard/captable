import { type TPrismaOrTransaction, db as globalDb } from "@/server/db";
import { Prisma } from "@prisma/client";
import { domainConfig } from "./config";
import {
  LABEL_MAX,
  nextAvailableLabel,
  suggestLabel,
  validateLabel,
} from "./core/subdomain";

const ALIAS_DAYS = 30;

export class InvalidLabelError extends Error {
  constructor(public reason: "format" | "reserved") {
    super(`invalid subdomain: ${reason}`);
  }
}
export class DomainTakenError extends Error {
  constructor(public suggestion: string | null) {
    super("subdomain taken");
  }
}

export const hostnameFor = (label: string) =>
  `${label}.${domainConfig().baseDomain}`;

const LIVE = { not: "RELEASED" } as const;

// Hostnames are global: uniqueness reads/releases always use the unscoped db,
// never the caller's (possibly tenant-scoped) client. Release is idempotent.
// Expired aliases are released lazily, right before anyone can claim their hostname.
async function releaseExpiredAliases(hostname?: string) {
  await globalDb.companyDomain.updateMany({
    where: {
      status: "ALIAS",
      aliasExpiresAt: { lt: new Date() },
      ...(hostname ? { hostname } : {}),
    },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
}

export async function isLabelAvailable(
  _db: TPrismaOrTransaction,
  label: string,
) {
  if (validateLabel(label)) return false;
  await releaseExpiredAliases(hostnameFor(label));
  return (
    (await globalDb.companyDomain.count({
      where: { hostname: hostnameFor(label), status: LIVE },
    })) === 0
  );
}

// `fallbackSeed` (e.g. a publicId) guarantees an answer when every `base-N` is taken.
export async function suggestAvailableLabel(
  _db: TPrismaOrTransaction,
  companyName: string,
  fallbackSeed?: string,
  // readonly: never write (dry runs); expired aliases count as free instead of being released.
  // extraTaken: labels already chosen but not yet persisted.
  opts: { readonly?: boolean; extraTaken?: Set<string> } = {},
) {
  if (!opts.readonly) await releaseExpiredAliases();
  const base = suggestLabel(companyName);
  const suffix = domainConfig().baseDomain.length + 1;
  // nextAvailableLabel truncates long bases before adding "-N"; match that shorter prefix
  const prefix = base.slice(0, LABEL_MAX - 3).replace(/-+$/, "");
  const taken = new Set(
    (
      await globalDb.companyDomain.findMany({
        where: {
          hostname: { startsWith: prefix },
          ...(opts.readonly
            ? {
                OR: [
                  { status: "ACTIVE" },
                  { status: "ALIAS", aliasExpiresAt: { gt: new Date() } },
                ],
              }
            : { status: LIVE }),
        },
        select: { hostname: true },
      })
    ).map((d) => d.hostname.slice(0, -suffix)),
  );
  for (const l of opts.extraTaken ?? []) taken.add(l);
  return (
    nextAvailableLabel(base, (l) => taken.has(l)) ??
    (fallbackSeed
      ? `company-${fallbackSeed
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 6)}`
      : null)
  );
}

async function insertPrimary(
  tx: TPrismaOrTransaction,
  {
    companyId,
    label,
    createdById,
  }: { companyId: string; label: string; createdById: string | null },
) {
  const reason = validateLabel(label);
  if (reason) throw new InvalidLabelError(reason);
  const hostname = hostnameFor(label);
  await releaseExpiredAliases(hostname);
  try {
    await tx.companyDomain.create({
      data: {
        companyId,
        hostname,
        kind: "PLATFORM",
        status: "ACTIVE",
        isPrimary: true,
        createdById,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      throw new DomainTakenError(await suggestAvailableLabel(globalDb, label));
    }
    throw e;
  }
  clearResolveCache();
  return { hostname };
}

export const assignPlatformSubdomain = insertPrimary;

export async function renamePlatformSubdomain(
  tx: TPrismaOrTransaction,
  input: { companyId: string; label: string; createdById: string },
) {
  const hostname = hostnameFor(input.label);
  const current = await tx.companyDomain.findFirst({
    where: { companyId: input.companyId, isPrimary: true },
  });
  if (current?.hostname === hostname) return { hostname };
  await tx.companyDomain.updateMany({
    where: { companyId: input.companyId, isPrimary: true, kind: "PLATFORM" },
    data: {
      isPrimary: false,
      status: "ALIAS",
      aliasExpiresAt: new Date(Date.now() + ALIAS_DAYS * 864e5),
    },
  });
  // renaming back to one of our own live aliases promotes it instead of colliding
  const ownAlias = await tx.companyDomain.updateMany({
    where: {
      companyId: input.companyId,
      hostname,
      status: "ALIAS",
      aliasExpiresAt: { gt: new Date() },
    },
    data: { status: "ACTIVE", isPrimary: true, aliasExpiresAt: null },
  });
  if (ownAlias.count === 1) {
    clearResolveCache();
    return { hostname };
  }
  return insertPrimary(tx, input);
}

export async function primaryHostnameForPublicId(publicId: string) {
  const company = await globalDb.company.findUnique({
    where: { publicId },
    select: { id: true },
  });
  return company
    ? {
        companyId: company.id,
        // flag off: no registry lookups, so the flag stays a clean rollback
        hostname: domainConfig().enabled
          ? await primaryHostname(globalDb, company.id)
          : null,
      }
    : null;
}

export async function primaryHostname(
  db: TPrismaOrTransaction,
  companyId: string,
) {
  const row = await db.companyDomain.findFirst({
    where: { companyId, isPrimary: true, status: "ACTIVE" },
    select: { hostname: true },
  });
  return row?.hostname ?? null;
}

export type ResolvedHost = {
  companyId: string;
  publicId: string;
  status: "ACTIVE" | "ALIAS";
  primaryHostname: string | null;
};

// shortcut: per-process cache; with >1 app replica, a rename is visible
// everywhere within 30 s. Upgrade to LISTEN/NOTIFY when scaling out.
// Positive and negative entries live in separate maps, so random hostnames
// can't evict real companies. Map insertion order gives cheap LRU eviction.
const hits = new Map<string, { at: number; value: ResolvedHost }>();
const misses = new Map<string, number>();
const TTL_HIT = 30_000;
const TTL_MISS = 10_000;
const MAX_HITS = 10_000;
const MAX_MISSES = 2_000;

export function clearResolveCache() {
  hits.clear();
  misses.clear();
}

function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.delete(key);
  if (map.size >= max) map.delete(map.keys().next().value as K);
  map.set(key, value);
}

// Global lookup by design: the host decides which company to scope to.
export async function resolveHostname(
  hostname: string,
): Promise<ResolvedHost | null> {
  const hit = hits.get(hostname);
  if (hit && Date.now() - hit.at < TTL_HIT) return hit.value;
  const miss = misses.get(hostname);
  if (miss && Date.now() - miss < TTL_MISS) return null;

  const row = await globalDb.companyDomain.findFirst({
    where: {
      hostname,
      OR: [
        { status: "ACTIVE" },
        { status: "ALIAS", aliasExpiresAt: { gt: new Date() } },
      ],
    },
    select: {
      companyId: true,
      status: true,
      company: { select: { publicId: true } },
    },
  });
  const value: ResolvedHost | null = row
    ? {
        companyId: row.companyId,
        publicId: row.company.publicId,
        status: row.status as "ACTIVE" | "ALIAS",
        primaryHostname:
          row.status === "ALIAS"
            ? await primaryHostname(globalDb, row.companyId)
            : hostname,
      }
    : null;
  if (value) remember(hits, hostname, { at: Date.now(), value }, MAX_HITS);
  else remember(misses, hostname, Date.now(), MAX_MISSES);
  return value;
}
