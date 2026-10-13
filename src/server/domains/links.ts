import type { TPrismaOrTransaction } from "@/server/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { domainConfig, tenantOrigin } from "./config";
import { handoffStartUrl } from "./redirects";
import { primaryHostname } from "./registry";
import { getRequestHost } from "./request-host";

export async function companyHomeUrl(
  db: TPrismaOrTransaction,
  companyId: string,
  publicId: string,
) {
  const host = domainConfig().enabled
    ? await primaryHostname(db, companyId)
    : null;
  return host ? `${tenantOrigin(host)}/${publicId}` : `/${publicId}`;
}

/**
 * Where to send a user who is signed in on the canonical host into a company:
 * through the handoff, so they never stop on the company's login page.
 * Links for anyone else (emails, shared links) keep companyHomeUrl.
 */
export async function companyEntryUrl(
  db: TPrismaOrTransaction,
  companyId: string,
  publicId: string,
) {
  const host = domainConfig().enabled
    ? await primaryHostname(db, companyId)
    : null;
  return host ? handoffStartUrl(host, `/${publicId}`) : `/${publicId}`;
}

/** Public URL on the company's own host (flag on + primary), else the canonical base. */
export async function companyUrl(
  db: TPrismaOrTransaction,
  companyId: string,
  path: string,
) {
  const host = domainConfig().enabled
    ? await primaryHostname(db, companyId)
    : null;
  return `${host ? tenantOrigin(host) : domainConfig().canonicalOrigin}${path}`;
}

export const userUrl = (path: string) =>
  `${domainConfig().canonicalOrigin}${path}`;

/** Public token pages: a tenant host may only serve its own company's resources. */
export async function assertHostOwns(companyId: string) {
  const host = await getRequestHost();
  if (host.kind === "unknown") notFound();
  if (host.kind === "tenant" && host.companyId !== companyId) notFound();
  if (host.kind === "alias") {
    const path = (await headers()).get("x-dr-path") ?? "/";
    redirect(`${tenantOrigin(host.redirectHost)}${path}`);
  }
}
