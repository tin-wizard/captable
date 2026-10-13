import { generatePublicId } from "@/common/id";
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
const mk = (dataRoomId: string, email: string, extra = {}, at = old()) =>
  db.dataRoomRecipient
    .create({ data: { dataRoomId, email, ...extra } })
    .then(async (r) => {
      await db.$executeRaw`UPDATE "DataRoomRecipient" SET "updatedAt" = ${at} WHERE id = ${r.id}`;
      return r;
    });
const mkUpd = (updateId: string, email: string, extra = {}) =>
  db.updateRecipient
    .create({ data: { updateId, email, ...extra } })
    .then(async (r) => {
      await db.$executeRaw`UPDATE "UpdateRecipient" SET "updatedAt" = ${old()} WHERE id = ${
        r.id
      }`;
      return r;
    });
// a fresh room isolates a test from recipients the other tests add
const room = () =>
  db.dataRoom.create({
    data: {
      companyId: a.companyId,
      name: `room ${nanoid(4)}`,
      publicId: generatePublicId(),
    },
  });
const humanView = (recipientId: string, targetId: string) =>
  db.viewEvent.create({
    data: {
      companyId: a.companyId,
      kind: "DATA_ROOM",
      targetId,
      recipientId,
      ip: "1.2.3.0",
      userAgent: "ua",
      isBot: false,
    },
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

  it("a pre-Phase-3 row (null expiresAt) lives only as long as its 30-day token", async () => {
    const day = 86_400_000;
    const dead = await mk(
      aIds.dataRoomId,
      "legacy40@example.com",
      {},
      new Date(Date.now() - 40 * day),
    );
    const alive = await mk(
      aIds.dataRoomId,
      "legacy10@example.com",
      {},
      new Date(Date.now() - 10 * day),
    );
    const ids = (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
    expect(ids).not.toContain(dead.id);
    expect(ids).toContain(alive.id);
    // the expiry branch must not clobber the newerThan window
    const recent = (
      await findUnopened(db, a.companyId, {
        newerThan: new Date(Date.now() - 5 * day),
      })
    ).map((i) => i.recipientId);
    expect(recent).not.toContain(alive.id);
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

  it("carries nudgeCount and nudgeOptOut", async () => {
    const r = await mk(aIds.dataRoomId, "count@example.com", {
      nudgeCount: 1,
      nudgeOptOut: true,
    });
    const item = (await findUnopened(db, a.companyId)).find(
      (i) => i.recipientId === r.id,
    );
    expect(item).toMatchObject({ nudgeCount: 1, nudgeOptOut: true });
  });

  it("nudgeable flips at exactly 24 h", async () => {
    const r1 = await room();
    const nudged = new Date();
    const r = await mk(r1.id, "edge@example.com", { lastNudgedAt: nudged });
    const at = async (ms: number) =>
      (
        await findUnopened(db, a.companyId, {
          targetId: r1.id,
          now: new Date(nudged.getTime() + ms),
        })
      ).find((i) => i.recipientId === r.id)?.nudgeable;
    expect(await at(24 * 3600 * 1000)).toBe(true);
    expect(await at(24 * 3600 * 1000 - 1)).toBe(false);
  });

  it("nudgeable is false when the link dies within 24 h", async () => {
    const r1 = await room();
    const h = 3600 * 1000;
    const soon = await mk(r1.id, "soon@example.com", {
      expiresAt: new Date(Date.now() + 23 * h),
    });
    const later = await mk(r1.id, "later@example.com", {
      expiresAt: new Date(Date.now() + 25 * h),
    });
    const items = await findUnopened(db, a.companyId, { targetId: r1.id });
    const ok = (id: string) =>
      items.find((i) => i.recipientId === id)?.nudgeable;
    expect(ok(soon.id)).toBe(false);
    expect(ok(later.id)).toBe(true);
  });

  it("stops after maxPages of candidates", async () => {
    const r1 = await room();
    const t = Date.now() - 6 * 86_400_000;
    for (const n of [0, 1, 2]) {
      const o = await mk(r1.id, `page${n}@example.com`, {}, new Date(t + n));
      await humanView(o.id, r1.id);
    }
    const u = await mk(r1.id, "beyond@example.com");
    const opts = { targetId: r1.id, batch: 1, cap: 10 };
    expect(
      await findUnopened(db, a.companyId, { ...opts, maxPages: 2 }),
    ).toEqual([]);
    expect(
      (await findUnopened(db, a.companyId, opts)).map((i) => i.recipientId),
    ).toEqual([u.id]);
  });

  it("caps after the opened filter: opened rows don't crowd out unopened ones", async () => {
    const r1 = await room();
    const t = Date.now() - 6 * 86_400_000;
    for (const n of [0, 1, 2]) {
      const o = await mk(r1.id, `opened${n}@example.com`, {}, new Date(t + n));
      await humanView(o.id, r1.id);
    }
    // the three opened rows are the oldest: capping before the opened filter
    // would keep only opened rows and return []
    const u = await mk(r1.id, "late@example.com");
    const items = await findUnopened(db, a.companyId, {
      targetId: r1.id,
      cap: 2,
    });
    expect(items.map((i) => i.recipientId)).toEqual([u.id]);
  });

  it("newerThan bounds the window before the cap", async () => {
    const r1 = await room();
    const day = 86_400_000;
    const oldOne = await mk(
      r1.id,
      "ten@example.com",
      {},
      new Date(Date.now() - 10 * day),
    );
    const fresh = await mk(
      r1.id,
      "crossing@example.com",
      {},
      new Date(Date.now() - 3.5 * day),
    );
    const opts = { targetId: r1.id, cap: 1 };
    const plain = await findUnopened(db, a.companyId, opts);
    expect(plain.map((i) => i.recipientId)).toEqual([oldOne.id]);
    const bounded = await findUnopened(db, a.companyId, {
      ...opts,
      newerThan: new Date(Date.now() - 4 * day),
    });
    expect(bounded.map((i) => i.recipientId)).toEqual([fresh.id]);
  });

  it("pages through identical updatedAt values without skipping or repeating", async () => {
    const r1 = await room();
    const at = new Date(Date.now() - 5 * 86_400_000);
    const made = [];
    for (const n of [0, 1, 2])
      made.push(await mk(r1.id, `tie${n}@example.com`, {}, at));
    const items = await findUnopened(db, a.companyId, {
      targetId: r1.id,
      batch: 2,
    });
    expect(items.map((i) => i.recipientId).sort()).toEqual(
      made.map((r) => r.id).sort(),
    );
  });

  it("filters by targetId and by kind; expiry applies to UPDATE recipients", async () => {
    const r1 = await room();
    const r2 = await room();
    const inR1 = await mk(r1.id, "r1@example.com");
    const inR2 = await mk(r2.id, "r2@example.com");
    const upd = await db.update.create({
      data: {
        companyId: a.companyId,
        authorId: a.memberId,
        publicId: generatePublicId(),
        title: "public update",
        content: { text: "x" },
        html: "<p>x</p>",
        status: "PUBLIC",
        public: true,
      },
    });
    const liveUr = await mkUpd(upd.id, "live-ur@example.com");
    const deadUr = await mkUpd(upd.id, "dead-ur@example.com", {
      expiresAt: new Date(Date.now() - 1000),
    });

    const byTarget = await findUnopened(db, a.companyId, { targetId: r1.id });
    expect(byTarget.map((i) => i.recipientId)).toEqual([inR1.id]);

    const rooms = await findUnopened(db, a.companyId, { kind: "DATA_ROOM" });
    expect(rooms.every((i) => i.kind === "DATA_ROOM")).toBe(true);
    expect(rooms.map((i) => i.recipientId)).toContain(inR2.id);
    expect(rooms.map((i) => i.recipientId)).not.toContain(liveUr.id);

    const updates = await findUnopened(db, a.companyId, { kind: "UPDATE" });
    expect(updates.every((i) => i.kind === "UPDATE")).toBe(true);
    const updIds = updates.map((i) => i.recipientId);
    expect(updIds).toContain(liveUr.id);
    expect(updIds).not.toContain(deadUr.id);
    expect(updIds).not.toContain(inR1.id);
  });
});

describe("activity.unopened", () => {
  it("needs audits:read and is tenant scoped", async () => {
    const theirs = await mk(bIds.dataRoomId, "theirs2@example.com");
    const res = await callerFor(a).activity.unopened({});
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((i) => i.recipientId !== undefined)).toBe(true);
    expect(res.items.map((i) => i.recipientId)).not.toContain(theirs.id);

    // a custom role that grants something else, but not audits:read
    const noAudits = await memberWith([
      { subject: "securities", actions: ["read"] },
    ]);
    await expect(noAudits.activity.unopened({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects targetPublicId without kind", async () => {
    await expect(
      callerFor(a).activity.unopened({
        targetPublicId: bIds.dataRoomPublicId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
