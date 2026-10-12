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

/**
 * activity.list: a tenant sees only its own view events, and share counts only
 * when its role may read securities. Stakeholders never attach across tenants.
 */

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
const extraUsers: string[] = [];
let holderId: string;
let roomVisit: string;
let signVisit: string;
let bVisit: string;
let updatePublicId: string;
const updateVisits: string[] = [];

const event = (
  t: Tenant,
  data: {
    kind: "DATA_ROOM" | "UPDATE" | "ESIGN";
    targetId: string;
    recipientId: string;
    createdAt?: Date;
    country?: string;
    activeSeconds?: number;
  },
) =>
  db.viewEvent
    .create({
      data: { companyId: t.companyId, ip: "1.2.3.0", userAgent: "ua", ...data },
    })
    .then((e) => e.id);

async function memberWith(permissions: object[] | null) {
  const user = await db.user.create({
    data: {
      name: "activity member",
      email: `activity-${nanoid(8)}@example.com`,
      emailVerified: new Date(),
    },
  });
  extraUsers.push(user.id);
  const role = permissions
    ? await db.customRole.create({
        data: { companyId: a.companyId, name: nanoid(6), permissions },
      })
    : null;
  const member = await db.member.create({
    data: {
      userId: user.id,
      companyId: a.companyId,
      role: role ? "CUSTOM" : null,
      customRoleId: role?.id,
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

const share = (
  stakeholderId: string,
  quantity: number,
  status: "ACTIVE" | "DRAFT",
) =>
  db.share.create({
    data: {
      companyId: a.companyId,
      stakeholderId,
      shareClassId: aIds.shareClassId,
      certificateId: nanoid(6),
      quantity,
      status,
      issueDate: new Date(),
      boardApprovalDate: new Date(),
    },
  });

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);

  const holder = await db.stakeholder.create({
    data: {
      companyId: a.companyId,
      name: "Ada Holder",
      email: `ada-${nanoid(6)}@example.com`,
    },
  });
  holderId = holder.id;
  await share(holderId, 100, "ACTIVE");
  await share(holderId, 7, "DRAFT");

  const roomRecipient = await db.dataRoomRecipient.create({
    data: {
      dataRoomId: aIds.dataRoomId,
      name: "Ada Viewer",
      email: holder.email,
      stakeholderId: holderId,
    },
  });
  roomVisit = await event(a, {
    kind: "DATA_ROOM",
    targetId: aIds.dataRoomId,
    recipientId: roomRecipient.id,
    country: "NL",
    activeSeconds: 42,
  });

  // B holds a stakeholder with the exact email of A's e-sign recipient
  const signer = await db.esignRecipient.findUniqueOrThrow({
    where: { id: aIds.recipientId },
  });
  await db.stakeholder.create({
    data: { companyId: b.companyId, name: "B twin", email: signer.email },
  });
  signVisit = await event(a, {
    kind: "ESIGN",
    targetId: aIds.templateId,
    recipientId: signer.id,
  });

  bVisit = await event(b, {
    kind: "DATA_ROOM",
    targetId: bIds.dataRoomId,
    recipientId: bIds.dataRoomRecipientId,
  });

  const update = await db.update.findUniqueOrThrow({
    where: { id: aIds.updateId },
  });
  updatePublicId = update.publicId;
  const ur = await db.updateRecipient.create({
    data: { updateId: update.id, email: `ur-${nanoid(6)}@example.com` },
  });
  // two share a timestamp: the id tiebreak must keep the order stable
  const t0 = new Date("2026-01-01T00:00:00Z");
  for (const createdAt of [t0, t0, new Date("2026-01-02T00:00:00Z")]) {
    updateVisits.push(
      await event(a, {
        kind: "UPDATE",
        targetId: update.id,
        recipientId: ur.id,
        createdAt,
      }),
    );
  }
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
  await cleanupFixtures(aIds, bIds, [a, b]);
});

describe("activity.list", () => {
  it("lists the tenant's events with viewer, location and active time", async () => {
    const { items } = await callerFor(a).activity.list({ limit: 50 });
    const room = items.find((i) => i.id === roomVisit);
    expect(room).toMatchObject({
      kind: "DATA_ROOM",
      viewer: {
        label: "Ada Viewer",
        stakeholder: { id: holderId, name: "Ada Holder" },
      },
      country: "NL",
      activeSeconds: 42,
    });
  });

  it("never returns another tenant's events", async () => {
    const { items } = await callerFor(a).activity.list({ limit: 50 });
    expect(items.map((i) => i.id)).not.toContain(bVisit);
    expect(items.length).toBe(5);
    const bItems = (await callerFor(b).activity.list({ limit: 50 })).items;
    expect(bItems.map((i) => i.id)).toEqual([bVisit]);
  });

  it("returns share counts only to roles that may read securities, ACTIVE only", async () => {
    const admin = await callerFor(a).activity.list({ limit: 50 });
    expect(admin.canSeeHoldings).toBe(true);
    expect(
      admin.items.find((i) => i.id === roomVisit)?.viewer.stakeholder?.shares,
    ).toBe(100);

    const auditor = await memberWith([
      { subject: "audits", actions: ["read"] },
    ]);
    const res = await auditor.activity.list({ limit: 50 });
    expect(res.canSeeHoldings).toBe(false);
    const st = res.items.find((i) => i.id === roomVisit)?.viewer.stakeholder;
    expect(st).toMatchObject({ id: holderId, shares: null });
  });

  it("never attaches another tenant's stakeholder by a matching email", async () => {
    const { items } = await callerFor(a).activity.list({ kind: "ESIGN" });
    const sign = items.find((i) => i.id === signVisit);
    expect(sign?.viewer.email).toBeTruthy();
    expect(sign?.viewer.stakeholder).toBeNull();
  });

  it("paginates stably with an id cursor", async () => {
    const caller = callerFor(a);
    const input = { kind: "UPDATE" as const, targetPublicId: updatePublicId };
    const first = await caller.activity.list({ ...input, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await caller.activity.list({
      ...input,
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.sort()).toEqual([...updateVisits].sort());
    expect(first.items[0]?.id).toBe(updateVisits[2]);
  });

  it("ignores a cursor that belongs to another tenant", async () => {
    const res = await callerFor(a).activity.list({ cursor: bVisit });
    expect(res.items).toEqual([]);
  });

  it("refuses a member without a role", async () => {
    const noRole = await memberWith(null);
    await expect(noRole.activity.list({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
