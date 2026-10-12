import { encode } from "@/lib/jwt";
import { db } from "@/server/db";
import { EncodeEmailToken } from "@/trpc/routers/template-field-router/procedures/add-fields";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

const emit = vi.hoisted(() => vi.fn());
vi.mock("@/jobs/view-alert-email", () => ({ viewAlertEmailJob: { emit } }));
const getSession = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("@/server/auth", async (orig) => ({
  ...(await orig<typeof import("@/server/auth")>()),
  getServerAuthSession: getSession,
}));

import { POST } from "@/app/api/activity/view/route";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const call = (body: unknown, userAgent = UA) =>
  POST(
    new Request("http://localhost/api/activity/view", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.9",
        "user-agent": userAgent,
      },
      body: JSON.stringify(body),
    }),
  );

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let roomRecipientId: string;
let updatePublicId: string;
let updateRecipientId: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  roomRecipientId = (
    await db.dataRoomRecipient.create({
      data: { email: "inv@example.com", dataRoomId: aIds.dataRoomId },
    })
  ).id;
  // the beacon only counts a viewable update, like the public page
  updatePublicId = (
    await db.update.update({
      where: { id: aIds.updateId },
      data: { status: "PUBLIC", public: true },
    })
  ).publicId;
  updateRecipientId = (
    await db.updateRecipient.create({
      data: { email: "inv@example.com", updateId: aIds.updateId },
    })
  ).id;
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

beforeEach(() => emit.mockClear());

const roomToken = (over: Record<string, string> = {}) =>
  encode({
    companyId: a.companyId,
    dataRoomId: aIds.dataRoomId,
    recipientId: roomRecipientId,
    ...over,
  });

const eventsFor = (recipientId: string) =>
  db.viewEvent.findMany({ where: { recipientId } });

describe("POST /api/activity/view", () => {
  it("records a data room view and alerts once", async () => {
    const token = await roomToken();
    expect((await call({ kind: "DATA_ROOM", token })).status).toBe(200);
    expect(await eventsFor(roomRecipientId)).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      companyId: a.companyId,
      kind: "DATA_ROOM",
      recipientId: roomRecipientId,
      occurrence: "first",
    });

    // a reload within 10s is neither stored nor emailed
    expect((await call({ kind: "DATA_ROOM", token })).status).toBe(200);
    expect(await eventsFor(roomRecipientId)).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("rejects a token whose company does not own the room", async () => {
    const token = await roomToken({ companyId: b.companyId });
    const before = (await eventsFor(roomRecipientId)).length;
    expect((await call({ kind: "DATA_ROOM", token })).status).toBe(404);
    expect(await eventsFor(roomRecipientId)).toHaveLength(before);
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects a garbage token and a malformed body without a 500", async () => {
    expect((await call({ kind: "DATA_ROOM", token: "nope" })).status).toBe(404);
    expect((await call({ kind: "ESIGN", token: "nope" })).status).toBe(404);
    expect((await call({ kind: "WAT", token: "x" })).status).toBe(400);
    expect((await call("not an object")).status).toBe(400);
    expect(emit).not.toHaveBeenCalled();
  });

  it("stores a bot but sends no alert", async () => {
    const recipient = await db.dataRoomRecipient.create({
      data: { email: "scan@example.com", dataRoomId: aIds.dataRoomId },
    });
    const token = await roomToken({ recipientId: recipient.id });
    const res = await call(
      { kind: "DATA_ROOM", token },
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
    );
    expect(res.status).toBe(200);
    const [row] = await eventsFor(recipient.id);
    expect(row?.isBot).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it("records an update view", async () => {
    const token = await encode({
      publicId: updatePublicId,
      companyId: a.companyId,
      recipientId: updateRecipientId,
    });
    expect((await call({ kind: "UPDATE", token })).status).toBe(200);
    expect(await eventsFor(updateRecipientId)).toHaveLength(1);
  });

  it("records an e-sign view and writes one recipient.viewed audit row", async () => {
    const recipient = await db.esignRecipient.findUniqueOrThrow({
      where: { id: aIds.recipientId },
    });
    const token = await EncodeEmailToken({
      recipientId: recipient.id,
      templateId: recipient.templateId,
    });
    expect((await call({ kind: "ESIGN", token })).status).toBe(200);
    expect((await call({ kind: "ESIGN", token })).status).toBe(200);
    const audits = await db.esignAudit.findMany({
      where: { recipientId: recipient.id, action: "recipient.viewed" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.ip).toBe("203.0.113.9");
  });

  it("returns a visit id and stores location and timezone", async () => {
    const rec = await db.dataRoomRecipient.create({
      data: { email: "geo@example.com", dataRoomId: aIds.dataRoomId },
    });
    const token = await roomToken({ recipientId: rec.id });
    const res = await call({
      kind: "DATA_ROOM",
      token,
      timezone: "America/Toronto",
    });
    expect(res.status).toBe(200);
    const { visitId } = await res.json();
    const row = await db.viewEvent.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(row.timezone).toBe("America/Toronto");
  });

  it("records nothing for a signed-in active member of the same company", async () => {
    getSession.mockResolvedValueOnce({ user: { id: a.userId } });
    const rec = await db.dataRoomRecipient.create({
      data: { email: "self@example.com", dataRoomId: aIds.dataRoomId },
    });
    const res = await call({
      kind: "DATA_ROOM",
      token: await roomToken({ recipientId: rec.id }),
    });
    expect((await res.json()).visitId).toBeNull();
    expect(await eventsFor(rec.id)).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("still records a viewer who has a session only in another company", async () => {
    getSession.mockResolvedValueOnce({ user: { id: b.userId } });
    const rec = await db.dataRoomRecipient.create({
      data: { email: "other@example.com", dataRoomId: aIds.dataRoomId },
    });
    const res = await call({
      kind: "DATA_ROOM",
      token: await roomToken({ recipientId: rec.id }),
    });
    expect((await res.json()).visitId).not.toBeNull();
  });

  it("rejects an update that is not public", async () => {
    await db.update.update({
      where: { id: aIds.updateId },
      data: { public: false },
    });
    const token = await encode({
      publicId: updatePublicId,
      companyId: a.companyId,
      recipientId: updateRecipientId,
    });
    const before = (await eventsFor(updateRecipientId)).length;
    expect((await call({ kind: "UPDATE", token })).status).toBe(404);
    expect(await eventsFor(updateRecipientId)).toHaveLength(before);
    await db.update.update({
      where: { id: aIds.updateId },
      data: { public: true, status: "PUBLIC" },
    });
  });
});
