import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Tenant,
  callerFor,
  cleanupTenants,
  seedTenant,
} from "../helpers/seed";

/**
 * analytics.document / documentsSummary / viewerVisits over hand-built visits:
 * KPIs, per-document pages, filters, keyset pagination, permissions, tenancy.
 */

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY + 60_000);

let a: Tenant;
let b: Tenant;
const extraUsers: string[] = [];
let roomId: string;
let roomPublicId: string;
let bRoomPublicId: string;
let bRecipientId: string;
let doc1: string; // bucket ids
let doc2: string;
let ann: string;
let ben: string;
let cy: string;
let stakeholderId: string;

const bucket = (t: Tenant, name: string) =>
  db.bucket
    .create({
      data: {
        companyId: t.companyId,
        name,
        key: nanoid(8),
        mimeType: "application/pdf",
        size: 10,
        tags: [],
      },
    })
    .then((x) => x.id);

async function room(t: Tenant, name: string, buckets: string[]) {
  const r = await db.dataRoom.create({
    data: { companyId: t.companyId, name, publicId: nanoid(12) },
  });
  for (const bucketId of buckets) {
    const d = await db.document.create({
      data: {
        companyId: t.companyId,
        publicId: nanoid(10),
        name: `doc-${bucketId.slice(-4)}`,
        bucketId,
      },
    });
    await db.dataRoomDocument.create({
      data: { dataRoomId: r.id, documentId: d.id },
    });
  }
  return r;
}

const visit = (
  t: Tenant,
  targetId: string,
  recipientId: string,
  data: {
    createdAt: Date;
    activeSeconds: number;
    country?: string;
    isBot?: boolean;
    docSeconds?: object;
  },
) =>
  db.viewEvent.create({
    data: {
      companyId: t.companyId,
      kind: "DATA_ROOM",
      targetId,
      recipientId,
      ip: "1.2.3.0",
      userAgent: "ua",
      ...data,
    },
  });

async function memberWith(permissions: object[]) {
  const user = await db.user.create({
    data: {
      name: "an member",
      email: `an-${nanoid(8)}@example.com`,
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

beforeAll(async () => {
  a = await seedTenant("an-a");
  b = await seedTenant("an-b");

  doc1 = await bucket(a, "deck");
  doc2 = await bucket(a, "model");
  const r = await room(a, "Series A room", [doc1, doc2]);
  roomId = r.id;
  roomPublicId = r.publicId;

  stakeholderId = (
    await db.stakeholder.create({
      data: { companyId: a.companyId, name: "Ann Investor", email: "ann@x.io" },
    })
  ).id;
  const rec = (name: string, extra: object = {}) =>
    db.dataRoomRecipient
      .create({
        data: {
          dataRoomId: roomId,
          name,
          email: `${name.toLowerCase()}@x.io`,
          ...extra,
        },
      })
      .then((x) => x.id);
  ann = await rec("Ann", { stakeholderId });
  ben = await rec("Ben");
  cy = await rec("Cy");
  await db.$executeRaw`UPDATE "DataRoomRecipient" SET "updatedAt" = ${ago(
    5,
  )} WHERE id = ${cy}`;

  // Ann: two visits; second reaches the last page of doc1 (3 pages)
  await visit(a, roomId, ann, {
    createdAt: ago(2),
    activeSeconds: 100,
    country: "DE",
  });
  await visit(a, roomId, ann, {
    createdAt: ago(1),
    activeSeconds: 60,
    country: "DE",
    docSeconds: { [doc1]: { n: 3, p: { "1": 10, "2": 20, "3": 30 } } },
  });
  // Ben: one visit, only page 1
  await visit(a, roomId, ben, {
    createdAt: ago(3),
    activeSeconds: 20,
    country: "FR",
    docSeconds: { [doc1]: { n: 3, p: { "1": 5 } } },
  });
  // a scanner, and a visit in the previous period
  await visit(a, roomId, ann, {
    createdAt: ago(1),
    activeSeconds: 0,
    isBot: true,
  });
  await visit(a, roomId, ann, { createdAt: ago(40), activeSeconds: 10 });

  // tenant B
  const bBucket = await bucket(b, "b-deck");
  const br = await room(b, "B room", [bBucket]);
  bRoomPublicId = br.publicId;
  bRecipientId = (
    await db.dataRoomRecipient.create({
      data: { dataRoomId: br.id, name: "SecretB", email: "b@b.io" },
    })
  ).id;
  await visit(b, br.id, bRecipientId, {
    createdAt: ago(1),
    activeSeconds: 999,
    country: "JP",
  });
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await cleanupTenants(a, b);
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
});

const q = (over: object = {}) =>
  callerFor(a).analytics.document({
    kind: "DATA_ROOM",
    targetPublicId: roomPublicId,
    ...over,
  });

describe("analytics.document", () => {
  it("computes KPIs, the previous period and hides bots", async () => {
    const r = await q();
    expect(r).not.toBeNull();
    expect(r?.kpis).toMatchObject({
      visits: 3,
      viewers: 2,
      botsHidden: 1,
      avgActiveSeconds: 60,
    });
    expect(r?.kpis.previous.visits).toBe(1);
    expect(r?.kpis.returnRate).toBeCloseTo(0.5);
    expect((await q({ includeBots: true }))?.kpis.visits).toBe(4);
  });

  it("zero fills the series over the range", async () => {
    const r = await q({ range: "7d" });
    expect(r?.series).toHaveLength(7);
    expect(r?.series.reduce((n, p) => n + p.visits, 0)).toBe(3);
  });

  it("reports pages and completion per document from docSeconds", async () => {
    const r = await q();
    const d1 = r?.documents?.find((d) => d.bucketId === doc1);
    expect(d1).toMatchObject({ pages: 3, viewers: 2, completion: 0.5 });
    expect(d1?.byPage[0]).toMatchObject({ page: 1, viewers: 2 });
    expect(d1?.byPage[2]).toMatchObject({ page: 3, viewers: 1 });
    expect(r?.kpis.completionRate).toBeCloseTo(0.5);
    // the first Ann visit predates per-document capture
    expect(r?.legacyDetailFrom).not.toBeNull();
  });

  it("splits viewers into hot/warm/cold and counts the unopened", async () => {
    const r = await q();
    expect(r?.engagementMix.unopened).toBe(1);
    const { hot, warm, cold } = r?.engagementMix ?? {
      hot: 0,
      warm: 0,
      cold: 0,
    };
    expect(hot + warm + cold).toBe(2);
  });

  it("lists viewers newest first and filters by status, country and search", async () => {
    const all = await q();
    expect(all?.viewers.items.map((v) => v.label)).toEqual(["Ann", "Ben"]);
    expect(
      (await q({ viewerStatus: "returned" }))?.viewers.items.map(
        (v) => v.label,
      ),
    ).toEqual(["Ann"]);
    expect(
      (await q({ viewerStatus: "unopened" }))?.viewers.items.map(
        (v) => v.label,
      ),
    ).toEqual(["Cy"]);
    expect(
      (await q({ country: ["FR"] }))?.viewers.items.map((v) => v.label),
    ).toEqual(["Ben"]);
    expect(
      (await q({ search: "BEN@" }))?.viewers.items.map((v) => v.label),
    ).toEqual(["Ben"]);
  });

  it("paginates with a keyset cursor without gaps or repeats", async () => {
    const p1 = await q({ limit: 1 });
    expect(p1?.viewers.items).toHaveLength(1);
    expect(p1?.viewers.nextCursor).toBe(p1?.viewers.items[0]?.recipientId);
    const p2 = await q({ limit: 1, cursor: p1?.viewers.nextCursor });
    expect(p2?.viewers.items.map((v) => v.label)).toEqual(["Ben"]);
    expect(p2?.viewers.nextCursor).toBeNull();
    const foreign = await q({ cursor: bRecipientId });
    expect(foreign?.viewers.items).toEqual([]);
  });

  it("returns null for another company's room and never their numbers", async () => {
    const r = await callerFor(a).analytics.document({
      kind: "DATA_ROOM",
      targetPublicId: bRoomPublicId,
    });
    expect(r).toBeNull();
    expect(JSON.stringify(await q())).not.toContain("SecretB");
  });

  it("needs audits:read and the source's read permission", async () => {
    const auditOnly = await memberWith([
      { subject: "audits", actions: ["read"] },
    ]);
    await expect(
      auditOnly.analytics.document({
        kind: "DATA_ROOM",
        targetPublicId: roomPublicId,
      }),
    ).rejects.toThrow();
    const noAudit = await memberWith([
      { subject: "data-rooms", actions: ["read"] },
    ]);
    await expect(
      noAudit.analytics.document({
        kind: "DATA_ROOM",
        targetPublicId: roomPublicId,
      }),
    ).rejects.toThrow();
  });

  it("hides holdings without securities:read and shows them with it", async () => {
    await db.share.create({
      data: {
        companyId: a.companyId,
        stakeholderId,
        shareClassId: (
          await db.shareClass.create({
            data: {
              companyId: a.companyId,
              idx: 1,
              name: "Common",
              classType: "COMMON",
              prefix: "CS",
              initialSharesAuthorized: 1000n,
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
        quantity: 250,
        status: "ACTIVE",
        issueDate: new Date(),
        boardApprovalDate: new Date(),
      },
    });
    const viewer = await memberWith([
      { subject: "audits", actions: ["read"] },
      { subject: "data-rooms", actions: ["read"] },
    ]);
    const r = await viewer.analytics.document({
      kind: "DATA_ROOM",
      targetPublicId: roomPublicId,
    });
    expect(r?.viewers.items[0]?.stakeholder).toMatchObject({
      name: "Ann Investor",
      shares: null,
    });
    const admin = await q();
    expect(admin?.viewers.items[0]?.stakeholder?.shares).toBe(250);
  });
});

describe("analytics.documentsSummary and viewerVisits", () => {
  it("summarises every room in one pass", async () => {
    const { items } = await callerFor(a).analytics.documentsSummary({
      kind: "DATA_ROOM",
    });
    const mine = items.find((i) => i.publicId === roomPublicId);
    expect(mine).toMatchObject({ viewers: 2, visits: 3, unopened: 1 });
    expect(mine?.spark).toHaveLength(30);
    expect(items.find((i) => i.publicId === bRoomPublicId)).toBeUndefined();
  });

  it("lists one viewer's visits, and nothing for a foreign recipient", async () => {
    const mine = await callerFor(a).analytics.viewerVisits({
      kind: "DATA_ROOM",
      targetPublicId: roomPublicId,
      recipientId: ann,
    });
    expect(mine.items).toHaveLength(3); // two in range plus the old one, bots excluded
    const foreign = await callerFor(a).analytics.viewerVisits({
      kind: "DATA_ROOM",
      targetPublicId: roomPublicId,
      recipientId: bRecipientId,
    });
    expect(foreign.items).toEqual([]);
  });
});

describe("analytics.document in the company timezone", () => {
  it("puts a 23:30 UTC visit into the next day's bucket in Auckland", async () => {
    const t = await seedTenant("an-tz");
    try {
      await db.company.update({
        where: { id: t.companyId },
        data: { timezone: "Pacific/Auckland" },
      });
      const r = await room(t, "TZ room", []);
      const rec = await db.dataRoomRecipient.create({
        data: { dataRoomId: r.id, name: "Tz", email: "tz@x.io" },
      });
      // 23:30 UTC two days ago is the next calendar day in Auckland (+12/+13)
      const at = new Date(Date.now() - 2 * DAY);
      at.setUTCHours(23, 30, 0, 0);
      await visit(t, r.id, rec.id, { createdAt: at, activeSeconds: 5 });
      const utcDay = at.toISOString().slice(0, 10);
      const nextDay = new Date(at.getTime() + DAY).toISOString().slice(0, 10);

      const res = await callerFor(t).analytics.document({
        kind: "DATA_ROOM",
        targetPublicId: r.publicId,
        range: "7d",
      });
      expect(res?.series).toHaveLength(7);
      expect(res?.series.find((p) => p.day === nextDay)?.visits).toBe(1);
      expect(res?.series.find((p) => p.day === utcDay)?.visits ?? 0).toBe(0);
    } finally {
      await cleanupTenants(t);
    }
  });
});
