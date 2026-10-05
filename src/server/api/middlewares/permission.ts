import { RBAC } from "@/lib/rbac";
import { getPermissionsForRole } from "@/lib/rbac/access-control";
import type { TActions } from "@/lib/rbac/actions";
import type { TSubjects } from "@/lib/rbac/subjects";
import { createMiddleware } from "hono/factory";
import { ApiError } from "../error";

// Use after authMiddleware(): the same RBAC check tRPC's withAccessControl
// runs, on the membership the auth middleware verified for the path's company.
// An API token is user-scoped, so this is what limits it to the owner's role
// in that company.
export const requirePermission = (subject: TSubjects, action: TActions) =>
  createMiddleware(async (c, next) => {
    const membership = c.get("session")?.membership;
    const tx = c.get("tenantDb");
    const forbidden = new ApiError({
      code: "FORBIDDEN",
      message: "You do not have permission to perform this action",
    });
    if (!membership?.companyId || !tx) throw forbidden;

    const { err, val: permissions } = await getPermissionsForRole({
      role: membership.role,
      customRoleId: membership.customRoleId,
      companyId: membership.companyId,
      tx,
    });
    if (err) throw forbidden;

    const { val } = new RBAC()
      .addPolicies({ [subject]: { allow: [action] } })
      .enforce(permissions);
    if (!val?.valid) throw forbidden;

    await next();
  });
