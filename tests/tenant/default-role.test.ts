import { getPermissionsForRole } from "@/lib/rbac/access-control";
import { db } from "@/server/db";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTenants, seedTwoTenants } from "../helpers/seed";

// A member created without an explicit role must hold no permissions. The
// schema used to default Member.role to ADMIN, so any new create path that
// forgot the role silently minted an admin.
describe("member without an explicit role", () => {
  const made = seedTwoTenants();
  afterAll(async () => {
    const { a, b } = await made;
    await cleanupTenants(a, b);
  });

  it("has a null role and no permissions", async () => {
    const { a } = await made;
    const user = await db.user.create({
      data: { name: "no role", email: `norole-${Date.now()}@example.com` },
    });
    const member = await db.member.create({
      data: { userId: user.id, companyId: a.companyId, status: "ACTIVE" },
    });
    expect(member.role).toBeNull();

    const { err, val } = await getPermissionsForRole({
      role: member.role,
      companyId: a.companyId,
      customRoleId: member.customRoleId,
      tx: db,
    });
    expect(err).toBeUndefined();
    // "no permissions" = every subject with an empty action list
    expect(val?.length).toBeGreaterThan(0);
    expect(val?.every((p) => p.actions.length === 0)).toBe(true);
    await db.user.delete({ where: { id: user.id } });
  });
});
