import { POST } from "@/app/api/activity/nda/route";
import { encode } from "@/lib/jwt";
import { DEFAULT_NDA_TEXT, getNdaState } from "@/server/activity/nda";
import { db } from "@/server/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Tenant, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

const DAY = 86_400_000;
let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let updatePublicId: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  const u = await db.update.update({
    where: { id: aIds.updateId },
    data: { status: "PUBLIC", public: true, requireNda: true },
  });
  updatePublicId = u.publicId;
  await db.dataRoom.updateMany({
    where: { id: { in: [aIds.dataRoomId, bIds.dataRoomId] } },
    data: { requireNda: true },
  });
});
afterAll(async () => {
  await db.ndaAcceptance.deleteMany({
    where: { companyId: { in: [a.companyId, b.companyId] } },
  });
  await cleanupFixtures(aIds, bIds, [a, b]);
});
beforeEach(async () => {
  await db.company.update({
    where: { id: a.companyId },
    data: { ndaText: null },
  });
});

const post = (body: unknown, ip = "203.0.113.77") =>
  POST(
    new Request("http://localhost/api/activity/nda", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": ip,
        "user-agent": "Mozilla/5.0 test",
      },
      body: JSON.stringify(body),
    }),
  );

const room = async (email: string, extra: object = {}) => {
  const r = await db.dataRoomRecipient.create({
    data: { dataRoomId: aIds.dataRoomId, email, ...extra },
  });
  const token = await encode({
    companyId: a.companyId,
    dataRoomId: aIds.dataRoomId,
    recipientId: r.id,
  });
  return { r, token };
};

const rowsFor = (recipientId: string) =>
  db.ndaAcceptance.findMany({ where: { recipientId } });

describe("NDA accept route", () => {
  it("records exactly one acceptance with the company's current text and a truncated IP", async () => {
    await db.company.update({
      where: { id: a.companyId },
      data: { ndaText: "Keep it secret." },
    });
    const x = await room("nda-x@example.com");
    expect((await post({ kind: "DATA_ROOM", token: x.token })).status).toBe(
      204,
    );
    const rows = await rowsFor(x.r.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: a.companyId,
      kind: "DATA_ROOM",
      targetId: aIds.dataRoomId,
      text: "Keep it secret.",
      ip: "203.0.113.0",
      userAgent: "Mozilla/5.0 test",
    });

    // second accept: no-op, the original text stays
    await db.company.update({
      where: { id: a.companyId },
      data: { ndaText: "Changed later." },
    });
    expect((await post({ kind: "DATA_ROOM", token: x.token })).status).toBe(
      204,
    );
    const again = await rowsFor(x.r.id);
    expect(again).toHaveLength(1);
    expect(again[0]?.text).toBe("Keep it secret.");
  });

  it("stores DEFAULT_NDA_TEXT when the company has none, for an update too", async () => {
    const r = await db.updateRecipient.create({
      data: { updateId: aIds.updateId, email: "nda-u@example.com" },
    });
    const token = await encode({
      companyId: a.companyId,
      updateId: aIds.updateId,
      publicId: updatePublicId,
      recipientId: r.id,
    });
    expect((await post({ kind: "UPDATE", token })).status).toBe(204);
    const rows = await rowsFor(r.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "UPDATE",
      targetId: aIds.updateId,
      text: DEFAULT_NDA_TEXT,
    });
  });

  it("concurrent accepts both succeed and leave one row", async () => {
    const x = await room("nda-c@example.com");
    const res = await Promise.all([
      post({ kind: "DATA_ROOM", token: x.token }),
      post({ kind: "DATA_ROOM", token: x.token }),
    ]);
    expect(res.map((r) => r.status)).toEqual([204, 204]);
    expect(await rowsFor(x.r.id)).toHaveLength(1);
  });

  it("answers unknown, expired and revoked links with 404 and records nothing", async () => {
    const before = await db.ndaAcceptance.count();
    expect((await post({ kind: "DATA_ROOM", token: "nope" })).status).toBe(404);

    const expired = await room("nda-e@example.com", {
      expiresAt: new Date(Date.now() - DAY),
    });
    expect(
      (await post({ kind: "DATA_ROOM", token: expired.token })).status,
    ).toBe(404);

    const gone = await room("nda-g@example.com");
    await db.dataRoomRecipient.delete({ where: { id: gone.r.id } });
    expect((await post({ kind: "DATA_ROOM", token: gone.token })).status).toBe(
      404,
    );
    expect(await db.ndaAcceptance.count()).toBe(before);
  });

  it("rejects e-sign and malformed bodies", async () => {
    expect((await post({ kind: "ESIGN", token: "t" })).status).toBe(400);
    expect((await post({ kind: "DATA_ROOM" })).status).toBe(400);
    expect(
      (await post({ kind: "DATA_ROOM", token: "x".repeat(5000) })).status,
    ).toBe(400);
  });

  it("records nothing when the room does not require an NDA", async () => {
    await db.dataRoom.update({
      where: { id: aIds.dataRoomId },
      data: { requireNda: false },
    });
    try {
      const x = await room("nda-off@example.com");
      expect((await post({ kind: "DATA_ROOM", token: x.token })).status).toBe(
        204,
      );
      expect(await rowsFor(x.r.id)).toHaveLength(0);
    } finally {
      await db.dataRoom.update({
        where: { id: aIds.dataRoomId },
        data: { requireNda: true },
      });
    }
  });

  it("another company's recipient never creates a row for this company's room", async () => {
    // B's recipient named against A's room: not a recipient of that room
    const forged = await encode({
      companyId: a.companyId,
      dataRoomId: aIds.dataRoomId,
      recipientId: bIds.dataRoomRecipientId,
    });
    expect((await post({ kind: "DATA_ROOM", token: forged })).status).toBe(404);
    // A's room under B's company id: the room is not B's
    const crossed = await encode({
      companyId: b.companyId,
      dataRoomId: aIds.dataRoomId,
      recipientId: bIds.dataRoomRecipientId,
    });
    expect((await post({ kind: "DATA_ROOM", token: crossed })).status).toBe(
      404,
    );
    // B's own valid link records under B and B's room only
    const own = await encode({
      companyId: b.companyId,
      dataRoomId: bIds.dataRoomId,
      recipientId: bIds.dataRoomRecipientId,
    });
    expect((await post({ kind: "DATA_ROOM", token: own })).status).toBe(204);
    const rows = await rowsFor(bIds.dataRoomRecipientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: b.companyId,
      targetId: bIds.dataRoomId,
    });
    expect(
      await db.ndaAcceptance.count({
        where: {
          OR: [{ companyId: a.companyId }, { targetId: aIds.dataRoomId }],
          recipientId: bIds.dataRoomRecipientId,
        },
      }),
    ).toBe(0);
  });
});

describe("getNdaState", () => {
  it("is not required when the switch is off, then false before and true after acceptance", async () => {
    const x = await room("nda-s@example.com");
    const target = {
      kind: "DATA_ROOM" as const,
      targetId: aIds.dataRoomId,
      recipientId: x.r.id,
      companyId: a.companyId,
    };

    await db.dataRoom.update({
      where: { id: aIds.dataRoomId },
      data: { requireNda: false },
    });
    try {
      expect(await getNdaState(db, target)).toEqual({ required: false });
    } finally {
      await db.dataRoom.update({
        where: { id: aIds.dataRoomId },
        data: { requireNda: true },
      });
    }

    expect(await getNdaState(db, target)).toEqual({
      required: true,
      accepted: false,
      text: DEFAULT_NDA_TEXT,
    });
    // another company's id never reads A's room as required
    expect(
      await getNdaState(db, { ...target, companyId: b.companyId }),
    ).toEqual({ required: false });

    await post({ kind: "DATA_ROOM", token: x.token });
    expect(await getNdaState(db, target)).toMatchObject({
      required: true,
      accepted: true,
    });
  });
});
