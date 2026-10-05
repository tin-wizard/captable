import { createSecureHash } from "@/lib/crypto";
import api from "@/server/api";
import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant-db";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type Tenant,
  callerFor,
  cleanupTenants,
  seedTwoTenants,
} from "../helpers/seed";

// Stakeholder.email is unique per company, not globally (F7): one person can
// hold stakes in two companies, and a duplicate in another tenant is neither
// refused nor revealed. A duplicate inside one company is still refused.

let a: Tenant;
let b: Tenant;
const tokens: Record<string, string> = {};

async function token(userId: string) {
  const clientId = `api_se${nanoid(10).replace(/[^a-zA-Z0-9]/g, "x")}`;
  const secret = `s${nanoid(24).replace(/[^a-zA-Z0-9]/g, "x")}`;
  await db.accessToken.create({
    data: { userId, clientId, clientSecret: createSecureHash(secret) },
  });
  return `${clientId}:${secret}`;
}

const restCreate = (t: Tenant, email: string) =>
  api.request(`/api/v1/${t.companyId}/stakeholders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens[t.userId]}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      {
        name: "rest holder",
        email,
        stakeholderType: "INDIVIDUAL",
        currentRelationship: "EMPLOYEE",
      },
    ]),
  });

const trpcAdd = (t: Tenant, email: string) =>
  callerFor(t).stakeholder.addStakeholders([
    {
      name: "trpc holder",
      email,
      stakeholderType: "INDIVIDUAL",
      currentRelationship: "EMPLOYEE",
    },
  ]);

const rowsIn = (t: Tenant, email: string) =>
  db.stakeholder.count({ where: { companyId: t.companyId, email } });

const freshEmail = () => `shared-${nanoid(8)}@example.com`;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  for (const t of [a, b]) tokens[t.userId] = await token(t.userId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.accessToken.deleteMany({
    where: { userId: { in: [a.userId, b.userId] } },
  });
  await cleanupTenants(a, b);
});

describe("the same email in two companies", () => {
  it("is accepted by stakeholder.addStakeholders in each company", async () => {
    const email = freshEmail();
    expect((await trpcAdd(a, email)).success).toBe(true);
    expect((await trpcAdd(b, email)).success).toBe(true);
    expect(await rowsIn(a, email)).toBe(1);
    expect(await rowsIn(b, email)).toBe(1);
  });

  it("is accepted by REST POST /stakeholders in each company", async () => {
    const email = freshEmail();
    expect((await restCreate(a, email)).status).toBe(200);
    expect((await restCreate(b, email)).status).toBe(200);
    expect(await rowsIn(a, email)).toBe(1);
    expect(await rowsIn(b, email)).toBe(1);
  });

  it("is accepted at the Prisma level", async () => {
    const email = freshEmail();
    for (const t of [a, b]) {
      await db.stakeholder.create({
        data: { companyId: t.companyId, name: "prisma holder", email },
      });
    }
    expect(await db.stakeholder.count({ where: { email } })).toBe(2);
  });
});

describe("a duplicate email inside one company", () => {
  it("addStakeholders skips it, as before (no second row)", async () => {
    const email = freshEmail();
    expect((await trpcAdd(a, email)).success).toBe(true);
    expect((await trpcAdd(a, email)).success).toBe(true);
    expect(await rowsIn(a, email)).toBe(1);
  });

  it("REST refuses it with 409 NOT_UNIQUE", async () => {
    const email = freshEmail();
    expect((await restCreate(a, email)).status).toBe(200);
    const res = await restCreate(a, email);
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({
      error: {
        code: "NOT_UNIQUE",
        message: "A stakeholder with this email already exists in this company",
      },
    });
    expect(body).not.toContain(email);
    expect(await rowsIn(a, email)).toBe(1);
  });

  it("addStakeholders audits each created stakeholder by its id, and not a skipped duplicate", async () => {
    const dup = freshEmail();
    expect((await trpcAdd(a, dup)).success).toBe(true);
    const fresh = freshEmail();
    const where = { companyId: a.companyId, action: "stakeholder.added" };
    const seen = (await db.audit.findMany({ where })).map((r) => r.id);
    const res = await callerFor(a).stakeholder.addStakeholders(
      [dup, fresh].map((email) => ({
        name: "audited holder",
        email,
        stakeholderType: "INDIVIDUAL" as const,
        currentRelationship: "EMPLOYEE" as const,
      })),
    );
    expect(res.success).toBe(true);
    const created = await db.stakeholder.findFirstOrThrow({
      where: { companyId: a.companyId, email: fresh },
    });
    const rows = await db.audit.findMany({
      where: { ...where, id: { notIn: seen } },
    });
    expect(rows.map((r) => r.target)).toEqual([
      [{ type: "stakeholder", id: created.id }],
    ]);
  });

  it("Prisma refuses it with a unique violation on (companyId, email)", async () => {
    const email = freshEmail();
    const data = { companyId: a.companyId, name: "dup", email };
    await db.stakeholder.create({ data });
    await expect(db.stakeholder.create({ data })).rejects.toMatchObject({
      code: "P2002",
      meta: { target: ["companyId", "email"] },
    });
  });
});

describe("looking a stakeholder up by email", () => {
  it("never returns another company's row through the tenant client", async () => {
    const email = freshEmail();
    const [inA, inB] = await Promise.all(
      [a, b].map((t) =>
        db.stakeholder.create({
          data: { companyId: t.companyId, name: "lookup", email },
        }),
      ),
    );
    const ta = tenantDb(db, a.companyId);
    expect((await ta.stakeholder.findFirst({ where: { email } }))?.id).toBe(
      inA?.id,
    );
    expect(await ta.stakeholder.findMany({ where: { email } })).toHaveLength(1);
    expect(
      (
        await ta.stakeholder.findUnique({
          where: { companyId_email: { companyId: a.companyId, email } },
        })
      )?.id,
    ).toBe(inA?.id);
    // B's compound key through A's tenant client: not visible
    expect(
      await ta.stakeholder.findUnique({
        where: { companyId_email: { companyId: b.companyId, email } },
      }),
    ).toBeNull();
    expect(inB?.companyId).toBe(b.companyId);
  });
});
