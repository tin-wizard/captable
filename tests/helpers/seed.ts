import { generatePublicId } from "@/common/id";
import { db } from "@/server/db";
import { appRouter } from "@/trpc/api/root";
import { nanoid } from "nanoid";
import type { Session } from "next-auth";

export type Tenant = {
  companyId: string;
  memberId: string;
  userId: string;
  session: Session;
};

async function seedTenant(label: string): Promise<Tenant> {
  const user = await db.user.create({
    data: {
      name: `${label} admin`,
      email: `${label}-${nanoid(8)}@example.com`,
      emailVerified: new Date(),
    },
  });
  const company = await db.company.create({
    data: {
      name: `${label} Inc`,
      publicId: generatePublicId(),
      incorporationType: "c-corp",
      incorporationDate: new Date("2020-01-01"),
      incorporationCountry: "US",
      incorporationState: "DE",
      streetAddress: "1 Main St",
      city: "Wilmington",
      state: "DE",
      zipcode: "19801",
      country: "US",
    },
  });
  const member = await db.member.create({
    data: {
      userId: user.id,
      companyId: company.id,
      role: "ADMIN",
      status: "ACTIVE",
      isOnboarded: true,
    },
  });

  return {
    companyId: company.id,
    memberId: member.id,
    userId: user.id,
    session: {
      expires: new Date(Date.now() + 3_600_000).toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isOnboarded: true,
        companyId: company.id,
        memberId: member.id,
        companyPublicId: company.publicId,
        status: "ACTIVE",
      },
    },
  };
}

export async function seedTwoTenants() {
  return { a: await seedTenant("a"), b: await seedTenant("b") };
}

export async function cleanupTenants(...tenants: Tenant[]) {
  for (const t of tenants) {
    // company cascades to every tenant-owned row
    await db.company.deleteMany({ where: { id: t.companyId } });
    await db.user.deleteMany({ where: { id: t.userId } });
  }
}

export function callerFor(t: Tenant) {
  return appRouter.createCaller({
    db,
    session: t.session,
    requestIp: "127.0.0.1",
    userAgent: "vitest",
    headers: new Headers(),
  });
}
