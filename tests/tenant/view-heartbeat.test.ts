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
let bucket2: string;
let strayBucket: string;

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
  // two documents in tenant A's room, one A document outside it
  await db.dataRoomDocument.create({
    data: { dataRoomId: aIds.dataRoomId, documentId: aIds.documentId },
  });
  const doc = async (name: string) => {
    const bucket = await db.bucket.create({
      data: {
        companyId: a.companyId,
        name,
        key: `${name}/${Date.now()}.pdf`,
        mimeType: "application/pdf",
        size: 1,
        tags: [],
      },
    });
    const document = await db.document.create({
      data: {
        companyId: a.companyId,
        publicId: `${name}-${Date.now()}`,
        name,
        bucketId: bucket.id,
      },
    });
    return { bucketId: bucket.id, documentId: document.id };
  };
  const second = await doc("hb-second");
  bucket2 = second.bucketId;
  await db.dataRoomDocument.create({
    data: { dataRoomId: aIds.dataRoomId, documentId: second.documentId },
  });
  strayBucket = (await doc("hb-stray")).bucketId;
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

  it("an expired link cannot extend its visit", async () => {
    const rec = await db.dataRoomRecipient.create({
      data: { email: "exp@example.com", dataRoomId: aIds.dataRoomId },
    });
    const visit = await db.viewEvent.create({
      data: {
        companyId: a.companyId,
        kind: "DATA_ROOM",
        targetId: aIds.dataRoomId,
        recipientId: rec.id,
        ip: "1.2.3.0",
        userAgent: "ua",
      },
    });
    const token = await tokenFor(rec.id);
    const beat = (activeSeconds: number) =>
      post({
        kind: "DATA_ROOM",
        token,
        visitId: visit.id,
        activeSeconds,
        pageSeconds: {},
      });
    expect((await beat(5)).status).toBe(204);
    await db.dataRoomRecipient.update({
      where: { id: rec.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await beat(30);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    const row = await db.viewEvent.findUniqueOrThrow({
      where: { id: visit.id },
    });
    expect(row.activeSeconds).toBe(5);
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
  describe("per-document seconds (docs)", () => {
    const freshVisit = async (
      kind: "DATA_ROOM" | "UPDATE" = "DATA_ROOM",
      targetId = aIds.dataRoomId,
      recipientId = recA,
    ) =>
      (
        await db.viewEvent.create({
          data: {
            companyId: a.companyId,
            kind,
            targetId,
            recipientId,
            ip: "1.2.3.0",
            userAgent: "ua",
          },
        })
      ).id;
    const docsOf = async (id: string) =>
      (await db.viewEvent.findUniqueOrThrow({ where: { id } })).docSeconds;

    it("stores pages per document; the same page number in two documents does not collide", async () => {
      const visitId = await freshVisit();
      const res = await post({
        kind: "DATA_ROOM",
        token: await tokenFor(recA),
        visitId,
        activeSeconds: 10,
        pageSeconds: { "3": 7 },
        docs: [
          { bucketId: aIds.bucketId, n: 4, p: { "3": 7 } },
          { bucketId: bucket2, n: 9, p: { "3": 2 } },
        ],
      });
      expect(res.status).toBe(204);
      expect(await docsOf(visitId)).toEqual({
        [aIds.bucketId]: { n: 4, p: { "3": 7 } },
        [bucket2]: { n: 9, p: { "3": 2 } },
      });
    });

    it("never lowers a stored value", async () => {
      const visitId = await freshVisit();
      const token = await tokenFor(recA);
      const beat = (p: Record<string, number>) =>
        post({
          kind: "DATA_ROOM",
          token,
          visitId,
          activeSeconds: 10,
          pageSeconds: p,
          docs: [{ bucketId: aIds.bucketId, n: 4, p }],
        });
      await beat({ "1": 9, "2": 5 });
      await beat({ "1": 2, "4": 3 });
      expect(await docsOf(visitId)).toEqual({
        [aIds.bucketId]: { n: 4, p: { "1": 9, "2": 5, "4": 3 } },
      });
    });

    it("silently drops a document of another room or another company", async () => {
      const visitId = await freshVisit();
      const res = await post({
        kind: "DATA_ROOM",
        token: await tokenFor(recA),
        visitId,
        activeSeconds: 10,
        pageSeconds: { "1": 4 },
        docs: [
          { bucketId: strayBucket, n: 2, p: { "1": 4 } },
          { bucketId: bIds.bucketId, n: 2, p: { "1": 4 } },
          { bucketId: aIds.bucketId, n: 2, p: { "1": 4 } },
        ],
      });
      expect(res.status).toBe(204);
      expect(await docsOf(visitId)).toEqual({
        [aIds.bucketId]: { n: 2, p: { "1": 4 } },
      });
      // only foreign documents: nothing is written, the column stays null
      const other = await freshVisit();
      await post({
        kind: "DATA_ROOM",
        token: await tokenFor(recA),
        visitId: other,
        activeSeconds: 10,
        pageSeconds: { "1": 4 },
        docs: [{ bucketId: bIds.bucketId, n: 2, p: { "1": 4 } }],
      });
      expect(await docsOf(other)).toBeNull();
    });

    it("ignores docs on an update visit", async () => {
      await db.update.update({
        where: { id: aIds.updateId },
        data: { status: "PUBLIC", public: true },
      });
      const rec = await db.updateRecipient.create({
        data: { email: "hb-upd@example.com", updateId: aIds.updateId },
      });
      const visitId = await freshVisit("UPDATE", aIds.updateId, rec.id);
      const update = await db.update.findUniqueOrThrow({
        where: { id: aIds.updateId },
      });
      const token = await encode({
        companyId: a.companyId,
        publicId: update.publicId,
        recipientId: rec.id,
      });
      const res = await post({
        kind: "UPDATE",
        token,
        visitId,
        activeSeconds: 5,
        pageSeconds: {},
        docs: [{ bucketId: aIds.bucketId, n: 2, p: { "1": 4 } }],
      });
      expect(res.status).toBe(204);
      const row = await db.viewEvent.findUniqueOrThrow({
        where: { id: visitId },
      });
      expect(row.activeSeconds).toBe(5);
      expect(row.docSeconds).toBeNull();
    });

    it("an old client without docs leaves docSeconds null", async () => {
      const visitId = await freshVisit();
      await post({
        kind: "DATA_ROOM",
        token: await tokenFor(recA),
        visitId,
        activeSeconds: 3,
        pageSeconds: { "1": 3 },
      });
      const row = await db.viewEvent.findUniqueOrThrow({
        where: { id: visitId },
      });
      expect(row.pageSeconds).toEqual({ "1": 3 });
      expect(row.docSeconds).toBeNull();
    });

    it("rejects oversize or malformed docs with a 400", async () => {
      const token = await tokenFor(recA);
      const base = {
        kind: "DATA_ROOM",
        token,
        visitId: visitA,
        activeSeconds: 1,
        pageSeconds: {},
      };
      const one = { bucketId: aIds.bucketId, n: 2, p: { "1": 1 } };
      const bad = [
        Array.from({ length: 21 }, () => one),
        [{ ...one, n: 0 }],
        [{ ...one, n: 5001 }],
        [{ ...one, p: { x: 1 } }],
        [{ ...one, p: { "1": 3601 } }],
        [{ ...one, bucketId: "x".repeat(65) }],
        [
          {
            ...one,
            p: Object.fromEntries(
              Array.from({ length: 501 }, (_, i) => [String(i + 1), 1]),
            ),
          },
        ],
      ];
      for (const docs of bad) {
        expect((await post({ ...base, docs })).status).toBe(400);
      }
    });
  });
});
