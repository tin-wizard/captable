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
  let plainMemberId: string;
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
    plainMemberId = (await mk("plain", {})).member.id;
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

  // targetMemberId is an ADMIN by now, which a non-admin may not edit at all
  it("a members manager can still change a title (control)", async () => {
    await callerFor(manager).member.updateMember({
      memberId: plainMemberId,
      title: `renamed-${generatePublicId()}`,
    });
  });
});

// Role definition and assignment are admin matters (D2), and a non-admin may
// not act on an admin at all. A custom role holding every roles/members grant
// must still not reach ADMIN power.
describe("roles and admins are admin matters", () => {
  let a: Tenant;
  let b: Tenant;
  let mgr: ReturnType<typeof callerFor>;
  let admin: ReturnType<typeof callerFor>;
  let managerMemberId: string;
  let managerRoleId: string;
  let otherRoleId: string;
  let unusedRoleId: string;
  let peerMemberId: string;
  let plain: Record<"title" | "deactivate" | "remove", string>;
  let adminTarget: string;
  let pendingAdmin: { id: string; email: string };
  const users: string[] = [];
  const emails: string[] = [];

  const errOf = async (run: () => Promise<unknown>) =>
    run().then(
      () => undefined,
      (e: { code?: string; message?: string }) => e,
    );
  const member = (id: string) => db.member.findUnique({ where: { id } });
  const email = (label: string) => {
    const e = `${label}-${nanoid(8)}@example.com`;
    emails.push(e);
    return e;
  };

  beforeAll(async () => {
    vi.spyOn(queue, "send").mockResolvedValue(null);
    vi.spyOn(queue, "insert").mockResolvedValue(undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ({ a, b } = await seedTwoTenants());
    admin = callerFor(a);

    const mkRole = (name: string, permissions: object[]) =>
      db.customRole.create({
        data: { name, companyId: a.companyId, permissions },
      });
    managerRoleId = (
      await mkRole("members and roles manager", [
        { subject: "roles", actions: ["read", "create", "update", "delete"] },
        { subject: "members", actions: ["read", "create", "update", "delete"] },
      ])
    ).id;
    otherRoleId = (await mkRole("other", [])).id;
    unusedRoleId = (await mkRole("unused", [])).id;

    const mk = async (label: string, data: object) => {
      const user = await db.user.create({
        data: { name: label, email: email(label), emailVerified: new Date() },
      });
      users.push(user.id);
      const status =
        (data as { status?: string }).status ?? ("ACTIVE" as const);
      const m = await db.member.create({
        data: {
          userId: user.id,
          companyId: a.companyId,
          status: "ACTIVE",
          isOnboarded: status === "ACTIVE",
          ...data,
        },
      });
      return { user, member: m };
    };

    const m = await mk("roles-manager", {
      role: "CUSTOM",
      customRoleId: managerRoleId,
    });
    managerMemberId = m.member.id;
    mgr = callerFor({
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
    });
    peerMemberId = (
      await mk("peer", { role: "CUSTOM", customRoleId: otherRoleId })
    ).member.id;
    plain = {
      title: (await mk("plain-title", {})).member.id,
      deactivate: (await mk("plain-deactivate", {})).member.id,
      remove: (await mk("plain-remove", {})).member.id,
    };
    adminTarget = (await mk("admin-target", { role: "ADMIN" })).member.id;
    const p = await mk("pending-admin", { role: "ADMIN", status: "PENDING" });
    pendingAdmin = { id: p.member.id, email: p.user.email as string };
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.member.deleteMany({ where: { companyId: a.companyId } });
    await db.customRole.deleteMany({ where: { companyId: a.companyId } });
    await db.verificationToken.deleteMany({
      where: { OR: emails.map((e) => ({ identifier: { startsWith: e } })) },
    });
    await db.passwordResetToken.deleteMany({
      where: { email: { in: emails } },
    });
    await cleanupTenants(a, b);
    await db.user.deleteMany({
      where: { OR: [{ id: { in: users } }, { email: { in: emails } }] },
    });
  });

  describe("a members+roles manager (custom role) cannot", () => {
    it("edit its own role's permissions", async () => {
      const before = await db.customRole.findUnique({
        where: { id: managerRoleId },
      });
      const err = await errOf(() =>
        mgr.rbac.updateRole({
          roleId: managerRoleId,
          name: "now everything",
          // keeps its own grants and adds full company and billing power
          permissions: {
            roles: { "*": true },
            members: { "*": true },
            company: { "*": true },
            billing: { "*": true },
          },
        }),
      );
      expect(err).toMatchObject({
        code: "FORBIDDEN",
        message: "Only an admin can manage roles.",
      });
      expect(
        await db.customRole.findUnique({ where: { id: managerRoleId } }),
      ).toEqual(before);
    });

    it("create a role (and so cannot assign a new role to anyone)", async () => {
      const count = await db.customRole.count({
        where: { companyId: a.companyId },
      });
      const err = await errOf(() =>
        mgr.rbac.createRole({
          name: "all powerful",
          permissions: { company: { "*": true } },
        }),
      );
      expect(err).toMatchObject({ code: "FORBIDDEN" });
      expect(
        await db.customRole.count({ where: { companyId: a.companyId } }),
      ).toBe(count);
    });

    it("delete a role", async () => {
      const err = await errOf(() =>
        mgr.rbac.deleteRole({ roleId: unusedRoleId }),
      );
      expect(err).toMatchObject({ code: "FORBIDDEN" });
      expect(await db.customRole.count({ where: { id: unusedRoleId } })).toBe(
        1,
      );
    });

    it("assign an existing role to itself or to another member", async () => {
      for (const memberId of [managerMemberId, plain.title, peerMemberId]) {
        const before = await member(memberId);
        const roleId = memberId === peerMemberId ? managerRoleId : otherRoleId;
        const err = await errOf(() =>
          mgr.member.updateMember({ memberId, roleId }),
        );
        expect(err).toMatchObject({ code: "FORBIDDEN" });
        expect(await member(memberId)).toEqual(before);
      }
    });

    it("remove another member's role", async () => {
      const before = await member(peerMemberId);
      const err = await errOf(() =>
        mgr.member.updateMember({ memberId: peerMemberId, roleId: "" }),
      );
      expect(err).toMatchObject({ code: "FORBIDDEN" });
      expect(await member(peerMemberId)).toEqual(before);
    });

    it("invite someone with a role", async () => {
      const e = email("invited-with-role");
      const err = await errOf(() =>
        mgr.member.inviteMember({
          email: e,
          name: "x",
          title: "x",
          roleId: otherRoleId,
        }),
      );
      expect(err).toMatchObject({ code: "FORBIDDEN" });
      expect(await db.member.count({ where: { user: { email: e } } })).toBe(0);
    });

    it("update, deactivate, remove, re-invite or revoke an ADMIN", async () => {
      const attempts: [string, () => Promise<unknown>][] = [
        [
          adminTarget,
          () => mgr.member.updateMember({ memberId: adminTarget, title: "x" }),
        ],
        [
          adminTarget,
          () =>
            mgr.member.updateMember({
              memberId: adminTarget,
              title: "x",
              roleId: ADMIN_ROLE_ID,
            }),
        ],
        [
          adminTarget,
          () =>
            mgr.member.toggleActivation({
              memberId: adminTarget,
              status: "INACTIVE",
            }),
        ],
        [adminTarget, () => mgr.member.removeMember({ memberId: adminTarget })],
        [
          pendingAdmin.id,
          () => mgr.member.reInvite({ memberId: pendingAdmin.id }),
        ],
        [
          pendingAdmin.id,
          () =>
            mgr.member.revokeInvite({
              memberId: pendingAdmin.id,
              email: pendingAdmin.email,
            }),
        ],
      ];
      for (const [id, attempt] of attempts) {
        const before = await member(id);
        expect(await errOf(attempt)).toMatchObject({
          code: "FORBIDDEN",
          message: "Only an admin can manage an admin.",
        });
        expect(await member(id)).toEqual(before);
      }
      expect(
        await db.verificationToken.count({
          where: { identifier: { contains: pendingAdmin.id } },
        }),
      ).toBe(0);
    });
  });

  describe("a members+roles manager can still", () => {
    it("change a member's title when the UI resends the unchanged role", async () => {
      await mgr.member.updateMember({
        memberId: plain.title,
        title: "new title",
        roleId: "",
      });
      await mgr.member.updateMember({
        memberId: peerMemberId,
        title: "peer title",
        roleId: otherRoleId,
      });
      expect((await member(plain.title))?.title).toBe("new title");
      expect(await member(peerMemberId)).toMatchObject({
        title: "peer title",
        role: "CUSTOM",
        customRoleId: otherRoleId,
      });
    });

    it("invite someone with no role", async () => {
      await mgr.member.inviteMember({
        email: email("invited-no-role"),
        name: "x",
        title: "x",
      });
    });

    it("deactivate and remove a non-admin member", async () => {
      await mgr.member.toggleActivation({
        memberId: plain.deactivate,
        status: "INACTIVE",
      });
      expect((await member(plain.deactivate))?.status).toBe("INACTIVE");
      await mgr.member.removeMember({ memberId: plain.remove });
      expect(await member(plain.remove)).toBeNull();
    });
  });

  describe("deleting a role", () => {
    it("is refused while a member holds it", async () => {
      const err = await errOf(() =>
        admin.rbac.deleteRole({ roleId: otherRoleId }),
      );
      expect(err).toMatchObject({ code: "BAD_REQUEST" });
      expect(await db.customRole.count({ where: { id: otherRoleId } })).toBe(1);
    });

    it("succeeds when nobody holds it", async () => {
      await admin.rbac.deleteRole({ roleId: unusedRoleId });
      expect(await db.customRole.count({ where: { id: unusedRoleId } })).toBe(
        0,
      );
    });
  });

  describe("an ADMIN can (controls)", () => {
    it("create, edit and assign roles", async () => {
      await admin.rbac.createRole({ name: "admin made", permissions: {} });
      await admin.rbac.updateRole({
        roleId: otherRoleId,
        name: "other edited",
        permissions: { stakeholder: { read: true } },
      });
      await admin.member.updateMember({
        memberId: plain.title,
        roleId: otherRoleId,
      });
      expect((await member(plain.title))?.customRoleId).toBe(otherRoleId);
      await admin.member.inviteMember({
        email: email("admin-invite-with-role"),
        name: "x",
        title: "x",
        roleId: otherRoleId,
      });
    });

    it("update, deactivate, re-invite, revoke and remove an ADMIN", async () => {
      await admin.member.updateMember({ memberId: adminTarget, title: "t" });
      await admin.member.reInvite({ memberId: pendingAdmin.id });
      await admin.member.revokeInvite({
        memberId: pendingAdmin.id,
        email: pendingAdmin.email,
      });
      expect(await member(pendingAdmin.id)).toBeNull();
      await admin.member.toggleActivation({
        memberId: adminTarget,
        status: "INACTIVE",
      });
      await admin.member.removeMember({ memberId: adminTarget });
      expect(await member(adminTarget)).toBeNull();
    });
  });
});
