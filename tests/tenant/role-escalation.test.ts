import { generatePublicId } from "@/common/id";
import { queue } from "@/lib/queue";
import { ADMIN_ROLE_ID } from "@/lib/rbac/constants";
import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callerFor, cleanupTenants, seedTwoTenants } from "../helpers/seed";
import type { Tenant } from "../helpers/seed";

// members:create / members:update let a custom role manage people. They must
// not let it mint admins: only an ADMIN may grant the ADMIN role.
describe("granting the ADMIN role", () => {
  let a: Tenant;
  let b: Tenant;
  let manager: Tenant;
  let targetMemberId: string;
  const extraUsers: string[] = [];

  beforeAll(async () => {
    vi.spyOn(queue, "send").mockResolvedValue(null);
    vi.spyOn(queue, "insert").mockResolvedValue(undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ({ a, b } = await seedTwoTenants());

    const role = await db.customRole.create({
      data: {
        name: "people manager",
        companyId: a.companyId,
        permissions: [
          { subject: "members", actions: ["read", "create", "update"] },
        ],
      },
    });
    const mk = async (label: string, roleData: object) => {
      const user = await db.user.create({
        data: {
          name: label,
          email: `${label}-${nanoid(8)}@example.com`,
          emailVerified: new Date(),
        },
      });
      extraUsers.push(user.id);
      const member = await db.member.create({
        data: {
          userId: user.id,
          companyId: a.companyId,
          status: "ACTIVE",
          isOnboarded: true,
          ...roleData,
        },
      });
      return { user, member };
    };
    const m = await mk("manager", { role: "CUSTOM", customRoleId: role.id });
    manager = {
      companyId: a.companyId,
      memberId: m.member.id,
      userId: m.user.id,
      session: {
        ...a.session,
        user: {
          ...a.session.user,
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          memberId: m.member.id,
        },
      },
    };
    targetMemberId = (await mk("target", {})).member.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.member.deleteMany({ where: { companyId: a.companyId } });
    await db.customRole.deleteMany({ where: { companyId: a.companyId } });
    await cleanupTenants(a, b);
    await db.user.deleteMany({ where: { id: { in: extraUsers } } });
  });

  const roleOf = async (id: string) =>
    (await db.member.findUniqueOrThrow({ where: { id } })).role;

  it("a members manager cannot promote a member to ADMIN", async () => {
    await expect(
      callerFor(manager).member.updateMember({
        memberId: targetMemberId,
        roleId: ADMIN_ROLE_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await roleOf(targetMemberId)).toBeNull();
  });

  it("a members manager cannot promote themselves", async () => {
    await expect(
      callerFor(manager).member.updateMember({
        memberId: manager.memberId,
        roleId: ADMIN_ROLE_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await roleOf(manager.memberId)).toBe("CUSTOM");
  });

  it("a members manager cannot invite someone as ADMIN", async () => {
    const email = `invitee-${nanoid(8)}@example.com`;
    await expect(
      callerFor(manager).member.inviteMember({
        email,
        name: "invitee",
        title: "invitee",
        roleId: ADMIN_ROLE_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const user = await db.user.findUnique({ where: { email } });
    expect(
      user &&
        (await db.member.count({
          where: { userId: user.id, companyId: a.companyId },
        })),
    ).toBeFalsy();
    if (user) extraUsers.push(user.id);
  });

  it("an ADMIN can still grant ADMIN (control)", async () => {
    await callerFor(a).member.updateMember({
      memberId: targetMemberId,
      roleId: ADMIN_ROLE_ID,
    });
    expect(await roleOf(targetMemberId)).toBe("ADMIN");
  });

  it("a members manager can still change a title (control)", async () => {
    await callerFor(manager).member.updateMember({
      memberId: targetMemberId,
      title: `renamed-${generatePublicId()}`,
    });
  });
});
