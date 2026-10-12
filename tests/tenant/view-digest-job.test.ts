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

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BASE_URL ??= "https://dealroom.test";
});
const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/server/mailer", () => ({ sendMail }));

import { viewAlertEmailWorker } from "@/jobs/view-alert-email";
import { viewDigestEmailWorker } from "@/jobs/view-digest-email";

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let recipientId: string;
let roomNameA: string;
let roomNameB: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  recipientId = (
    await db.dataRoomRecipient.create({
      data: {
        email: "investor@example.com",
        name: "Ivy",
        dataRoomId: aIds.dataRoomId,
      },
    })
  ).id;
  roomNameA = (
    await db.dataRoom.findUniqueOrThrow({ where: { id: aIds.dataRoomId } })
  ).name;
  roomNameB = (
    await db.dataRoom.findUniqueOrThrow({ where: { id: bIds.dataRoomId } })
  ).name;
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

beforeEach(async () => {
  sendMail.mockClear();
  await db.viewEvent.deleteMany({
    where: { companyId: { in: [a.companyId, b.companyId] } },
  });
  await db.dataRoom.update({
    where: { id: aIds.dataRoomId },
    data: { createdById: null },
  });
  await db.member.updateMany({
    where: { id: { in: [a.memberId, b.memberId] } },
    data: { notifyOnView: true, viewDigest: true },
  });
});

afterAll(async () => {
  await db.member.updateMany({
    where: { id: { in: [a.memberId, b.memberId] } },
    data: { viewDigest: false },
  });
});

const run = () => viewDigestEmailWorker.handler([{ data: {} } as never]);
const visit = (secs = 30, at = new Date(), isBot = false) =>
  db.viewEvent.create({
    data: {
      companyId: a.companyId,
      kind: "DATA_ROOM",
      targetId: aIds.dataRoomId,
      recipientId,
      ip: "1.2.3.0",
      userAgent: "ua",
      activeSeconds: secs,
      createdAt: at,
      isBot,
    },
  });
const sentTo = async (userId: string) => {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return sendMail.mock.calls
    .map((c) => c[0] as { to: string; html: string })
    .filter((m) => m.to === u.email);
};
const rowCount = (html: string) =>
  (html.match(/data-digest-row="view"/g) ?? []).length;

describe("view digest job", () => {
  it("sends one email to a digest member listing the last 24 h of visits", async () => {
    await visit(45);
    await run();
    const mine = await sentTo(a.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.html ?? "").toContain("Ivy");
    expect(rowCount(mine[0]?.html ?? "")).toBe(1);
  });

  it("does not also send the instant alert to a digest member", async () => {
    await viewAlertEmailWorker.handler([
      {
        data: {
          companyId: a.companyId,
          kind: "DATA_ROOM",
          targetId: aIds.dataRoomId,
          recipientId,
          occurrence: "first",
        },
      } as never,
    ]);
    expect(await sentTo(a.userId)).toHaveLength(0);
  });

  it("sends nothing for a company with no activity", async () => {
    await run();
    expect(await sentTo(a.userId)).toHaveLength(0);
  });

  it("ignores visits older than 24 h and bot visits", async () => {
    await visit(10, new Date(Date.now() - 30 * 3600_000));
    await visit(10, new Date(), true);
    await run();
    expect(await sentTo(a.userId)).toHaveLength(0);
  });

  it("never includes another company's activity", async () => {
    const theirs = await db.dataRoomRecipient.create({
      data: {
        dataRoomId: bIds.dataRoomId,
        email: "secret-b@example.com",
        name: "SecretBViewer",
      },
    });
    await db.viewEvent.create({
      data: {
        companyId: b.companyId,
        kind: "DATA_ROOM",
        targetId: bIds.dataRoomId,
        recipientId: theirs.id,
        ip: "1.2.3.0",
        userAgent: "ua",
        activeSeconds: 5,
      },
    });
    await visit(20);
    await run();
    const forA = await sentTo(a.userId);
    const forB = await sentTo(b.userId);
    expect(forA).toHaveLength(1);
    expect(forB).toHaveLength(1);
    expect(forA[0]?.html ?? "").not.toContain("SecretBViewer");
    expect(forA[0]?.html ?? "").not.toContain(roomNameB);
    expect(forB[0]?.html ?? "").toContain("SecretBViewer");
    expect(forB[0]?.html ?? "").not.toContain("Ivy");
    expect(forB[0]?.html ?? "").not.toContain(roomNameA);
    await db.viewEvent.deleteMany({ where: { recipientId: theirs.id } });
    await db.dataRoomRecipient.delete({ where: { id: theirs.id } });
  });

  it("a member who is both ADMIN and creator gets each item once", async () => {
    await db.dataRoom.update({
      where: { id: aIds.dataRoomId },
      data: { createdById: a.memberId },
    });
    await visit(20);
    await run();
    const mine = await sentTo(a.userId);
    expect(mine).toHaveLength(1);
    expect(rowCount(mine[0]?.html ?? "")).toBe(1);
  });

  it("members with alerts off or digest off get nothing from the digest", async () => {
    await visit(20);
    for (const data of [
      { notifyOnView: false, viewDigest: true },
      { notifyOnView: true, viewDigest: false },
    ]) {
      await db.member.update({ where: { id: a.memberId }, data });
      sendMail.mockClear();
      await run();
      expect(await sentTo(a.userId)).toHaveLength(0);
    }
  });

  it("names a newly crossing unopened recipient even behind an older one", async () => {
    const day = 86_400_000;
    const mkR = async (name: string, ageDays: number) => {
      const r = await db.dataRoomRecipient.create({
        data: {
          dataRoomId: aIds.dataRoomId,
          email: `${name}@example.com`,
          name,
        },
      });
      await db.$executeRaw`UPDATE "DataRoomRecipient" SET "updatedAt" = ${new Date(
        Date.now() - ageDays * day,
      )} WHERE id = ${r.id}`;
      return r.id;
    };
    const ids = [await mkR("LongWaiter", 10), await mkR("NewlyCrossing", 3.5)];
    await run();
    const mine = await sentTo(a.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.html).toContain("NewlyCrossing");
    expect(mine[0]?.html).not.toContain("LongWaiter");
    await db.dataRoomRecipient.deleteMany({ where: { id: { in: ids } } });
  });

  it("one member's send failure does not stop the others in the company", async () => {
    const u = await db.user.create({
      data: {
        name: "second",
        email: `second-${Date.now()}@example.com`,
        emailVerified: new Date(),
      },
    });
    const m = await db.member.create({
      data: {
        userId: u.id,
        companyId: a.companyId,
        role: "ADMIN",
        status: "ACTIVE",
        isOnboarded: true,
        notifyOnView: true,
        viewDigest: true,
      },
    });
    await visit(20);
    sendMail.mockClear();
    sendMail.mockRejectedValueOnce(new Error("smtp down"));
    await expect(run()).resolves.not.toThrow();
    const toA = sendMail.mock.calls
      .map((c) => c[0].to)
      .filter((t) => t !== undefined);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(toA).toHaveLength(2);
    await db.member.delete({ where: { id: m.id } });
    await db.user.delete({ where: { id: u.id } });
  });
});
