import { db } from "@/server/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Tenant, callerFor, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

const roomEmit = vi.hoisted(() => vi.fn());
const updateEmit = vi.hoisted(() => vi.fn());
vi.mock("@/jobs/share-data-room-email", () => ({
  shareDataRoomEmailJob: { emit: roomEmit },
}));
vi.mock("@/jobs/share-update-email", () => ({
  shareUpdateEmailJob: { emit: updateEmit },
}));

import { autoNudgeEmailWorker, clock, limits } from "@/jobs/auto-nudge";

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  // only PUBLIC updates are reminded; the fixtures seed PRIVATE ones
  await db.update.updateMany({
    where: { id: { in: [aIds.updateId, bIds.updateId] } },
    data: { status: "PUBLIC", public: true },
  });
});

afterAll(async () => {
  await db.company.updateMany({
    where: { id: { in: [a.companyId, b.companyId] } },
    data: { autoNudge: false },
  });
  await cleanupFixtures(aIds, bIds, [a, b]);
});

// today at hh:mm UTC; the job's clock, while sendReminder uses the real time.
// The fixtures keep days of margin, so the gap (under 24 h) never matters
const at = (hhmm: string) => {
  const d = new Date();
  const [h, m] = hhmm.split(":").map(Number);
  d.setUTCHours(h as number, m as number, 0, 0);
  return d;
};

const run = () => autoNudgeEmailWorker.handler([{ data: {} } as never]);

const kinds = [
  {
    kind: "DATA_ROOM" as const,
    emit: roomEmit,
    table: "DataRoomRecipient",
    parentA: () => aIds.dataRoomId,
    parentB: () => bIds.dataRoomId,
    setSwitch: (id: string, autoNudge: boolean) =>
      db.dataRoom.update({ where: { id }, data: { autoNudge } }),
    create: (parentId: string, email: string, extra = {}) =>
      db.dataRoomRecipient.create({
        data: { dataRoomId: parentId, email, ...extra },
      }),
    get: (id: string) =>
      db.dataRoomRecipient.findUniqueOrThrow({ where: { id } }),
    clear: () =>
      db.dataRoomRecipient.deleteMany({
        where: { dataRoomId: { in: [aIds.dataRoomId, bIds.dataRoomId] } },
      }),
    manual: (recipientId: string) =>
      callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId }),
  },
  {
    kind: "UPDATE" as const,
    emit: updateEmit,
    table: "UpdateRecipient",
    parentA: () => aIds.updateId,
    parentB: () => bIds.updateId,
    setSwitch: (id: string, autoNudge: boolean) =>
      db.update.update({ where: { id }, data: { autoNudge } }),
    create: (parentId: string, email: string, extra = {}) =>
      db.updateRecipient.create({
        data: { updateId: parentId, email, ...extra },
      }),
    get: (id: string) =>
      db.updateRecipient.findUniqueOrThrow({ where: { id } }),
    clear: () =>
      db.updateRecipient.deleteMany({
        where: { updateId: { in: [aIds.updateId, bIds.updateId] } },
      }),
    manual: (recipientId: string) =>
      callerFor(a).update.nudge({ updateId: aIds.updateId, recipientId }),
  },
];

describe.each(kinds.map((k) => [k.kind, k] as const))(
  "auto-nudge job (%s)",
  (_, k) => {
    const mail = (n: string) => `auto-${k.kind}-${n}@example.com`;
    // a recipient whose share is `waited` ms old
    const waiting = async (
      n: string,
      waited = 4 * DAY,
      extra = {},
      parentId = k.parentA(),
    ) => {
      const r = await k.create(parentId, mail(n), extra);
      await setUpdatedAt(r.id, ago(waited));
      return r;
    };
    const setUpdatedAt = (id: string, d: Date) =>
      db.$executeRawUnsafe(
        `UPDATE "${k.table}" SET "updatedAt" = $1 WHERE id = $2`,
        d,
        id,
      );
    // time passes for this recipient: share and last reminder move back
    const age = (id: string, ms: number) =>
      db.$executeRawUnsafe(
        `UPDATE "${k.table}" SET "updatedAt" = "updatedAt" - $1 * interval '1 millisecond', "lastNudgedAt" = "lastNudgedAt" - $1 * interval '1 millisecond' WHERE id = $2`,
        ms,
        id,
      );
    const sentTo = () =>
      k.emit.mock.calls.map((c) => (c[0] as { email: string }).email);

    beforeEach(async () => {
      clock.now = () => at("10:00");
      limits.perRun = 200;
      roomEmit.mockClear();
      updateEmit.mockClear();
      await k.clear();
      await db.company.update({
        where: { id: a.companyId },
        data: { autoNudge: true, timezone: "UTC" },
      });
      await db.company.update({
        where: { id: b.companyId },
        data: { autoNudge: false, timezone: "UTC" },
      });
      await k.setSwitch(k.parentA(), true);
      await k.setSwitch(k.parentB(), true);
    });

    it("company switch off: nothing", async () => {
      await db.company.update({
        where: { id: a.companyId },
        data: { autoNudge: false },
      });
      await waiting("c-off");
      await run();
      expect(sentTo()).toEqual([]);
    });

    it("room/update switch off: nothing", async () => {
      await k.setSwitch(k.parentA(), false);
      await waiting("t-off");
      await run();
      expect(sentTo()).toEqual([]);
    });

    it("sends at most two, 3 then 4 more days apart, never a third", async () => {
      const r = await waiting("steps");
      await run();
      expect(sentTo()).toEqual([mail("steps")]);
      expect(k.emit.mock.calls[0]?.[0]).toMatchObject({ reminder: true });
      expect((await k.get(r.id)).nudgeCount).toBe(1);

      // the same hour again
      await run();
      expect(sentTo()).toHaveLength(1);

      // 3 days later the second step is not due yet
      await age(r.id, 3 * DAY);
      await run();
      expect(sentTo()).toHaveLength(1);

      // 5 days after the first
      await age(r.id, 2 * DAY);
      await run();
      expect(sentTo()).toHaveLength(2);
      expect((await k.get(r.id)).nudgeCount).toBe(2);

      await age(r.id, 10 * DAY);
      await run();
      expect(sentTo()).toHaveLength(2);
      expect((await k.get(r.id)).nudgeCount).toBe(2);
    });

    it("two overlapping runs send one email", async () => {
      const r = await waiting("overlap");
      await Promise.all([run(), run()]);
      expect(sentTo()).toEqual([mail("overlap")]);
      expect((await k.get(r.id)).nudgeCount).toBe(1);
    });

    it("writes an audit row with the company as actor", async () => {
      await waiting("audit");
      await run();
      expect(sentTo()).toEqual([mail("audit")]);
      const audit = await db.audit.findFirst({
        where: {
          companyId: a.companyId,
          action: k.kind === "DATA_ROOM" ? "dataroom.nudged" : "update.nudged",
          summary: { contains: mail("audit") },
        },
      });
      expect(audit?.actor).toMatchObject({ type: "company", id: a.companyId });
    });

    it("skips opened, opted-out, expired and expiring-within-24h recipients", async () => {
      const opened = await waiting("opened");
      await db.viewEvent.create({
        data: {
          companyId: a.companyId,
          kind: k.kind,
          targetId: k.parentA(),
          recipientId: opened.id,
          ip: "1.2.3.0",
          userAgent: "ua",
        },
      });
      await waiting("opted-out", 4 * DAY, { nudgeOptOut: true });
      await waiting("expired", 4 * DAY, { expiresAt: ago(1000) });
      await waiting("expiring", 4 * DAY, {
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      });
      await waiting("capped", 10 * DAY, { nudgeCount: 2 });
      await run();
      expect(sentTo()).toEqual([]);
    });

    it("sends nothing outside working hours", async () => {
      clock.now = () => at("20:00");
      await waiting("night");
      await run();
      expect(sentTo()).toEqual([]);
      clock.now = () => at("08:59");
      await run();
      expect(sentTo()).toEqual([]);
    });

    it("never emails another company's recipient", async () => {
      await waiting("mine");
      // company B is off, but its room/update is on and has someone waiting
      await waiting("theirs", 4 * DAY, {}, k.parentB());
      await run();
      expect(sentTo()).toEqual([mail("mine")]);
    });

    it("a manual reminder counts: no automatic one the same day, the next waits 4 days", async () => {
      const r = await waiting("manual", 3 * DAY + 3600 * 1000);
      await k.manual(r.id);
      expect(sentTo()).toHaveLength(1);
      expect((await k.get(r.id)).nudgeCount).toBe(1);

      await run();
      expect(sentTo()).toHaveLength(1);

      await age(r.id, 3 * DAY);
      await run();
      expect(sentTo()).toHaveLength(1);

      await age(r.id, 2 * DAY);
      await run();
      expect(sentTo()).toHaveLength(2);
      expect((await k.get(r.id)).nudgeCount).toBe(2);
    });

    it("stops at the per-company cap for one run", async () => {
      limits.perRun = 2;
      await waiting("cap1");
      await waiting("cap2");
      await waiting("cap3");
      await run();
      expect(sentTo()).toHaveLength(2);
    });
  },
);
