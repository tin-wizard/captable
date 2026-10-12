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

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let recipientId: string;

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
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

beforeEach(() => sendMail.mockClear());

const run = (occurrence: "first" | "return") =>
  viewAlertEmailWorker.handler([
    {
      data: {
        companyId: a.companyId,
        kind: "DATA_ROOM",
        targetId: aIds.dataRoomId,
        recipientId,
        occurrence,
      },
    } as never,
  ]);

describe("view alert job", () => {
  it("emails each active admin who has alerts on, and names the viewer", async () => {
    await db.member.update({
      where: { id: a.memberId },
      data: { notifyOnView: true },
    });
    await run("first");
    const admin = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    const to = sendMail.mock.calls.map((c) => c[0].to);
    expect(to).toContain(admin.email);
    expect(sendMail.mock.calls[0]?.[0].subject).toContain("Ivy");
    expect(sendMail.mock.calls[0]?.[0].subject).toContain("opened");
  });

  it("sends nothing to a member who turned alerts off", async () => {
    await db.member.update({
      where: { id: a.memberId },
      data: { notifyOnView: false },
    });
    await run("return");
    const admin = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    expect(sendMail.mock.calls.map((c) => c[0].to)).not.toContain(admin.email);
  });

  it("never emails another company's members", async () => {
    await db.member.update({
      where: { id: a.memberId },
      data: { notifyOnView: true },
    });
    await run("first");
    const other = await db.user.findUniqueOrThrow({ where: { id: b.userId } });
    expect(sendMail.mock.calls.map((c) => c[0].to)).not.toContain(other.email);
  });
});
