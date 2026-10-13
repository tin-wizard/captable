import { POST } from "@/app/api/activity/unsubscribe/route";
import { encode } from "@/lib/jwt";
import { sendReminder } from "@/server/activity/send-reminder";
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
import { type Tenant, seedTwoTenants } from "../helpers/seed";
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
    data: { status: "PUBLIC", public: true },
  });
  updatePublicId = u.publicId;
});
afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});
beforeEach(() => {
  roomEmit.mockClear();
  updateEmit.mockClear();
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/activity/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
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

describe("unsubscribe route", () => {
  it("opts out only the recipient the link names and keeps updatedAt", async () => {
    const x = await room("x@example.com");
    const other = await room("y@example.com");
    const before = await db.dataRoomRecipient.findUniqueOrThrow({
      where: { id: x.r.id },
    });
    const res = await post({ kind: "DATA_ROOM", token: x.token });
    expect(res.status).toBe(204);
    const after = await db.dataRoomRecipient.findUniqueOrThrow({
      where: { id: x.r.id },
    });
    expect(after.nudgeOptOut).toBe(true);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(
      (
        await db.dataRoomRecipient.findUniqueOrThrow({
          where: { id: other.r.id },
        })
      ).nudgeOptOut,
    ).toBe(false);
    // repeating is fine
    expect((await post({ kind: "DATA_ROOM", token: x.token })).status).toBe(
      204,
    );
  });

  it("works for an update recipient and touches nothing else", async () => {
    const r = await db.updateRecipient.create({
      data: { updateId: aIds.updateId, email: "u@example.com" },
    });
    const token = await encode({
      companyId: a.companyId,
      updateId: aIds.updateId,
      publicId: updatePublicId,
      recipientId: r.id,
    });
    const res = await post({ kind: "UPDATE", token });
    expect(res.status).toBe(204);
    expect(
      (await db.updateRecipient.findUniqueOrThrow({ where: { id: r.id } }))
        .nudgeOptOut,
    ).toBe(true);
  });

  it("answers unknown, expired and revoked links the same way and changes nothing", async () => {
    expect((await post({ kind: "DATA_ROOM", token: "nope" })).status).toBe(404);

    const expired = await room("e@example.com", {
      expiresAt: new Date(Date.now() - DAY),
    });
    expect(
      (await post({ kind: "DATA_ROOM", token: expired.token })).status,
    ).toBe(404);
    expect(
      (
        await db.dataRoomRecipient.findUniqueOrThrow({
          where: { id: expired.r.id },
        })
      ).nudgeOptOut,
    ).toBe(false);

    const gone = await room("g@example.com");
    await db.dataRoomRecipient.delete({ where: { id: gone.r.id } });
    expect((await post({ kind: "DATA_ROOM", token: gone.token })).status).toBe(
      404,
    );
  });

  it("rejects e-sign and malformed bodies", async () => {
    expect((await post({ kind: "ESIGN", token: "t" })).status).toBe(400);
    expect((await post({ kind: "DATA_ROOM" })).status).toBe(400);
    expect(
      (await post({ kind: "DATA_ROOM", token: "x".repeat(5000) })).status,
    ).toBe(400);
  });
});

describe("reminders and the opt-out", () => {
  const send = (recipientId: string, auto: boolean) =>
    sendReminder(db, {
      companyId: a.companyId,
      kind: "DATA_ROOM",
      targetId: aIds.dataRoomId,
      recipientId,
      sender: { name: "Acme", email: null },
      actor: { type: auto ? "company" : "user", id: "x" },
      ...(auto && { auto: { minWaitDays: 3 } }),
    });

  const waiting = async (email: string, extra: object = {}) => {
    const { r } = await room(email, extra);
    await db.$executeRaw`UPDATE "DataRoomRecipient" SET "updatedAt" = ${new Date(
      Date.now() - 5 * DAY,
    )} WHERE id = ${r.id}`;
    return r;
  };

  it("an automatic reminder carries the unsubscribe link, a manual one does not", async () => {
    const auto = await waiting("auto@example.com");
    expect((await send(auto.id, true)).sent).toBe(true);
    const payload = roomEmit.mock.calls[0]?.[0];
    expect(payload.reminder).toBe(true);
    expect(payload.unsubscribeLink).toContain(
      "/unsubscribed?kind=DATA_ROOM&token=",
    );

    roomEmit.mockClear();
    const manual = await waiting("manual@example.com");
    expect((await send(manual.id, false)).sent).toBe(true);
    expect(roomEmit.mock.calls[0]?.[0].unsubscribeLink).toBeUndefined();
  });

  it("after an opt-out automatic reminders stop and the manual button still works", async () => {
    const r = await waiting("opt@example.com", { nudgeOptOut: true });
    expect(await send(r.id, true)).toEqual({
      sent: false,
      reason: "opted-out",
    });
    expect(roomEmit).not.toHaveBeenCalled();
    expect((await send(r.id, false)).sent).toBe(true);
  });
});
