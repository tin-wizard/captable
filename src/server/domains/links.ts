import type { TPrismaOrTransaction } from "@/server/db";
import { domainConfig, tenantOrigin } from "./config";
import { primaryHostname } from "./registry";

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
