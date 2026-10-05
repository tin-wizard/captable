import { createSecureHash } from "@/lib/crypto";
import api from "@/server/api";
import { getCompanyList } from "@/server/company";
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

// A PENDING or INACTIVE membership must not list its company (switcher, REST).
let a: Tenant;
let b: Tenant;
let userId: string;
let bearer: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  const user = await db.user.create({
    data: { name: "multi", email: `multi-${Date.now()}@example.com` },
  });
  userId = user.id;
  await db.member.create({
    data: {
      userId,
      companyId: a.companyId,
      status: "ACTIVE",
      isOnboarded: true,
    },
  });
  await db.member.create({
    data: {
      userId,
      companyId: b.companyId,
      status: "PENDING",
      isOnboarded: false,
    },
  });
  const clientId = `api_list${Date.now()}`;
  await db.accessToken.create({
    data: { userId, clientId, clientSecret: createSecureHash("sec") },
  });
  bearer = `${clientId}:sec`;
});

afterAll(async () => {
  await db.accessToken.deleteMany({ where: { userId } });
  await cleanupTenants(a, b);
  await db.user.deleteMany({ where: { id: userId } });
});

describe("listing the caller's companies", () => {
  it("getCompanyList lists only the ACTIVE membership's company", async () => {
    const list = await getCompanyList(userId);
    expect(list.map((m) => m.company.id)).toEqual([a.companyId]);
  });

  it("GET /companies lists only the ACTIVE membership's company", async () => {
    const res = await api.request("/api/v1/companies", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { id: string }[]).map((c) => c.id);
    expect(ids).toEqual([a.companyId]);
  });
});
