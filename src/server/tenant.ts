import "server-only";

import { getServerPermissions } from "@/lib/rbac/access-control";
import { cache } from "react";
import { db } from "./db";
import { tenantDb } from "./tenant-db";

/**
 * The caller's verified (ACTIVE, onboarded) company and a db scoped to it.
 * Server components use this instead of the global db or the JWT's companyId.
 * Throws when there is no valid membership, like getServerPermissions.
 */
export const getServerTenant = cache(async () => {
  const { membership } = await getServerPermissions();
  return {
    companyId: membership.companyId,
    memberId: membership.memberId,
    db: tenantDb(db, membership.companyId),
  };
});
