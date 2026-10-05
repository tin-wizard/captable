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
} from "../helpers/tenant-fixtures";

/** REST hygiene: cookie auth with a body, optional Authorization header, pagination limit. */

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;

beforeAll(async () => {
  process.env.NEXTAUTH_URL ||= "http://localhost:3000";
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

// cookie caller as A's ADMIN; NO Authorization header
async function cookie(path: string, method = "GET", body?: unknown) {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(a.session)));
  try {
    return await api.request(`/api/v1${path}`, {
      method,
      headers: {
        cookie: "next-auth.session-token=x",
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } finally {
    spy.mockRestore();
  }
}

describe("REST cookie auth with a body and no Authorization header", () => {
  let id: string;

  it("POST creates a stakeholder", async () => {
    const res = await cookie(`/${a.companyId}/stakeholders`, "POST", [
      {
        name: "cookie poster",
        email: `cookie-${nanoid(6)}@example.com`,
        stakeholderType: "INDIVIDUAL",
        currentRelationship: "EMPLOYEE",
      },
    ]);
    expect(res.status, await res.clone().text()).toBe(200);
    id = ((await res.json()) as { data: { id: string }[] }).data[0]
      ?.id as string;
    const row = await db.stakeholder.findUniqueOrThrow({ where: { id } });
    expect(row.companyId).toBe(a.companyId);
  });

  it("PATCH updates it", async () => {
    const res = await cookie(`/${a.companyId}/stakeholders/${id}`, "PATCH", {
      name: "cookie patched",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(
      (await db.stakeholder.findUniqueOrThrow({ where: { id } })).name,
    ).toBe("cookie patched");
  });
});

describe("REST credentials", () => {
  it("neither cookie nor bearer is 401", async () => {
    const res = await api.request(`/api/v1/${a.companyId}/stakeholders`);
    expect(res.status).toBe(401);
  });

  it("an invalid bearer is 401", async () => {
    const res = await api.request(`/api/v1/${a.companyId}/stakeholders`, {
      headers: { Authorization: "Bearer nope:nope" },
    });
    expect(res.status).toBe(401);
  });
});

describe("REST pagination limit", () => {
  it("defaults when ?limit is absent", async () => {
    const res = await cookie(`/${a.companyId}/stakeholders`);
    expect(res.status, await res.clone().text()).toBe(200);
    const { data } = (await res.json()) as { data: { id: string }[] };
    expect(data.some((s) => s.id === aIds.stakeholderId)).toBe(true);
  });

  it("limit=100 is accepted", async () => {
    const res = await cookie(`/${a.companyId}/stakeholders?limit=100`);
    expect(res.status).toBe(200);
  });

  it("limit=101 is 400", async () => {
    const res = await cookie(`/${a.companyId}/stakeholders?limit=101`);
    expect(res.status).toBe(400);
  });
});
