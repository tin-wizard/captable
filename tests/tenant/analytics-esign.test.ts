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
 * analytics.esign / esignEnvelope over hand-built envelopes with known audit
 * timestamps: funnel, time to sign, stuck, filters, pagination, permissions.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const at = (daysAgo: number, plusHours = 0) =>
  new Date(NOW - daysAgo * DAY + plusHours * HOUR);

let a: Tenant;
let b: Tenant;
let empty: Tenant;
const extraUsers: string[] = [];
let bucketA: string;
const ids: Record<string, string> = {};
const pub: Record<string, string> = {};
let bPublicId: string;

async function envelope(
  t: Tenant,
  bucketId: string,
  key: string,
  name: string,
  status: "DRAFT" | "PENDING" | "COMPLETE" | "CANCELLED",
  createdAt: Date,
  completedOn?: Date,
) {
  const tpl = await db.template.create({
    data: {
      companyId: t.companyId,
      bucketId,
      uploaderId: t.memberId,
      name,
      publicId: nanoid(10),
      status,
      createdAt,
      completedOn,
    },
  });
  ids[key] = tpl.id;
  pub[key] = tpl.publicId;
  return tpl;
}

async function signer(
  t: Tenant,
  templateId: string,
  name: string,
  status: "PENDING" | "SENT" | "SIGNED",
  events: { sent?: Date; viewed?: Date; signed?: Date },
) {
  const r = await db.esignRecipient.create({
    data: { templateId, name, email: `${name.toLowerCase()}@x.io`, status },
  });
  const audit = (action: string, occurredAt: Date) =>
    db.esignAudit.create({
      data: {
        companyId: t.companyId,
        templateId,
        recipientId: r.id,
        action,
        occurredAt,
        ip: "1.1.1.1",
        userAgent: "ua",
        location: "",
        summary: `${name} ${action}`,
      },
    });
  if (events.sent) await audit("document.email.sent", events.sent);
  if (events.viewed) await audit("recipient.viewed", events.viewed);
  if (events.signed) await audit("recipient.signed", events.signed);
  return r.id;
}

async function memberWith(permissions: object[]) {
  const user = await db.user.create({
    data: {
      name: "es member",
      email: `es-${nanoid(8)}@example.com`,
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
  a = await seedTenant("es-a");
  b = await seedTenant("es-b");
  empty = await seedTenant("es-empty");
  const bucket = (t: Tenant) =>
    db.bucket
      .create({
        data: {
          companyId: t.companyId,
          name: "f.pdf",
          key: nanoid(8),
          mimeType: "application/pdf",
          size: 1,
          tags: [],
        },
      })
      .then((x) => x.id);
  bucketA = await bucket(a);

  // E1 complete: Ann signs after 2 h, Ben after 30 h
  const s1 = at(9);
  await envelope(a, bucketA, "e1", "NDA signed", "COMPLETE", at(9), at(9, 30));
  await signer(a, ids.e1 as string, "Ann", "SIGNED", {
    sent: s1,
    viewed: at(9, 1),
    signed: at(9, 2),
  });
  await signer(a, ids.e1 as string, "Ben", "SIGNED", {
    sent: s1,
    viewed: at(9, 20),
    signed: at(9, 30),
  });
  // E2 pending: Cy has not signed for 5 days; Dee signed after 1 h
  const s2 = at(5);
  await envelope(a, bucketA, "e2", "Offer letter", "PENDING", at(5));
  await signer(a, ids.e2 as string, "Cy", "SENT", { sent: s2 });
  await signer(a, ids.e2 as string, "Dee", "SIGNED", {
    sent: s2,
    viewed: at(5, 0.5),
    signed: at(5, 1),
  });
  // E3 draft
  await envelope(a, bucketA, "e3", "Draft consulting", "DRAFT", at(3));
  // E4 pending, sent yesterday
  await envelope(a, bucketA, "e4", "Board consent", "PENDING", at(1));
  await signer(a, ids.e4 as string, "Eve", "SENT", { sent: at(1) });
  // previous period: completed, one signer after 10 h
  await envelope(
    a,
    bucketA,
    "old",
    "Old contract",
    "COMPLETE",
    at(40),
    at(40, 10),
  );
  await signer(a, ids.old as string, "Old", "SIGNED", {
    sent: at(40),
    signed: at(40, 10),
  });

  // tenant B
  const bb = await bucket(b);
  const be = await envelope(b, bb, "b1", "SecretB contract", "PENDING", at(2));
  bPublicId = be.publicId;
  await signer(b, ids.b1 as string, "Bea", "SENT", { sent: at(2) });
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await cleanupTenants(a, b, empty);
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
});

const q = (over: object = {}) => callerFor(a).analytics.esign(over);

describe("analytics.esign", () => {
  it("computes KPIs, time to sign and the previous period", async () => {
    const { kpis } = await q();
    expect(kpis.sent).toBe(3);
    expect(kpis.completed).toBe(1);
    expect(kpis.completionRate).toBeCloseTo(1 / 3);
    expect(kpis.medianHoursToSign).toBeCloseTo(2);
    expect(kpis.avgHoursToSign).toBeCloseTo(11);
    expect(kpis.pendingSigners).toBe(2); // Cy and Eve
    expect(kpis.stuckSigners).toBe(1); // Cy, 5 days
    expect(kpis.previous).toMatchObject({ sent: 1, completed: 1 });
    expect(kpis.previous.medianHoursToSign).toBeCloseTo(10);
  });

  it("builds the funnel, status mix and slowest signers", async () => {
    const r = await q();
    expect(r.funnel).toEqual({ sent: 5, viewed: 3, signed: 3, completed: 1 });
    expect(r.statusMix).toMatchObject({
      COMPLETE: 1,
      PENDING: 2,
      DRAFT: 1,
      CANCELLED: 0,
    });
    expect(r.slowest[0]).toMatchObject({ email: "ben@x.io", signed: 1 });
    expect(r.slowest[0]?.medianHours).toBeCloseTo(30);
    expect(r.series).toHaveLength(30);
    expect(r.series.reduce((n, d) => n + d.sent, 0)).toBe(3);
    expect(r.series.reduce((n, d) => n + d.completed, 0)).toBe(1);
  });

  it("lists envelopes newest first with who they wait on", async () => {
    const { envelopes } = await q();
    expect(envelopes.items.map((e) => e.name)).toEqual([
      "Board consent",
      "Draft consulting",
      "Offer letter",
      "NDA signed",
    ]);
    const offer = envelopes.items.find((e) => e.name === "Offer letter");
    expect(offer?.signers).toEqual({ signed: 1, total: 2 });
    expect(offer?.stuck).toBe(true);
    expect(offer?.waitingOn.map((w) => w.email)).toEqual(["cy@x.io"]);
    expect(offer?.waitingOn[0]?.waitingDays).toBeCloseTo(5, 0);
    const nda = envelopes.items.find((e) => e.name === "NDA signed");
    expect(nda?.hoursToComplete).toBeCloseTo(30);
  });

  it("filters by status, stuck, signer and name", async () => {
    const names = async (over: object) =>
      (await q(over)).envelopes.items.map((e) => e.name);
    expect(await names({ status: ["COMPLETE"] })).toEqual(["NDA signed"]);
    expect(await names({ stuck: true })).toEqual(["Offer letter"]);
    expect(await names({ signer: "BEN" })).toEqual(["NDA signed"]);
    expect(await names({ search: "board" })).toEqual(["Board consent"]);
  });

  it("paginates without gaps and refuses a foreign cursor", async () => {
    const p1 = await q({ limit: 2 });
    expect(p1.envelopes.items).toHaveLength(2);
    expect(p1.envelopes.nextCursor).not.toBeNull();
    const p2 = await q({ limit: 2, cursor: p1.envelopes.nextCursor });
    expect(p2.envelopes.items.map((e) => e.name)).toEqual([
      "Offer letter",
      "NDA signed",
    ]);
    expect(p2.envelopes.nextCursor).toBeNull();
    const foreign = await q({ cursor: ids.b1 });
    expect(foreign.envelopes.items).toEqual([]);
  });

  it("never includes another company's envelopes", async () => {
    expect(JSON.stringify(await q())).not.toContain("SecretB");
  });

  it("hides view data without audits:read and refuses without templates:read", async () => {
    const tpl = await memberWith([{ subject: "templates", actions: ["read"] }]);
    const r = await tpl.analytics.esign({});
    expect(r.canSeeViews).toBe(false);
    expect(r.funnel.viewed).toBeNull();
    const none = await memberWith([{ subject: "audits", actions: ["read"] }]);
    await expect(none.analytics.esign({})).rejects.toThrow();
  });

  it("returns zeros for a company with no envelopes", async () => {
    const r = await callerFor(empty).analytics.esign({ range: "7d" });
    expect(r.kpis.completionRate).toBeNull();
    expect(r.kpis.medianHoursToSign).toBeNull();
  });
});

describe("analytics.esignEnvelope", () => {
  it("returns signer timing and the audit timeline", async () => {
    const d = await callerFor(a).analytics.esignEnvelope({
      templatePublicId: pub.e2 as string,
    });
    expect(d?.signers.find((s) => s.name === "Dee")?.hoursToSign).toBeCloseTo(
      1,
    );
    expect(d?.signers.find((s) => s.name === "Cy")?.waitingDays).toBeCloseTo(
      5,
      0,
    );
    expect(d?.timeline.length).toBeGreaterThan(0);
  });

  it("is null for another company's envelope and hides the timeline without audits:read", async () => {
    expect(
      await callerFor(a).analytics.esignEnvelope({
        templatePublicId: bPublicId,
      }),
    ).toBeNull();
    const tpl = await memberWith([{ subject: "templates", actions: ["read"] }]);
    const d = await tpl.analytics.esignEnvelope({
      templatePublicId: pub.e2 as string,
    });
    expect(d?.timeline).toEqual([]);
    expect(d?.signers.every((s) => s.viewedAt === null)).toBe(true);
  });
});
