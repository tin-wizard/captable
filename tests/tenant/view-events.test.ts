import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant-db";
import { recordView } from "@/server/view-events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});

afterAll(async () => {
  await cleanupTenants(a, b);
});

describe("ViewEvent is a tenant model", () => {
  it("tenant A never sees tenant B's events", async () => {
    const mine = await db.viewEvent.create({
      data: {
        companyId: a.companyId,
        kind: "ESIGN",
        targetId: "t",
        recipientId: "r",
        ip: "1.2.3.0",
        userAgent: "ua",
      },
    });
    const theirs = await db.viewEvent.create({
      data: {
        companyId: b.companyId,
        kind: "ESIGN",
        targetId: "t",
        recipientId: "r",
        ip: "1.2.3.0",
        userAgent: "ua",
      },
    });

    const seen = await tenantDb(db, a.companyId).viewEvent.findMany();

    expect(seen.map((e) => e.id)).toContain(mine.id);
    expect(seen.map((e) => e.id)).not.toContain(theirs.id);
  });

  it("a member's alert switch defaults to on", async () => {
    const member = await db.member.findUniqueOrThrow({
      where: { id: a.memberId },
    });
    expect(member.notifyOnView).toBe(true);
  });
});

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const view = (over: Partial<Parameters<typeof recordView>[1]> = {}) => ({
  companyId: a.companyId,
  kind: "DATA_ROOM" as const,
  targetId: "room-1",
  recipientId: `rec-${Math.random().toString(36).slice(2)}`,
  ip: "203.0.113.9",
  userAgent: UA,
  ...over,
});

describe("recordView", () => {
  it("first, then repeat inside 30 minutes, then return after", async () => {
    const v = view();
    expect((await recordView(db, v)).visit).toBe("first");
    expect((await recordView(db, v)).visit).toBe("repeat");
    await db.viewEvent.updateMany({
      where: { recipientId: v.recipientId },
      data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    expect((await recordView(db, v)).visit).toBe("return");
  });

  it("stores a bot without letting it count or reset the clock", async () => {
    const v = view({ userAgent: "Slackbot-LinkExpanding 1.0" });
    expect((await recordView(db, v)).visit).toBe("bot");
    expect((await recordView(db, { ...v, userAgent: UA })).visit).toBe("first");
    const rows = await db.viewEvent.findMany({
      where: { recipientId: v.recipientId },
    });
    expect(rows.map((r) => r.isBot).sort()).toEqual([false, true]);
  });

  it("stores only a truncated ip", async () => {
    const v = view();
    await recordView(db, v);
    const row = await db.viewEvent.findFirstOrThrow({
      where: { recipientId: v.recipientId },
    });
    expect(row.ip).toBe("203.0.113.0");
  });

  it("a burst inside 10 seconds stores one row", async () => {
    const v = view();
    expect([
      (await recordView(db, v)).visit,
      (await recordView(db, v)).visit,
    ]).toEqual(["first", "repeat"]);
    expect(
      await db.viewEvent.count({ where: { recipientId: v.recipientId } }),
    ).toBe(1);
  });

  it("a bot burst stores one bot row and does not block the human clock", async () => {
    const v = view({ userAgent: "Slackbot-LinkExpanding 1.0" });
    for (let i = 0; i < 3; i++) await recordView(db, v);
    expect(
      await db.viewEvent.count({
        where: { recipientId: v.recipientId, isBot: true },
      }),
    ).toBe(1);
    expect((await recordView(db, { ...v, userAgent: UA })).visit).toBe("first");
  });

  it("after 10 seconds a second human view is stored again", async () => {
    const v = view();
    await recordView(db, v);
    await db.viewEvent.updateMany({
      where: { recipientId: v.recipientId },
      data: { createdAt: new Date(Date.now() - 11 * 1000) },
    });
    expect((await recordView(db, v)).visit).toBe("repeat");
    expect(
      await db.viewEvent.count({
        where: { recipientId: v.recipientId, isBot: false },
      }),
    ).toBe(2);
  });

  it("returns the id of the row it stored, or of the row that throttled it", async () => {
    const v = view();
    const first = await recordView(db, v);
    const again = await recordView(db, v);
    expect(first.visit).toBe("first");
    expect(again).toEqual({ visit: "repeat", id: first.id });
  });
});

describe("phase 2 columns", () => {
  it("a new visit has no location and zero active time", async () => {
    const row = await db.viewEvent.create({
      data: {
        companyId: a.companyId,
        kind: "ESIGN",
        targetId: "t",
        recipientId: "r2",
        ip: "1.2.3.0",
        userAgent: "ua",
      },
    });
    expect(row.country).toBeNull();
    expect(row.timezone).toBeNull();
    expect(row.activeSeconds).toBe(0);
    expect(row.pageSeconds).toBeNull();
  });

  it("stores page seconds as json", async () => {
    const row = await db.viewEvent.create({
      data: {
        companyId: a.companyId,
        kind: "DATA_ROOM",
        targetId: "t",
        recipientId: "r3",
        ip: "1.2.3.0",
        userAgent: "ua",
        country: "CA",
        network: "Example Net",
        asn: "AS64500",
        timezone: "America/Toronto",
        activeSeconds: 42,
        pageSeconds: { "1": 12, "2": 30 },
      },
    });
    expect(row.pageSeconds).toEqual({ "1": 12, "2": 30 });
    expect(row.country).toBe("CA");
  });

  it("a data room records no creator by default", async () => {
    const room = await db.dataRoom.create({
      data: {
        name: `r-${Date.now()}`,
        publicId: `p${Date.now()}`,
        companyId: a.companyId,
      },
    });
    expect(room.createdById).toBeNull();
    await db.dataRoom.delete({ where: { id: room.id } });
  });
});
