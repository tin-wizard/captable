import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Tenant,
  callerFor,
  cleanupTenants,
  seedTenant,
} from "../helpers/seed";

/** analytics.company (Reports page): per-block permissions and tenancy. */

let a: Tenant;
let b: Tenant;
let empty: Tenant;
const extraUsers: string[] = [];

async function memberWith(permissions: object[]) {
  const user = await db.user.create({
    data: {
      name: "co member",
      email: `co-${nanoid(8)}@example.com`,
      emailVerified: new Date(),
    },
  });
  extraUsers.push(user.id);
  const role = await db.customRole.create({
    data: { companyId: a.companyId, name: nanoid(6), permissions },
  });
  const member = await db.member.create({
    data: {
      userId: user.id,
      companyId: a.companyId,
      role: "CUSTOM",
      customRoleId: role.id,
      status: "ACTIVE",
      isOnboarded: true,
    },
  });
  return callerFor({
    ...a,
    memberId: member.id,
    userId: user.id,
    session: {
      ...a.session,
      user: {
        ...a.session.user,
        id: user.id,
        email: user.email,
        memberId: member.id,
      },
    },
  });
}

async function roomWithVisits(t: Tenant, name: string, visits: number) {
  const room = await db.dataRoom.create({
    data: { companyId: t.companyId, name, publicId: nanoid(12) },
  });
  const rec = await db.dataRoomRecipient.create({
    data: { dataRoomId: room.id, name: "Viewer", email: `${nanoid(5)}@x.io` },
  });
  for (let i = 0; i < visits; i++)
    await db.viewEvent.create({
      data: {
        companyId: t.companyId,
        kind: "DATA_ROOM",
        targetId: room.id,
        recipientId: rec.id,
        ip: "1.2.3.0",
        userAgent: "ua",
        country: "DE",
        activeSeconds: 30,
        createdAt: new Date(Date.now() - i * 3_600_000),
      },
    });
}

beforeAll(async () => {
  a = await seedTenant("co-a");
  b = await seedTenant("co-b");
  empty = await seedTenant("co-empty");
  await roomWithVisits(a, "A room", 3);
  await roomWithVisits(b, "SecretB room", 11);
  await db.share.create({
    data: {
      companyId: a.companyId,
      stakeholderId: (
        await db.stakeholder.create({
          data: { companyId: a.companyId, name: "Holder", email: "h@x.io" },
        })
      ).id,
      shareClassId: (
        await db.shareClass.create({
          data: {
            companyId: a.companyId,
            idx: 1,
            name: "Common",
            classType: "COMMON",
            prefix: "CS",
            initialSharesAuthorized: 100n,
            boardApprovalDate: new Date(),
            stockholderApprovalDate: new Date(),
            votesPerShare: 1,
            parValue: 0.01,
            pricePerShare: 1,
            seniority: 1,
            liquidationPreferenceMultiple: 1,
            participationCapMultiple: 1,
          },
        })
      ).id,
      certificateId: nanoid(6),
      quantity: 40,
      status: "ACTIVE",
      issueDate: new Date(),
      boardApprovalDate: new Date(),
    },
  });
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await cleanupTenants(a, b, empty);
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
});

describe("analytics.company", () => {
  it("gives an admin every block, scoped to the company", async () => {
    const r = await callerFor(a).analytics.company({});
    expect(r.engagement?.kpis.visits).toBe(3);
    expect(r.engagement?.topItems.map((i) => i.name)).toEqual(["A room"]);
    expect(r.engagement?.countries).toEqual([{ country: "DE", visits: 3 }]);
    expect(r.holdings?.issuedShares).toBe(40);
    expect(r.esign).not.toBeNull();
    expect(JSON.stringify(r)).not.toContain("SecretB");
  });

  it("returns only the blocks the role can read", async () => {
    const auditsOnly = await memberWith([
      { subject: "audits", actions: ["read"] },
    ]);
    expect(await auditsOnly.analytics.company({})).toEqual({
      engagement: null,
      esign: null,
      holdings: null,
    });

    const docs = await memberWith([
      { subject: "audits", actions: ["read"] },
      { subject: "data-rooms", actions: ["read"] },
    ]);
    const d = await docs.analytics.company({});
    expect(d.engagement?.kpis.visits).toBe(3);
    expect(d.holdings).toBeNull();
    expect(d.esign).toBeNull();

    const money = await memberWith([
      { subject: "securities", actions: ["read"] },
    ]);
    const m = await money.analytics.company({});
    expect(m.holdings?.issuedShares).toBe(40);
    expect(m.engagement).toBeNull();

    const sign = await memberWith([
      { subject: "templates", actions: ["read"] },
    ]);
    const s = await sign.analytics.company({});
    expect(s.esign?.canSeeViews).toBe(false);
    expect(s.engagement).toBeNull();
  });

  it("returns zeros for an empty company", async () => {
    const r = await callerFor(empty).analytics.company({ range: "7d" });
    expect(r.engagement?.kpis.visits).toBe(0);
    expect(r.engagement?.series).toHaveLength(7);
    expect(r.engagement?.topItems).toEqual([]);
    expect(r.holdings?.issuedShares).toBe(0);
  });
});
