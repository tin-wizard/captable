import { env } from "@/env";
import type { TPrismaOrTransaction } from "@/server/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { domainConfig, tenantOrigin } from "./config";
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

/** Public URL on the company's own host (flag on + primary), else the canonical base. */
export async function companyUrl(
  db: TPrismaOrTransaction,
  companyId: string,
  path: string,
) {
  const host = domainConfig().enabled
    ? await primaryHostname(db, companyId)
    : null;
  return `${host ? tenantOrigin(host) : env.NEXT_PUBLIC_BASE_URL}${path}`;
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
