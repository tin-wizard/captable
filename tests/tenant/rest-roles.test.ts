import { createSecureHash } from "@/lib/crypto";
import api from "@/server/api";
import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
  snapshotB,
} from "../helpers/tenant-fixtures";

/**
 * REST (Hono) roles: the membership the auth middleware verified must also
 * hold the RBAC grant, as in tRPC. A user-scoped API token works in every
 * company its owner is an active member of, so it carries that member's role
 * in each company, not the owner's best role anywhere.
 *
 * Owner of `aToken`: ADMIN in A, member with NO role in B.
 * Owner of `readerToken`: custom role in B with only stakeholder:read.
 */

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let aToken: string;
let readerToken: string;
let noRoleInB: { memberId: string };
const users: string[] = [];

async function token(userId: string) {
  const clientId = `api_roles${nanoid(10).replace(/[^a-zA-Z0-9]/g, "x")}`;
  const secret = `s${nanoid(24).replace(/[^a-zA-Z0-9]/g, "x")}`;
  await db.accessToken.create({
    data: { userId, clientId, clientSecret: createSecureHash(secret) },
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

// cookie auth works only without a body (known bug): GET and DELETE
async function withSession(path: string, method: "GET" | "DELETE") {
  process.env.NEXTAUTH_URL ||= "http://localhost:3000";
  const session = {
    ...a.session,
    user: {
      ...a.session.user,
      companyId: b.companyId,
      memberId: noRoleInB.memberId,
    },
  };
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(session)));
  try {
    return await api.request(`/api/v1${path}`, {
      method,
      headers: {
        cookie: "next-auth.session-token=x",
        Authorization: "Bearer cookie",
      },
    });
  } finally {
    spy.mockRestore();
  }
}

const stakeholderBody = (name: string) => ({
  name,
  email: `${name.replace(/\W/g, "-")}-${nanoid(6)}@example.com`,
  stakeholderType: "INDIVIDUAL",
  currentRelationship: "EMPLOYEE",
});

const shareBody = (stakeholderId: string, shareClassId: string) => ({
  status: "ACTIVE",
  certificateId: "rest-roles-cert",
  quantity: 5,
  cliffYears: 0,
  vestingYears: 0,
  companyLegends: [],
  issueDate: "2024-01-01T00:00:00.000Z",
  boardApprovalDate: "2024-01-01T00:00:00.000Z",
  stakeholderId,
  shareClassId,
});

// every write by a caller without the grant: 403 and B unchanged
async function expect403(run: () => Promise<Response>) {
  const before = await snapshotB(bIds);
  const res = await run();
  expect(res.status, await res.clone().text()).toBe(403);
  expect(await snapshotB(bIds)).toEqual(before);
}

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);

  const m = await db.member.create({
    data: {
      userId: a.userId,
      companyId: b.companyId,
      role: null,
      status: "ACTIVE",
      isOnboarded: true,
    },
  });
  noRoleInB = { memberId: m.id };
  aToken = await token(a.userId);

  const reader = await db.user.create({
    data: {
      name: "stakeholder reader",
      email: `reader-${nanoid(8)}@example.com`,
      emailVerified: new Date(),
    },
  });
  users.push(reader.id);
  const readerRole = await db.customRole.create({
    data: {
      companyId: b.companyId,
      name: "stakeholder reader",
      permissions: [{ subject: "stakeholder", actions: ["read"] }],
    },
  });
  await db.member.create({
    data: {
      userId: reader.id,
      companyId: b.companyId,
      role: "CUSTOM",
      customRoleId: readerRole.id,
      status: "ACTIVE",
      isOnboarded: true,
    },
  });
  readerToken = await token(reader.id);
});

afterAll(async () => {
  await db.accessToken.deleteMany({
    where: { userId: { in: [a.userId, ...users] } },
  });
  await cleanupFixtures(aIds, bIds, [a, b]);
  await db.user.deleteMany({ where: { id: { in: users } } });
});

describe("REST roles: one token, two companies", () => {
  it("is ADMIN in A: creates and lists stakeholders (control)", async () => {
    const res = await call(`/${a.companyId}/stakeholders`, aToken, {
      method: "POST",
      body: [stakeholderBody("rest roles")],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const list = await call(`/${a.companyId}/stakeholders?limit=50`, aToken);
    expect(list.status).toBe(200);
  });

  it("has no role in B: stakeholder reads and writes are 403", async () => {
    const s = `/${b.companyId}/stakeholders`;
    const one = `${s}/${bIds.stakeholderId}`;
    await expect403(() => call(`${s}?limit=50`, aToken));
    await expect403(() => call(one, aToken));
    await expect403(() =>
      call(s, aToken, {
        method: "POST",
        body: [stakeholderBody("x")],
      }),
    );
    await expect403(() =>
      call(one, aToken, { method: "PATCH", body: { name: "pwned" } }),
    );
    await expect403(() => call(one, aToken, { method: "DELETE" }));
  });

  it("has no role in B: share writes are 403, share reads stay open", async () => {
    const s = `/${b.companyId}/shares`;
    const one = `${s}/${bIds.shareId}`;
    await expect403(() =>
      call(s, aToken, {
        method: "POST",
        body: shareBody(bIds.stakeholderId, bIds.shareClassId),
      }),
    );
    await expect403(() =>
      call(one, aToken, { method: "PATCH", body: { quantity: 999 } }),
    );
    await expect403(() => call(one, aToken, { method: "DELETE" }));
    expect((await call(`${s}?limit=50`, aToken)).status).toBe(200);
    expect((await call(one, aToken)).status).toBe(200);
  });
});

describe("REST roles: session cookie", () => {
  it("a member with no role cannot DELETE a share or a stakeholder", async () => {
    await expect403(() =>
      withSession(`/${b.companyId}/shares/${bIds.shareId}`, "DELETE"),
    );
    await expect403(() =>
      withSession(
        `/${b.companyId}/stakeholders/${bIds.stakeholderId}`,
        "DELETE",
      ),
    );
  });

  it("a member with no role cannot GET stakeholders", async () => {
    await expect403(() =>
      withSession(`/${b.companyId}/stakeholders?limit=50`, "GET"),
    );
  });
});

describe("REST roles: custom role with only stakeholder:read", () => {
  it("can GET stakeholders", async () => {
    const s = `/${b.companyId}/stakeholders`;
    expect((await call(`${s}?limit=50`, readerToken)).status).toBe(200);
    expect((await call(`${s}/${bIds.stakeholderId}`, readerToken)).status).toBe(
      200,
    );
  });

  it("cannot POST, PATCH or DELETE stakeholders", async () => {
    const s = `/${b.companyId}/stakeholders`;
    const one = `${s}/${bIds.stakeholderId}`;
    await expect403(() =>
      call(s, readerToken, {
        method: "POST",
        body: [stakeholderBody("x")],
      }),
    );
    await expect403(() =>
      call(one, readerToken, { method: "PATCH", body: { name: "pwned" } }),
    );
    await expect403(() => call(one, readerToken, { method: "DELETE" }));
  });
});
