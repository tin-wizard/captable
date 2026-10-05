import { createSecureHash } from "@/lib/crypto";
import api from "@/server/api";
import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  B_SECRET,
  cleanupFixtures,
  leaksToB,
  seedTenantA,
  seedTenantB,
  snapshotB,
} from "../helpers/tenant-fixtures";

/**
 * REST (Hono) isolation: tenant A's credentials against tenant B's companyId
 * and B's row ids. Drives the real app in-process via app.request().
 */

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let aToken: string;
let expiredToken: string;
let pendingToken: string;
let aShareId: string;

async function token(userId: string, expiresAt: Date | null = null) {
  const clientId = `api_rest${nanoid(10).replace(/[^a-zA-Z0-9]/g, "x")}`;
  const secret = `s${nanoid(24).replace(/[^a-zA-Z0-9]/g, "x")}`;
  await db.accessToken.create({
    data: {
      userId,
      clientId,
      clientSecret: createSecureHash(secret),
      expiresAt,
    },
  });
  return `${clientId}:${secret}`;
}

async function call(
  path: string,
  bearer: string,
  init: { method?: string; body?: unknown } = {},
) {
  return await api.request(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
}

const shareBody = (stakeholderId: string, shareClassId: string) => ({
  status: "ACTIVE",
  certificateId: "rest-cert",
  quantity: 5,
  cliffYears: 0,
  vestingYears: 0,
  companyLegends: [],
  issueDate: "2024-01-01T00:00:00.000Z",
  boardApprovalDate: "2024-01-01T00:00:00.000Z",
  stakeholderId,
  shareClassId,
});

async function expectBUntouched(run: () => Promise<Response>) {
  const before = await snapshotB(bIds);
  const res = await run();
  const text = await res.text();
  expect(text).not.toContain(B_SECRET);
  expect(await snapshotB(bIds)).toEqual(before);
  expect(Object.values(await leaksToB(bIds)).every((n) => n === 0)).toBe(true);
  return { status: res.status, text };
}

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  aToken = await token(a.userId);
  expiredToken = await token(a.userId, new Date("2020-01-01"));
  pendingToken = await token(bIds.userIds[2] as string);
});

afterAll(async () => {
  await db.accessToken.deleteMany({ where: { userId: a.userId } });
  await cleanupFixtures(aIds, bIds, [a, b]);
});

describe("REST bearer: own tenant (controls)", () => {
  it("lists only A's stakeholders", async () => {
    const res = await call(`/${a.companyId}/stakeholders?limit=50`, aToken);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(aIds.stakeholderId);
    expect(text).not.toContain(B_SECRET);
    expect(text).not.toContain(bIds.stakeholderId);
  });

  it("creates a share for A's own stakeholder and share class", async () => {
    const res = await call(`/${a.companyId}/shares`, aToken, {
      method: "POST",
      body: shareBody(aIds.stakeholderId, aIds.shareClassId),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { id: string } };
    const share = await db.share.findUniqueOrThrow({ where: { id: data.id } });
    expect(share.companyId).toBe(a.companyId);
    aShareId = share.id;
  });

  it("lists and reads A's share", async () => {
    const list = await call(`/${a.companyId}/shares?limit=50`, aToken);
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).toContain(aShareId);
    expect(text).not.toContain(B_SECRET);
    const one = await call(`/${a.companyId}/shares/${aShareId}`, aToken);
    expect(one.status).toBe(200);
  });

  it("updates A's share at PATCH /shares/{id}", async () => {
    const res = await call(`/${a.companyId}/shares/${aShareId}`, aToken, {
      method: "PATCH",
      body: { quantity: 7 },
    });
    expect(res.status).toBe(200);
    const share = await db.share.findUniqueOrThrow({ where: { id: aShareId } });
    expect(share.quantity).toBe(7);
  });

  it("updates A's stakeholder at PATCH /stakeholders/{id}", async () => {
    const res = await call(
      `/${a.companyId}/stakeholders/${aIds.stakeholderId}`,
      aToken,
      { method: "PATCH", body: { name: "tenant-a renamed" } },
    );
    expect(res.status).toBe(200);
    const s = await db.stakeholder.findUniqueOrThrow({
      where: { id: aIds.stakeholderId },
    });
    expect(s.name).toBe("tenant-a renamed");
  });

  it("GET /companies lists only A's companies", async () => {
    const res = await call("/companies", aToken);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { id: string }[]).map((c) => c.id);
    expect(ids).toEqual([a.companyId]);
  });

  it("GET /companies/{A} returns A", async () => {
    const res = await call(`/companies/${a.companyId}`, aToken);
    expect(res.status).toBe(200);
  });
});

describe("REST bearer: A's token against B", () => {
  it.each([
    ["stakeholders", "/stakeholders"],
    ["shares", "/shares"],
  ])("B's companyId in the path is rejected (%s)", async (_n, suffix) => {
    const { status } = await expectBUntouched(() =>
      call(`/${b.companyId}${suffix}`, aToken),
    );
    expect(status).toBe(401);
  });

  it("GET /companies/{B} is not authorized", async () => {
    const { status } = await expectBUntouched(() =>
      call(`/companies/${b.companyId}`, aToken),
    );
    expect(status).toBe(401);
  });

  it("reads B's stakeholder and share by id under A's path: not found", async () => {
    for (const p of [
      `/stakeholders/${bIds.stakeholderId}`,
      `/shares/${bIds.shareId}`,
    ]) {
      const { status } = await expectBUntouched(() =>
        call(`/${a.companyId}${p}`, aToken),
      );
      expect(status).toBe(404);
    }
  });

  it("PATCH B's stakeholder under A's path: not found, B unchanged", async () => {
    const { status } = await expectBUntouched(() =>
      call(`/${a.companyId}/stakeholders/${bIds.stakeholderId}`, aToken, {
        method: "PATCH",
        body: { name: "pwned" },
      }),
    );
    expect(status).toBe(404);
  });

  it("PATCH B's share under A's path: not found, B unchanged", async () => {
    const { status } = await expectBUntouched(() =>
      call(`/${a.companyId}/shares/${bIds.shareId}`, aToken, {
        method: "PATCH",
        body: { quantity: 999 },
      }),
    );
    expect(status).toBe(404);
  });

  it("DELETE B's stakeholder and share under A's path: not found, B unchanged", async () => {
    for (const p of [
      `/stakeholders/${bIds.stakeholderId}`,
      `/shares/${bIds.shareId}`,
    ]) {
      const { status } = await expectBUntouched(() =>
        call(`/${a.companyId}${p}`, aToken, { method: "DELETE" }),
      );
      expect(status).toBe(404);
    }
  });

  it("POST a share referencing B's stakeholder/share class: rejected", async () => {
    for (const body of [
      shareBody(bIds.stakeholderId, aIds.shareClassId),
      shareBody(aIds.stakeholderId, bIds.shareClassId),
    ]) {
      const { status } = await expectBUntouched(() =>
        call(`/${a.companyId}/shares`, aToken, { method: "POST", body }),
      );
      expect(status).not.toBe(200);
    }
  });

  it("PATCH A's share to point at B's stakeholder/share class: rejected", async () => {
    for (const body of [
      { stakeholderId: bIds.stakeholderId },
      { shareClassId: bIds.shareClassId },
    ]) {
      const { status } = await expectBUntouched(() =>
        call(`/${a.companyId}/shares/${aShareId}`, aToken, {
          method: "PATCH",
          body,
        }),
      );
      expect(status).not.toBe(200);
    }
  });

  it("PATCH A's share with companyId=B does not move it into B", async () => {
    await expectBUntouched(() =>
      call(`/${a.companyId}/shares/${aShareId}`, aToken, {
        method: "PATCH",
        body: { quantity: 8, companyId: b.companyId },
      }),
    );
    const share = await db.share.findUniqueOrThrow({ where: { id: aShareId } });
    expect(share.companyId).toBe(a.companyId);
  });

  it("PATCH A's stakeholder with companyId=B does not move it into B", async () => {
    await expectBUntouched(() =>
      call(`/${a.companyId}/stakeholders/${aIds.stakeholderId}`, aToken, {
        method: "PATCH",
        body: { name: "tenant-a again", companyId: b.companyId },
      }),
    );
    const s = await db.stakeholder.findUniqueOrThrow({
      where: { id: aIds.stakeholderId },
    });
    expect(s.companyId).toBe(a.companyId);
  });
});

describe("REST bearer: token and membership state", () => {
  it("an inactive (PENDING) member's token is rejected", async () => {
    const { status } = await expectBUntouched(() =>
      call(`/${b.companyId}/stakeholders`, pendingToken),
    );
    expect(status).toBe(401);
  });

  it("an expired token is rejected", async () => {
    const res = await call(`/${a.companyId}/stakeholders`, expiredToken);
    expect(res.status).toBe(401);
  });

  it("a wrong secret is rejected", async () => {
    const [clientId] = aToken.split(":");
    const res = await call(`/${a.companyId}/stakeholders`, `${clientId}:nope`);
    expect(res.status).toBe(401);
  });
});

describe("REST session cookie", () => {
  // session-token.ts fetches the session from NEXTAUTH_URL; stub that fetch
  const withSession = async (path: string) => {
    process.env.NEXTAUTH_URL ||= "http://localhost:3000";
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(a.session)));
    try {
      return await api.request(`/api/v1${path}`, {
        // the route's header schema demands an Authorization header even on
        // the cookie path; a non-token value makes bearer auth fail if reached
        headers: {
          cookie: "next-auth.session-token=x",
          Authorization: "Bearer cookie",
        },
      });
    } finally {
      spy.mockRestore();
    }
  };

  it("A's session lists only A's stakeholders (control)", async () => {
    const res = await withSession(`/${a.companyId}/stakeholders?limit=50`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(aIds.stakeholderId);
    expect(text).not.toContain(B_SECRET);
  });

  it("A's session with B's companyId in the path is rejected", async () => {
    const { status } = await expectBUntouched(() =>
      withSession(`/${b.companyId}/stakeholders`),
    );
    expect(status).toBe(401);
  });
});
