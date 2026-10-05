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
async function cookie(
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(a.session)));
  try {
    return await api.request(`/api/v1${path}`, {
      method,
      headers: {
        cookie: "next-auth.session-token=x",
        ...(body !== undefined && { "content-type": "application/json" }),
        ...extra,
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

// cookies are ambient credentials: a cookie-authenticated write must come from
// the app's own origin; bearer callers are unaffected
describe("REST cookie writes from another origin (CSRF)", () => {
  const appOrigin = () => new URL(process.env.NEXTAUTH_URL as string).origin;
  const evil = "https://evil.example";
  const holder = () => [
    {
      name: "csrf holder",
      email: `csrf-${nanoid(6)}@example.com`,
      stakeholderType: "INDIVIDUAL",
      currentRelationship: "EMPLOYEE",
    },
  ];
  const post = (extra: Record<string, string>) => {
    const body = holder();
    return {
      email: body[0]?.email as string,
      res: cookie(`/${a.companyId}/stakeholders`, "POST", body, extra),
    };
  };
  const rows = (email: string) => db.stakeholder.count({ where: { email } });

  it("a POST with the app's Origin succeeds", async () => {
    const { email, res } = post({ origin: appOrigin() });
    expect((await res).status).toBe(200);
    expect(await rows(email)).toBe(1);
  });

  it("a POST with a foreign Origin is 403 and creates nothing", async () => {
    const { email, res } = post({ origin: evil });
    const r = await res;
    expect(r.status, await r.clone().text()).toBe(403);
    expect(await r.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(await rows(email)).toBe(0);
  });

  it("a POST with Sec-Fetch-Site: cross-site is 403 and creates nothing", async () => {
    const { email, res } = post({ "sec-fetch-site": "cross-site" });
    expect((await res).status).toBe(403);
    expect(await rows(email)).toBe(0);
  });

  it("a PATCH with a foreign Origin is 403", async () => {
    const res = await cookie(
      `/${a.companyId}/stakeholders/${aIds.stakeholderId}`,
      "PATCH",
      { name: "csrf patched" },
      { origin: evil },
    );
    expect(res.status).toBe(403);
    const row = await db.stakeholder.findUniqueOrThrow({
      where: { id: aIds.stakeholderId },
    });
    expect(row.name).not.toBe("csrf patched");
  });

  it("a POST with neither header (non-browser client) succeeds", async () => {
    const { email, res } = post({});
    expect((await res).status).toBe(200);
    expect(await rows(email)).toBe(1);
  });

  it("a GET with a foreign Origin still works", async () => {
    const res = await cookie(`/${a.companyId}/stakeholders`, "GET", undefined, {
      origin: evil,
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(200);
  });

  it("a bearer POST with a foreign Origin still works", async () => {
    const clientId = `api_csrf${nanoid(10).replace(/[^a-zA-Z0-9]/g, "x")}`;
    const secret = `s${nanoid(24).replace(/[^a-zA-Z0-9]/g, "x")}`;
    await db.accessToken.create({
      data: {
        userId: a.userId,
        clientId,
        clientSecret: createSecureHash(secret),
      },
    });
    try {
      const body = holder();
      const res = await api.request(`/api/v1/${a.companyId}/stakeholders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clientId}:${secret}`,
          "content-type": "application/json",
          origin: evil,
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify(body),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(await rows(body[0]?.email as string)).toBe(1);
    } finally {
      await db.accessToken.deleteMany({ where: { clientId } });
    }
  });
});
