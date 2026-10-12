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
    expect(await recordView(db, v)).toBe("first");
    expect(await recordView(db, v)).toBe("repeat");
    await db.viewEvent.updateMany({
      where: { recipientId: v.recipientId },
      data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    expect(await recordView(db, v)).toBe("return");
  });

  it("stores a bot without letting it count or reset the clock", async () => {
    const v = view({ userAgent: "Slackbot-LinkExpanding 1.0" });
    expect(await recordView(db, v)).toBe("bot");
    expect(await recordView(db, { ...v, userAgent: UA })).toBe("first");
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
});
