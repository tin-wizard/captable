import { sendReminder } from "@/server/activity/send-reminder";
import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant-db";
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
const ago = (ms: number) => new Date(Date.now() - ms);

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  await db.update.updateMany({
    where: { id: { in: [aIds.updateId, bIds.updateId] } },
    data: { status: "PUBLIC", public: true },
  });
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

beforeEach(() => {
  roomEmit.mockClear();
  updateEmit.mockClear();
});

const kinds = [
  {
    kind: "DATA_ROOM" as const,
    emit: roomEmit,
    parentA: () => aIds.dataRoomId,
    parentB: () => bIds.dataRoomId,
    recipient: async (
      email: string,
      extra = {},
      parentId?: string,
      at = ago(4 * DAY),
    ) => {
      const r = await db.dataRoomRecipient.create({
        data: { dataRoomId: parentId ?? aIds.dataRoomId, email, ...extra },
      });
      await db.$executeRaw`UPDATE "DataRoomRecipient" SET "updatedAt" = ${at} WHERE id = ${r.id}`;
      return r;
    },
  },
  {
    kind: "UPDATE" as const,
    emit: updateEmit,
    parentA: () => aIds.updateId,
    parentB: () => bIds.updateId,
    recipient: async (
      email: string,
      extra = {},
      parentId?: string,
      at = ago(4 * DAY),
    ) => {
      const r = await db.updateRecipient.create({
        data: { updateId: parentId ?? aIds.updateId, email, ...extra },
      });
      await db.$executeRaw`UPDATE "UpdateRecipient" SET "updatedAt" = ${at} WHERE id = ${r.id}`;
      return r;
    },
  },
];

describe.each(kinds.map((k) => [k.kind, k] as const))(
  "sendReminder %s",
  (_, k) => {
    const mail = (n: string) => `sr-${k.kind}-${n}@example.com`;
    const send = (
      recipientId: string,
      opts: { client?: "tenant" | "raw"; targetId?: string } = {},
    ) =>
      sendReminder(opts.client === "raw" ? db : tenantDb(db, a.companyId), {
        companyId: a.companyId,
        kind: k.kind,
        targetId: opts.targetId ?? k.parentA(),
        recipientId,
        sender: { name: "Ann", email: "ann@example.com" },
        actor: { type: "user", id: a.userId },
        context: { requestIp: "1.2.3.4", userAgent: "ua" },
      });

    it("sends exactly once with reminder: true", async () => {
      const r = await k.recipient(mail("ok"));
      await expect(send(r.id)).resolves.toEqual({ sent: true });
      expect(k.emit).toHaveBeenCalledTimes(1);
      expect(k.emit.mock.calls[0]?.[0]).toMatchObject({
        email: mail("ok"),
        reminder: true,
      });
    });

    it("works with the raw db as well as the tenant client", async () => {
      const r = await k.recipient(mail("raw"));
      await expect(send(r.id, { client: "raw" })).resolves.toEqual({
        sent: true,
      });
      expect(k.emit).toHaveBeenCalledTimes(1);
    });

    it("returns each refusal reason without throwing or sending", async () => {
      const expired = await k.recipient(mail("exp"), {
        expiresAt: new Date(Date.now() - 1000),
      });
      const expiring = await k.recipient(mail("soon"), {
        expiresAt: new Date(Date.now() + 23 * 3600 * 1000),
      });
      const opened = await k.recipient(mail("open"));
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
      const cooldown = await k.recipient(mail("cool"), {
        lastNudgedAt: new Date(Date.now() - 3600 * 1000),
      });
      const fresh = await k.recipient(mail("fresh"), {}, undefined, new Date());
      const theirs = await k.recipient(mail("theirs"), {}, k.parentB());

      const cases = [
        [expired.id, "expired"],
        [expiring.id, "expiring"],
        [opened.id, "opened"],
        [cooldown.id, "cooldown"],
        [fresh.id, "too-soon"],
        [theirs.id, "not-found"],
      ] as const;
      for (const [id, reason] of cases)
        await expect(send(id), reason).resolves.toEqual({
          sent: false,
          reason,
        });
      await expect(send(theirs.id, { targetId: k.parentB() })).resolves.toEqual(
        { sent: false, reason: "not-found" },
      );
      await expect(
        send(theirs.id, { client: "raw", targetId: k.parentB() }),
      ).resolves.toEqual({ sent: false, reason: "not-found" });
      expect(k.emit).not.toHaveBeenCalled();
    });

    it("a second send inside 24 h is a cooldown", async () => {
      const r = await k.recipient(mail("twice"));
      await expect(send(r.id)).resolves.toEqual({ sent: true });
      await expect(send(r.id)).resolves.toEqual({
        sent: false,
        reason: "cooldown",
      });
      expect(k.emit).toHaveBeenCalledTimes(1);
    });

    it("an emit failure still throws and releases the claim", async () => {
      const r = await k.recipient(mail("fail"));
      k.emit.mockRejectedValueOnce(new Error("smtp down"));
      await expect(send(r.id)).rejects.toThrow("smtp down");
      await expect(send(r.id)).resolves.toEqual({ sent: true });
    });
  },
);
