import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Tenant,
  callerFor,
  cleanupTenants,
  seedTenant,
} from "../helpers/seed";

let a: Tenant;
let b: Tenant;
const extraUsers: string[] = [];

async function memberWith(permissions: object[]) {
  const user = await db.user.create({
    data: {
      name: "pref member",
      email: `pref-${nanoid(8)}@example.com`,
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
  a = await seedTenant("pref-a");
  b = await seedTenant("pref-b");
});

afterAll(async () => {
  await db.member.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.customRole.deleteMany({ where: { companyId: a.companyId } });
  await cleanupTenants(a, b);
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
});

const row = (t: Tenant) =>
  db.company.findUniqueOrThrow({ where: { id: t.companyId } });

describe("company.preferences / updatePreferences", () => {
  it("defaults to UTC and 24 months", async () => {
    expect(await callerFor(a).company.preferences()).toEqual({
      timezone: "UTC",
      viewRetentionMonths: 24,
      autoNudge: false,
      ndaText: null,
      showNameOnLogin: false,
    });
  });

  it("saves a valid timezone and retention", async () => {
    await callerFor(a).company.updatePreferences({
      timezone: "Europe/Berlin",
      viewRetentionMonths: 12,
    });
    expect(await row(a)).toMatchObject({
      timezone: "Europe/Berlin",
      viewRetentionMonths: 12,
    });
    expect(await callerFor(a).company.preferences()).toEqual({
      timezone: "Europe/Berlin",
      viewRetentionMonths: 12,
      autoNudge: false,
      ndaText: null,
      showNameOnLogin: false,
    });
    const audit = await db.audit.findFirst({
      where: { companyId: a.companyId, action: "company.updated" },
    });
    expect(audit?.summary).toContain("changed company preferences");
  });

  it("showNameOnLogin saves, audits, and is left alone when omitted", async () => {
    const base = { timezone: "UTC", viewRetentionMonths: 24 as const };
    const before = await db.audit.count({
      where: { companyId: a.companyId, action: "company.updated" },
    });
    await callerFor(a).company.updatePreferences({
      ...base,
      showNameOnLogin: true,
    });
    expect((await row(a)).showNameOnLogin).toBe(true);
    expect(
      await db.audit.count({
        where: { companyId: a.companyId, action: "company.updated" },
      }),
    ).toBe(before + 1);

    await callerFor(a).company.updatePreferences(base);
    expect((await row(a)).showNameOnLogin).toBe(true);
    expect((await row(b)).showNameOnLogin).toBe(false);

    const reader = await memberWith([
      { subject: "company", actions: ["read"] },
    ]);
    await expect(
      reader.company.updatePreferences({ ...base, showNameOnLogin: false }),
    ).rejects.toThrow();
    expect((await row(a)).showNameOnLogin).toBe(true);
  });

  it("null means keep forever", async () => {
    await callerFor(a).company.updatePreferences({
      timezone: "UTC",
      viewRetentionMonths: null,
    });
    expect((await row(a)).viewRetentionMonths).toBeNull();
  });

  it("rejects an unknown timezone and a retention that is not offered", async () => {
    await expect(
      callerFor(a).company.updatePreferences({
        timezone: "Mars/Phobos",
        viewRetentionMonths: 24,
      }),
    ).rejects.toThrow();
    await expect(
      callerFor(a).company.updatePreferences({
        timezone: "UTC",
        viewRetentionMonths: 7 as never,
      }),
    ).rejects.toThrow();
  });

  it("only changes the caller's company and needs company:update", async () => {
    const reader = await memberWith([
      { subject: "company", actions: ["read"] },
    ]);
    await expect(
      reader.company.updatePreferences({
        timezone: "Asia/Tokyo",
        viewRetentionMonths: 6,
      }),
    ).rejects.toThrow();
    expect((await row(a)).timezone).not.toBe("Asia/Tokyo");

    await callerFor(a).company.updatePreferences({
      timezone: "Asia/Tokyo",
      viewRetentionMonths: 6,
    });
    expect(await row(b)).toMatchObject({
      timezone: "UTC",
      viewRetentionMonths: 24,
    });
  });
});
