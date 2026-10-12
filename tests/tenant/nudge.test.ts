import { generatePublicId } from "@/common/id";
import { findUnopened } from "@/server/activity/unopened";
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
import { type Tenant, callerFor, seedTwoTenants } from "../helpers/seed";
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
// a nudge needs the share to have waited 3 days, so fixtures start 4 days old
const ago = (ms: number) => new Date(Date.now() - ms);
const old = () => ago(4 * DAY);

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let privateUpdateId: string;
let updatePublicId: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  // only a PUBLIC update can be nudged; the fixtures seed PRIVATE ones
  await db.update.updateMany({
    where: { id: { in: [aIds.updateId, bIds.updateId] } },
    data: { status: "PUBLIC", public: true },
  });
  updatePublicId = (
    await db.update.findUniqueOrThrow({ where: { id: aIds.updateId } })
  ).publicId;
  privateUpdateId = (
    await db.update.create({
      data: {
        companyId: a.companyId,
        authorId: a.memberId,
        publicId: generatePublicId(),
        title: "nudge private",
        content: {},
        html: "",
        status: "PRIVATE",
      },
    })
  ).id;
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

beforeEach(() => {
  roomEmit.mockClear();
  updateEmit.mockClear();
});

// the same five behaviours, once per kind
const kinds = [
  {
    kind: "dataRoom",
    emit: roomEmit,
    viewKind: "DATA_ROOM" as const,
    path: () => "/data-rooms/",
    publicId: () => aIds.dataRoomPublicId,
    parentA: () => aIds.dataRoomId,
    parentB: () => bIds.dataRoomId,
    recipient: async (
      email: string,
      extra = {},
      parentId?: string,
      at = old(),
    ) => {
      const r = await db.dataRoomRecipient.create({
        data: { dataRoomId: parentId ?? aIds.dataRoomId, email, ...extra },
      });
      await db.$executeRaw`UPDATE "DataRoomRecipient" SET "updatedAt" = ${at} WHERE id = ${r.id}`;
      return r;
    },
    nudge: (t: Tenant, parentId: string, recipientId: string) =>
      callerFor(t).dataRoom.nudge({ dataRoomId: parentId, recipientId }),
    nudgedAt: async (id: string) =>
      (await db.dataRoomRecipient.findUniqueOrThrow({ where: { id } }))
        .lastNudgedAt,
  },
  {
    kind: "update",
    emit: updateEmit,
    viewKind: "UPDATE" as const,
    path: () => "/updates/",
    publicId: () => updatePublicId,
    parentA: () => aIds.updateId,
    parentB: () => bIds.updateId,
    recipient: async (
      email: string,
      extra = {},
      parentId?: string,
      at = old(),
    ) => {
      const r = await db.updateRecipient.create({
        data: { updateId: parentId ?? aIds.updateId, email, ...extra },
      });
      await db.$executeRaw`UPDATE "UpdateRecipient" SET "updatedAt" = ${at} WHERE id = ${r.id}`;
      return r;
    },
    nudge: (t: Tenant, parentId: string, recipientId: string) =>
      callerFor(t).update.nudge({ updateId: parentId, recipientId }),
    nudgedAt: async (id: string) =>
      (await db.updateRecipient.findUniqueOrThrow({ where: { id } }))
        .lastNudgedAt,
  },
];

describe.each(kinds.map((k) => [k.kind, k] as const))("%s.nudge", (_, k) => {
  const mail = (n: string) => `${k.kind}-${n}@example.com`;

  it("sends one reminder with the share link and stamps lastNudgedAt", async () => {
    const r = await k.recipient(mail("n1"));
    await expect(k.nudge(a, k.parentA(), r.id)).resolves.toEqual({
      success: true,
    });
    expect(k.emit).toHaveBeenCalledTimes(1);
    const payload = k.emit.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ email: mail("n1"), reminder: true });
    expect(payload.link).toContain(`${k.path()}${k.publicId()}?token=`);
    expect(await k.nudgedAt(r.id)).not.toBeNull();
  });

  it("a second nudge inside 24 h is refused and sends nothing", async () => {
    const r = await k.recipient(mail("n2"));
    await k.nudge(a, k.parentA(), r.id);
    k.emit.mockClear();
    await expect(k.nudge(a, k.parentA(), r.id)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(k.emit).not.toHaveBeenCalled();
  });

  it("a nudge after the cooldown is allowed again", async () => {
    const r = await k.recipient(mail("n2b"), {
      lastNudgedAt: new Date(Date.now() - 25 * 3600 * 1000),
    });
    await k.nudge(a, k.parentA(), r.id);
    expect(k.emit).toHaveBeenCalledTimes(1);
  });

  it("two simultaneous nudges send exactly one email", async () => {
    const r = await k.recipient(mail("n3"));
    const results = await Promise.allSettled([
      k.nudge(a, k.parentA(), r.id),
      k.nudge(a, k.parentA(), r.id),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(k.emit).toHaveBeenCalledTimes(1);
  });

  it("refuses someone who already opened, or an expired link", async () => {
    const opened = await k.recipient(mail("n4"));
    await db.viewEvent.create({
      data: {
        companyId: a.companyId,
        kind: k.viewKind,
        targetId: k.parentA(),
        recipientId: opened.id,
        ip: "1.2.3.0",
        userAgent: "ua",
      },
    });
    const dead = await k.recipient(mail("n5"), {
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(k.nudge(a, k.parentA(), opened.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(k.nudge(a, k.parentA(), dead.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(k.emit).not.toHaveBeenCalled();
    expect(await k.nudgedAt(opened.id)).toBeNull();
    expect(await k.nudgedAt(dead.id)).toBeNull();
  });

  it("a just-shared recipient is refused; one waiting 3 days + 1 minute is allowed", async () => {
    const fresh = await k.recipient(mail("w1"), {}, undefined, new Date());
    await expect(k.nudge(a, k.parentA(), fresh.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Wait a few days after sharing before sending a reminder.",
    });
    expect(k.emit).not.toHaveBeenCalled();
    expect(await k.nudgedAt(fresh.id)).toBeNull();

    const waited = await k.recipient(
      mail("w2"),
      {},
      undefined,
      ago(3 * DAY + 60_000),
    );
    await k.nudge(a, k.parentA(), waited.id);
    expect(k.emit).toHaveBeenCalledTimes(1);
  });

  it("a pre-Phase-3 link (null expiresAt) dies with its 30-day token", async () => {
    const dead = await k.recipient(mail("l40"), {}, undefined, ago(40 * DAY));
    await expect(k.nudge(a, k.parentA(), dead.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This link has expired. Share again to renew it.",
    });
    expect(k.emit).not.toHaveBeenCalled();
    expect(await k.nudgedAt(dead.id)).toBeNull();

    const alive = await k.recipient(mail("l10"), {}, undefined, ago(10 * DAY));
    await k.nudge(a, k.parentA(), alive.id);
    expect(k.emit).toHaveBeenCalledTimes(1);
  });

  it("a failed send releases the claim so a retry works", async () => {
    const r = await k.recipient(mail("f1"));
    k.emit.mockRejectedValueOnce(new Error("smtp down"));
    await expect(k.nudge(a, k.parentA(), r.id)).rejects.toThrow();
    expect(await k.nudgedAt(r.id)).toBeNull();
    await expect(k.nudge(a, k.parentA(), r.id)).resolves.toEqual({
      success: true,
    });
    expect(k.emit).toHaveBeenCalledTimes(2);
    expect(await k.nudgedAt(r.id)).not.toBeNull();
  });

  it("refuses a link that expires within a day, before any claim", async () => {
    const r = await k.recipient(mail("x1"), {
      expiresAt: new Date(Date.now() + 23 * 3600 * 1000),
    });
    await expect(k.nudge(a, k.parentA(), r.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This link expires within a day. Share again to renew it.",
    });
    expect(k.emit).not.toHaveBeenCalled();
    expect(await k.nudgedAt(r.id)).toBeNull();
  });

  it("a nudge restarts the waiting clock: the row leaves Not opened yet", async () => {
    const r = await k.recipient(mail("u1"));
    const listed = async () =>
      (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
    expect(await listed()).toContain(r.id);
    await k.nudge(a, k.parentA(), r.id);
    expect(await listed()).not.toContain(r.id);
  });

  it("a bot view does not count as opened", async () => {
    const r = await k.recipient(mail("n6"));
    await db.viewEvent.create({
      data: {
        companyId: a.companyId,
        kind: k.viewKind,
        targetId: k.parentA(),
        recipientId: r.id,
        ip: "1.2.3.0",
        userAgent: "bot",
        isBot: true,
      },
    });
    await k.nudge(a, k.parentA(), r.id);
    expect(k.emit).toHaveBeenCalledTimes(1);
  });

  it("another company's recipient is not found", async () => {
    const theirs = await k.recipient(mail("t"), {}, k.parentB());
    await expect(k.nudge(a, k.parentB(), theirs.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(k.nudge(a, k.parentA(), theirs.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(k.emit).not.toHaveBeenCalled();
    expect(await k.nudgedAt(theirs.id)).toBeNull();
  });
});

describe("parent must match", () => {
  it("a recipient of another data room in the same company is not found", async () => {
    const other = await db.dataRoom.create({
      data: {
        companyId: a.companyId,
        name: "nudge other",
        publicId: generatePublicId(),
      },
    });
    const r = await db.dataRoomRecipient.create({
      data: { dataRoomId: other.id, email: "other-room@example.com" },
    });
    await expect(
      callerFor(a).dataRoom.nudge({
        dataRoomId: aIds.dataRoomId,
        recipientId: r.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it("a recipient of a non-public update cannot be nudged", async () => {
    const r = await db.updateRecipient.create({
      data: { updateId: privateUpdateId, email: "private-upd@example.com" },
    });
    await expect(
      callerFor(a).update.nudge({
        updateId: privateUpdateId,
        recipientId: r.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateEmit).not.toHaveBeenCalled();
  });
});
