import {
  RETENTION_MONTHS,
  purgeViewEventsWorker,
  retentionCutoff,
} from "@/jobs/purge-view-events";
import { db } from "@/server/db";
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

const months = (n: number) => new Date(Date.now() - n * 31 * 24 * 3600 * 1000);
const mk = (companyId: string, createdAt: Date, recipientId: string) =>
  db.viewEvent.create({
    data: {
      companyId,
      kind: "ESIGN",
      targetId: "t",
      recipientId,
      ip: "1.2.3.0",
      userAgent: "ua",
      createdAt,
    },
  });

describe("retention cutoff", () => {
  it("is exactly 24 calendar months before now", () => {
    expect(RETENTION_MONTHS).toBe(24);
    expect(
      retentionCutoff(new Date("2026-10-12T03:17:00Z")).toISOString(),
    ).toBe("2024-10-12T03:17:00.000Z");
  });
});

describe("purge view events", () => {
  it("removes only rows older than 24 months, across companies, and nothing else", async () => {
    const oldA = await mk(a.companyId, months(25), "old-a");
    const oldB = await mk(b.companyId, months(30), "old-b");
    const newA = await mk(a.companyId, months(23), "new-a");
    const members = await db.member.count();

    await purgeViewEventsWorker.handler([{ data: {} } as never]);

    expect(
      await db.viewEvent.findUnique({ where: { id: oldA.id } }),
    ).toBeNull();
    expect(
      await db.viewEvent.findUnique({ where: { id: oldB.id } }),
    ).toBeNull();
    expect(
      await db.viewEvent.findUnique({ where: { id: newA.id } }),
    ).not.toBeNull();
    expect(await db.member.count()).toBe(members);
  });
});
