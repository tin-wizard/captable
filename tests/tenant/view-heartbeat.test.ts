import { POST } from "@/app/api/activity/visit/route";
import { encode } from "@/lib/jwt";
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/activity/visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let recA: string;
let recB: string;
let visitA: string;

const tokenFor = (recipientId: string, companyId = a.companyId) =>
  encode({ companyId, dataRoomId: aIds.dataRoomId, recipientId });

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  recA = (
    await db.dataRoomRecipient.create({
      data: { email: "a@example.com", dataRoomId: aIds.dataRoomId },
    })
  ).id;
  recB = (
    await db.dataRoomRecipient.create({
      data: { email: "b@example.com", dataRoomId: aIds.dataRoomId },
    })
  ).id;
  visitA = (
    await db.viewEvent.create({
      data: {
        companyId: a.companyId,
        kind: "DATA_ROOM",
        targetId: aIds.dataRoomId,
        recipientId: recA,
        ip: "1.2.3.0",
        userAgent: "ua",
      },
    })
  ).id;
});
afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

const stored = () => db.viewEvent.findUniqueOrThrow({ where: { id: visitA } });

describe("POST /api/activity/visit", () => {
  it("stores active and per-page seconds and never lowers them", async () => {
    const token = await tokenFor(recA);
    expect(
      (
        await post({
          kind: "DATA_ROOM",
          token,
          visitId: visitA,
          activeSeconds: 20,
          pageSeconds: { "1": 12, "2": 8 },
        })
      ).status,
    ).toBe(204);
    expect((await stored()).activeSeconds).toBe(20);
    await post({
      kind: "DATA_ROOM",
      token,
      visitId: visitA,
      activeSeconds: 5,
      pageSeconds: { "1": 3, "3": 4 },
    });
    const row = await stored();
    expect(row.activeSeconds).toBe(20);
    expect(row.pageSeconds).toEqual({ "1": 12, "2": 8, "3": 4 });
  });

  it("cannot write another recipient's visit", async () => {
    const token = await tokenFor(recB);
    expect(
      (
        await post({
          kind: "DATA_ROOM",
          token,
          visitId: visitA,
          activeSeconds: 9999,
          pageSeconds: {},
        })
      ).status,
    ).toBe(404);
    expect((await stored()).activeSeconds).toBe(20);
  });

  it("cannot write with another company's token or another kind", async () => {
    expect(
      (
        await post({
          kind: "DATA_ROOM",
          token: await tokenFor(recA, b.companyId),
          visitId: visitA,
          activeSeconds: 99,
          pageSeconds: {},
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post({
          kind: "ESIGN",
          token: await tokenFor(recA),
          visitId: visitA,
          activeSeconds: 99,
          pageSeconds: {},
        })
      ).status,
    ).toBe(404);
  });

  it("a valid token from another company cannot write this company's visit", async () => {
    // resolves fine (tenant B's own recipient), so only the visit match stops it
    const token = await encode({
      companyId: bIds.companyId,
      dataRoomId: bIds.dataRoomId,
      recipientId: bIds.dataRoomRecipientId,
    });
    const res = await post({
      kind: "DATA_ROOM",
      token,
      visitId: visitA,
      activeSeconds: 99,
      pageSeconds: { "9": 99 },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    const row = await stored();
    expect(row.activeSeconds).toBe(20);
    expect(row.pageSeconds).toEqual({ "1": 12, "2": 8, "3": 4 });
  });

  it("an unknown or stale visit id is a 404", async () => {
    const token = await tokenFor(recA);
    expect(
      (
        await post({
          kind: "DATA_ROOM",
          token,
          visitId: "does-not-exist",
          activeSeconds: 1,
          pageSeconds: {},
        })
      ).status,
    ).toBe(404);
  });

  it("clamps to the time the visit could have lasted", async () => {
    const token = await tokenFor(recA);
    await post({
      kind: "DATA_ROOM",
      token,
      visitId: visitA,
      activeSeconds: 86_000,
      pageSeconds: { "1": 3_600 },
    });
    // the visit began seconds ago: grace of 60s over wall-clock, never 86000
    const row = await stored();
    expect(row.activeSeconds).toBeLessThanOrEqual(120);
    expect(
      (row.pageSeconds as Record<string, number>)["1"],
    ).toBeLessThanOrEqual(120);
  });

  it("rejects malformed bodies without a 500", async () => {
    const token = await tokenFor(recA);
    expect(
      (
        await post({
          kind: "DATA_ROOM",
          token,
          visitId: visitA,
          activeSeconds: -1,
          pageSeconds: {},
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          kind: "DATA_ROOM",
          token,
          visitId: visitA,
          activeSeconds: 1,
          pageSeconds: { x: 1 },
        })
      ).status,
    ).toBe(400);
    expect((await post("nope")).status).toBe(400);
  });
});
