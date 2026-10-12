import { generatePublicId } from "@/common/id";
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
    recipient: async (email: string, extra = {}, parentId?: string) =>
      db.dataRoomRecipient.create({
        data: { dataRoomId: parentId ?? aIds.dataRoomId, email, ...extra },
      }),
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
    recipient: async (email: string, extra = {}, parentId?: string) =>
      db.updateRecipient.create({
        data: { updateId: parentId ?? aIds.updateId, email, ...extra },
      }),
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
