import { findUnopened } from "@/server/activity/unopened";
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
 * findUnopened / activity.unopened: recipients who never opened a live link
 * after 3+ days, scoped to one company even on the raw client.
 */

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
const extraUsers: string[] = [];

async function memberWith(permissions: object[] | null) {
  const user = await db.user.create({
    data: {
      name: "unopened member",
      email: `unopened-${nanoid(8)}@example.com`,
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

const old = () => new Date(Date.now() - 4 * 86_400_000);
const mk = (dataRoomId: string, email: string, extra = {}) =>
  db.dataRoomRecipient
    .create({ data: { dataRoomId, email, ...extra } })
    .then(async (r) => {
      await db.$executeRaw`UPDATE "DataRoomRecipient" SET "updatedAt" = ${old()} WHERE id = ${
        r.id
      }`;
      return r;
    });

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
  await cleanupFixtures(aIds, bIds, [a, b]);
});

describe("findUnopened", () => {
  it("lists a recipient who never opened and has waited 3+ days", async () => {
    const r = await mk(aIds.dataRoomId, "never@example.com");
    const items = await findUnopened(db, a.companyId);
    expect(items.map((i) => i.recipientId)).toContain(r.id);
  });

  it("a human view removes them; a bot view does not", async () => {
    const bot = await mk(aIds.dataRoomId, "bot@example.com");
    const human = await mk(aIds.dataRoomId, "human@example.com");
    const ev = (recipientId: string, isBot: boolean) =>
      db.viewEvent.create({
        data: {
          companyId: a.companyId,
          kind: "DATA_ROOM",
          targetId: aIds.dataRoomId,
          recipientId,
          ip: "1.2.3.0",
          userAgent: "ua",
          isBot,
        },
      });
    await ev(bot.id, true);
    await ev(human.id, false);
    const ids = (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
    expect(ids).toContain(bot.id);
    expect(ids).not.toContain(human.id);
  });

  it("excludes recent shares and expired links", async () => {
    const fresh = await db.dataRoomRecipient.create({
      data: { dataRoomId: aIds.dataRoomId, email: "fresh@example.com" },
    });
    const dead = await mk(aIds.dataRoomId, "dead@example.com", {
      expiresAt: new Date(Date.now() - 1000),
    });
    const ids = (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(dead.id);
  });

  it("never returns another company's recipients", async () => {
    const theirs = await mk(bIds.dataRoomId, "theirs@example.com");
    const ids = (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
    expect(ids).not.toContain(theirs.id);
  });

  it("excludes recipients of an update that is not PUBLIC", async () => {
    // the fixture update is PRIVATE
    const ur = await db.updateRecipient.create({
      data: { updateId: aIds.updateId, email: "upd@example.com" },
    });
    await db.$executeRaw`UPDATE "UpdateRecipient" SET "updatedAt" = ${old()} WHERE id = ${
      ur.id
    }`;
    const ids = async () =>
      (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
    expect(await ids()).not.toContain(ur.id);

    await db.update.update({
      where: { id: aIds.updateId },
      data: { status: "PUBLIC", public: true },
    });
    try {
      expect(await ids()).toContain(ur.id);
    } finally {
      await db.update.update({
        where: { id: aIds.updateId },
        data: { status: "PRIVATE", public: false },
      });
    }
  });

  it("nudgeable is false inside the cooldown", async () => {
    const r = await mk(aIds.dataRoomId, "cool@example.com", {
      lastNudgedAt: new Date(),
    });
    const item = (await findUnopened(db, a.companyId)).find(
      (i) => i.recipientId === r.id,
    );
    expect(item?.nudgeable).toBe(false);
  });
});

describe("activity.unopened", () => {
  it("needs audits:read and is tenant scoped", async () => {
    const theirs = await mk(bIds.dataRoomId, "theirs2@example.com");
    const res = await callerFor(a).activity.unopened({});
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((i) => i.recipientId !== undefined)).toBe(true);
    expect(res.items.map((i) => i.recipientId)).not.toContain(theirs.id);

    const noRole = await memberWith(null);
    await expect(noRole.activity.unopened({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns an empty list for another company's targetPublicId", async () => {
    await mk(bIds.dataRoomId, "theirs3@example.com");
    const res = await callerFor(a).activity.unopened({
      kind: "DATA_ROOM",
      targetPublicId: bIds.dataRoomPublicId,
    });
    expect(res.items).toEqual([]);
  });
});
