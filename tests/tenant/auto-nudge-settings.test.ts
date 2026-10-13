import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, callerFor, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
const extraUsers: string[] = [];

async function memberWith(permissions: object[]) {
  const user = await db.user.create({
    data: {
      name: "nudge member",
      email: `nudge-set-${nanoid(8)}@example.com`,
      emailVerified: new Date(),
    },
  });
  extraUsers.push(user.id);
  const role = await db.customRole.create({
    data: { companyId: a.companyId, name: nanoid(6), permissions },
  });
  const member = await db.member.create({
    data: {
      userId: user.id,
      companyId: a.companyId,
      role: "CUSTOM",
      customRoleId: role.id,
      status: "ACTIVE",
      isOnboarded: true,
    },
  });
  return callerFor({
    ...a,
    memberId: member.id,
    userId: user.id,
    session: {
      ...a.session,
      user: {
        ...a.session.user,
        id: user.id,
        email: user.email,
        memberId: member.id,
      },
    },
  });
}

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await cleanupFixtures(aIds, bIds, [a, b]);
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
});

const room = (id: string) => db.dataRoom.findUniqueOrThrow({ where: { id } });
const upd = (id: string) => db.update.findUniqueOrThrow({ where: { id } });
const audits = (companyId: string, action: string) =>
  db.audit.findMany({ where: { companyId, action } });

describe("setAutoNudge", () => {
  it("flips only the caller's data room and audits it", async () => {
    const before = (await audits(a.companyId, "dataroom.updated")).length;
    await callerFor(a).dataRoom.setAutoNudge({
      dataRoomId: aIds.dataRoomId,
      enabled: true,
    });
    expect((await room(aIds.dataRoomId)).autoNudge).toBe(true);
    expect((await room(bIds.dataRoomId)).autoNudge).toBe(false);
    const rows = await audits(a.companyId, "dataroom.updated");
    expect(rows.length).toBe(before + 1);
    expect(rows.map((r) => r.summary).join("\n")).toContain(
      "turned automatic reminders on for the data room",
    );
  });

  it("flips only the caller's update and audits it", async () => {
    await callerFor(a).update.setAutoNudge({
      updateId: aIds.updateId,
      enabled: true,
    });
    expect((await upd(aIds.updateId)).autoNudge).toBe(true);
    expect((await upd(bIds.updateId)).autoNudge).toBe(false);
    const rows = await audits(a.companyId, "update.updated");
    expect(rows.map((r) => r.summary).join("\n")).toContain(
      "turned automatic reminders on for the update",
    );
  });

  it("refuses another tenant's room and update", async () => {
    await expect(
      callerFor(a).dataRoom.setAutoNudge({
        dataRoomId: bIds.dataRoomId,
        enabled: true,
      }),
    ).rejects.toThrow();
    await expect(
      callerFor(a).update.setAutoNudge({
        updateId: bIds.updateId,
        enabled: true,
      }),
    ).rejects.toThrow();
    expect((await room(bIds.dataRoomId)).autoNudge).toBe(false);
    expect((await upd(bIds.updateId)).autoNudge).toBe(false);
  });

  it("needs data-rooms:update / updates:update", async () => {
    const reader = await memberWith([
      { subject: "data-rooms", actions: ["read"] },
      { subject: "updates", actions: ["read"] },
    ]);
    await expect(
      reader.dataRoom.setAutoNudge({
        dataRoomId: aIds.dataRoomId,
        enabled: false,
      }),
    ).rejects.toThrow();
    await expect(
      reader.update.setAutoNudge({ updateId: aIds.updateId, enabled: false }),
    ).rejects.toThrow();
    expect((await room(aIds.dataRoomId)).autoNudge).toBe(true);
    expect((await upd(aIds.updateId)).autoNudge).toBe(true);
  });
});

describe("stopReminders", () => {
  it("data room: sets the flag on that recipient only, keeps updatedAt, audits", async () => {
    const other = await db.dataRoomRecipient.create({
      data: { dataRoomId: aIds.dataRoomId, name: "o", email: "o@example.com" },
    });
    const target = await db.dataRoomRecipient.create({
      data: { dataRoomId: aIds.dataRoomId, name: "t", email: "t@example.com" },
    });
    const before = await db.dataRoomRecipient.findUniqueOrThrow({
      where: { id: target.id },
    });
    const n = (await audits(a.companyId, "dataroom.updated")).length;

    await callerFor(a).dataRoom.stopReminders({
      dataRoomId: aIds.dataRoomId,
      recipientId: target.id,
      stopped: true,
    });
    const after = await db.dataRoomRecipient.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.nudgeOptOut).toBe(true);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(
      (
        await db.dataRoomRecipient.findUniqueOrThrow({
          where: { id: other.id },
        })
      ).nudgeOptOut,
    ).toBe(false);
    expect((await audits(a.companyId, "dataroom.updated")).length).toBe(n + 1);

    await callerFor(a).dataRoom.stopReminders({
      dataRoomId: aIds.dataRoomId,
      recipientId: target.id,
      stopped: false,
    });
    expect(
      (
        await db.dataRoomRecipient.findUniqueOrThrow({
          where: { id: target.id },
        })
      ).nudgeOptOut,
    ).toBe(false);
  });

  it("update: sets the flag on that recipient only, keeps updatedAt, audits", async () => {
    const other = await db.updateRecipient.create({
      data: { updateId: aIds.updateId, name: "o", email: "o2@example.com" },
    });
    const target = await db.updateRecipient.create({
      data: { updateId: aIds.updateId, name: "t", email: "t2@example.com" },
    });
    const before = await db.updateRecipient.findUniqueOrThrow({
      where: { id: target.id },
    });
    const n = (await audits(a.companyId, "update.updated")).length;

    await callerFor(a).update.stopReminders({
      updateId: aIds.updateId,
      recipientId: target.id,
      stopped: true,
    });
    const after = await db.updateRecipient.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.nudgeOptOut).toBe(true);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(
      (await db.updateRecipient.findUniqueOrThrow({ where: { id: other.id } }))
        .nudgeOptOut,
    ).toBe(false);
    expect((await audits(a.companyId, "update.updated")).length).toBe(n + 1);
  });

  it("refuses another tenant's recipient, including via the caller's own room", async () => {
    await expect(
      callerFor(a).dataRoom.stopReminders({
        dataRoomId: bIds.dataRoomId,
        recipientId: bIds.dataRoomRecipientId,
        stopped: true,
      }),
    ).rejects.toThrow();
    await expect(
      callerFor(a).dataRoom.stopReminders({
        dataRoomId: aIds.dataRoomId,
        recipientId: bIds.dataRoomRecipientId,
        stopped: true,
      }),
    ).rejects.toThrow();
    await expect(
      callerFor(a).update.stopReminders({
        updateId: aIds.updateId,
        recipientId: bIds.updateRecipientId,
        stopped: true,
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.dataRoomRecipient.findUniqueOrThrow({
          where: { id: bIds.dataRoomRecipientId },
        })
      ).nudgeOptOut,
    ).toBe(false);
    expect(
      (
        await db.updateRecipient.findUniqueOrThrow({
          where: { id: bIds.updateRecipientId },
        })
      ).nudgeOptOut,
    ).toBe(false);
  });

  it("needs data-rooms:update / updates:update", async () => {
    const reader = await memberWith([
      { subject: "data-rooms", actions: ["read"] },
      { subject: "updates", actions: ["read"] },
    ]);
    const roomRec = await db.dataRoomRecipient.create({
      data: { dataRoomId: aIds.dataRoomId, name: "r", email: "r@example.com" },
    });
    const updRec = await db.updateRecipient.create({
      data: { updateId: aIds.updateId, name: "r", email: "r2@example.com" },
    });
    await expect(
      reader.dataRoom.stopReminders({
        dataRoomId: aIds.dataRoomId,
        recipientId: roomRec.id,
        stopped: true,
      }),
    ).rejects.toThrow(/permission|forbidden|not allowed|unauthor/i);
    await expect(
      reader.update.stopReminders({
        updateId: aIds.updateId,
        recipientId: updRec.id,
        stopped: true,
      }),
    ).rejects.toThrow(/permission|forbidden|not allowed|unauthor/i);
    expect(
      (
        await db.dataRoomRecipient.findUniqueOrThrow({
          where: { id: roomRec.id },
        })
      ).nudgeOptOut,
    ).toBe(false);
  });
});

describe("company autoNudge preference", () => {
  it("is returned, saved, audited and needs company:update", async () => {
    expect(await callerFor(a).company.preferences()).toMatchObject({
      autoNudge: false,
    });
    const reader = await memberWith([
      { subject: "company", actions: ["read"] },
    ]);
    await expect(
      reader.company.updatePreferences({
        timezone: "UTC",
        viewRetentionMonths: 24,
        autoNudge: true,
      }),
    ).rejects.toThrow();
    const n = (await audits(a.companyId, "company.updated")).length;
    await callerFor(a).company.updatePreferences({
      timezone: "UTC",
      viewRetentionMonths: 24,
      autoNudge: true,
    });
    expect(await callerFor(a).company.preferences()).toMatchObject({
      autoNudge: true,
    });
    expect((await audits(a.companyId, "company.updated")).length).toBe(n + 1);
    expect(
      (await db.company.findUniqueOrThrow({ where: { id: b.companyId } }))
        .autoNudge,
    ).toBe(false);
  });

  it("an older caller that omits autoNudge leaves it unchanged", async () => {
    await callerFor(a).company.updatePreferences({
      timezone: "UTC",
      viewRetentionMonths: 24,
    });
    expect(await callerFor(a).company.preferences()).toMatchObject({
      autoNudge: true,
    });
  });
});
