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
      name: "access member",
      email: `access-set-${nanoid(8)}@example.com`,
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

describe("setAccess", () => {
  it("changes only the caller's room, leaves the other flag alone, audits", async () => {
    const before = (await audits(a.companyId, "dataroom.updated")).length;
    await callerFor(a).dataRoom.setAccess({
      dataRoomId: aIds.dataRoomId,
      allowDownload: true,
    });
    expect(await room(aIds.dataRoomId)).toMatchObject({
      allowDownload: true,
      requireNda: false,
    });
    await callerFor(a).dataRoom.setAccess({
      dataRoomId: aIds.dataRoomId,
      requireNda: true,
    });
    expect(await room(aIds.dataRoomId)).toMatchObject({
      allowDownload: true,
      requireNda: true,
    });
    expect(await room(bIds.dataRoomId)).toMatchObject({
      allowDownload: false,
      requireNda: false,
    });
    const rows = await audits(a.companyId, "dataroom.updated");
    expect(rows.length).toBe(before + 2);
    const text = rows.map((r) => r.summary).join("\n");
    expect(text).toContain("downloads");
    expect(text).toContain("NDA");
  });

  it("changes only the caller's update and audits", async () => {
    const before = (await audits(a.companyId, "update.updated")).length;
    await callerFor(a).update.setAccess({
      updateId: aIds.updateId,
      requireNda: true,
    });
    expect((await upd(aIds.updateId)).requireNda).toBe(true);
    expect((await upd(bIds.updateId)).requireNda).toBe(false);
    expect((await audits(a.companyId, "update.updated")).length).toBe(
      before + 1,
    );
  });

  it("refuses another tenant's room and update", async () => {
    await expect(
      callerFor(a).dataRoom.setAccess({
        dataRoomId: bIds.dataRoomId,
        allowDownload: true,
      }),
    ).rejects.toThrow();
    await expect(
      callerFor(a).update.setAccess({
        updateId: bIds.updateId,
        requireNda: true,
      }),
    ).rejects.toThrow();
  });

  it("needs data-rooms:update / updates:update", async () => {
    const reader = await memberWith([
      { subject: "data-rooms", actions: ["read"] },
      { subject: "updates", actions: ["read"] },
    ]);
    await expect(
      reader.dataRoom.setAccess({
        dataRoomId: aIds.dataRoomId,
        allowDownload: false,
      }),
    ).rejects.toThrow();
    await expect(
      reader.update.setAccess({ updateId: aIds.updateId, requireNda: false }),
    ).rejects.toThrow();
    expect((await room(aIds.dataRoomId)).allowDownload).toBe(true);
    expect((await upd(aIds.updateId)).requireNda).toBe(true);
  });
});

describe("company ndaText preference", () => {
  const prefs = (extra: object) => ({
    timezone: "UTC",
    viewRetentionMonths: 24 as const,
    ...extra,
  });
  const text = (id: string) =>
    db.company.findUniqueOrThrow({ where: { id } }).then((c) => c.ndaText);

  it("is saved, returned, audited and needs company:update", async () => {
    expect((await callerFor(a).company.preferences()).ndaText).toBeNull();
    const reader = await memberWith([
      { subject: "company", actions: ["read"] },
    ]);
    await expect(
      reader.company.updatePreferences(prefs({ ndaText: "Mine" })),
    ).rejects.toThrow();
    const n = (await audits(a.companyId, "company.updated")).length;
    await callerFor(a).company.updatePreferences(prefs({ ndaText: "Mine" }));
    expect((await callerFor(a).company.preferences()).ndaText).toBe("Mine");
    expect((await audits(a.companyId, "company.updated")).length).toBe(n + 1);
    expect(await text(b.companyId)).toBeNull();
  });

  it("omitting it leaves it alone; an empty string stores null", async () => {
    await callerFor(a).company.updatePreferences(prefs({}));
    expect(await text(a.companyId)).toBe("Mine");
    await callerFor(a).company.updatePreferences(prefs({ ndaText: "" }));
    expect(await text(a.companyId)).toBeNull();
  });

  it("rejects more than 5000 characters and accepts exactly 5000", async () => {
    await expect(
      callerFor(a).company.updatePreferences(
        prefs({ ndaText: "x".repeat(5001) }),
      ),
    ).rejects.toThrow();
    await callerFor(a).company.updatePreferences(
      prefs({ ndaText: "x".repeat(5000) }),
    );
    expect((await text(a.companyId))?.length).toBe(5000);
  });
});
