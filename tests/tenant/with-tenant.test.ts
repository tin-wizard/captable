import { db } from "@/server/db";
import {
  createTRPCRouter,
  withAccessControl,
  withTenant,
} from "@/trpc/api/trpc";
import type { Session } from "next-auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;
let bStakeholderId: string;

const probe = createTRPCRouter({
  tenant: withTenant.query(async ({ ctx }) => {
    const { db: _db, ...rest } = ctx.tenant;
    return {
      ...rest,
      own: await ctx.tenant.db.stakeholder.count(),
      other: await ctx.tenant.db.stakeholder.findFirst({
        where: { id: bStakeholderId },
      }),
    };
  }),
  acl: withAccessControl
    .meta({ policies: { billing: { allow: ["read"] } } })
    .query(({ ctx }) => ({
      membership: ctx.membership,
      permissions: ctx.permissions,
      tenantCompanyId: ctx.tenant.companyId,
    })),
});

const callAs = (session: Session) =>
  probe.createCaller({
    db,
    session,
    requestIp: "127.0.0.1",
    userAgent: "vitest",
    headers: new Headers(),
    host: { kind: "canonical" },
  });

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  await db.stakeholder.create({
    data: { companyId: a.companyId, name: "a", email: "wt-a@example.com" },
  });
  bStakeholderId = (
    await db.stakeholder.create({
      data: { companyId: b.companyId, name: "b", email: "wt-b@example.com" },
    })
  ).id;
});

afterAll(async () => {
  await cleanupTenants(a, b);
});

describe("withTenant", () => {
  it("rejects an INACTIVE member", async () => {
    await db.member.update({
      where: { id: a.memberId },
      data: { status: "INACTIVE" },
    });
    try {
      await expect(callAs(a.session).tenant()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    } finally {
      await db.member.update({
        where: { id: a.memberId },
        data: { status: "ACTIVE" },
      });
    }
  });

  it("rejects a session whose companyId claim is not the member's company", async () => {
    const forged = {
      ...a.session,
      user: { ...a.session.user, companyId: b.companyId },
    };
    await expect(callAs(forged).tenant()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("gives a valid member ctx.tenant scoped to their company", async () => {
    const out = await callAs(a.session).tenant();
    expect(out).toEqual({
      companyId: a.companyId,
      memberId: a.memberId,
      role: "ADMIN",
      customRoleId: null,
      own: 1,
      other: null,
    });
  });
});

describe("withAccessControl on top of withTenant", () => {
  it("keeps membership and permissions on ctx", async () => {
    const out = await callAs(a.session).acl();
    expect(out.membership).toMatchObject({
      companyId: a.companyId,
      memberId: a.memberId,
      userId: a.userId,
      role: "ADMIN",
      customRoleId: null,
    });
    expect(out.permissions.length).toBeGreaterThan(0);
    expect(out.tenantCompanyId).toBe(a.companyId);
  });

  it("still rejects a forged company claim", async () => {
    const forged = {
      ...a.session,
      user: { ...a.session.user, companyId: b.companyId },
    };
    await expect(callAs(forged).acl()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "membership not found",
    });
  });
});
