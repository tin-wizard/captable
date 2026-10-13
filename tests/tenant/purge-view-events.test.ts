import {
  DEFAULT_RETENTION_MONTHS,
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
  it("is exactly N calendar months before now", () => {
    expect(DEFAULT_RETENTION_MONTHS).toBe(24);
    const now = new Date("2026-10-12T03:17:00Z");
    expect(retentionCutoff(now, 24).toISOString()).toBe(
      "2024-10-12T03:17:00.000Z",
    );
    expect(retentionCutoff(now, 6).toISOString()).toBe(
      "2026-04-12T03:17:00.000Z",
    );
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

describe("per-company retention", () => {
  it("purges each company at its own period and keeps 'keep forever'", async () => {
    await db.company.update({
      where: { id: a.companyId },
      data: { viewRetentionMonths: 12 },
    });
    await db.company.update({
      where: { id: b.companyId },
      data: { viewRetentionMonths: null },
    });
    const a13 = await mk(a.companyId, months(13), "a13");
    const a11 = await mk(a.companyId, months(11), "a11");
    const b30 = await mk(b.companyId, months(30), "b30");

    await purgeViewEventsWorker.handler([{ data: {} } as never]);

    expect(await db.viewEvent.findUnique({ where: { id: a13.id } })).toBeNull();
    expect(
      await db.viewEvent.findUnique({ where: { id: a11.id } }),
    ).not.toBeNull();
    expect(
      await db.viewEvent.findUnique({ where: { id: b30.id } }),
    ).not.toBeNull();
  });
});
