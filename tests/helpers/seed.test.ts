import { db } from "@/server/db";
import { afterAll, describe, expect, it } from "vitest";
import { callerFor, cleanupTenants, seedTwoTenants } from "./seed";

describe("seed helpers", () => {
  const made = seedTwoTenants();
  afterAll(async () => {
    const { a, b } = await made;
    await cleanupTenants(a, b);
  });

  it("creates two isolated tenants on the local test database", async () => {
    const { a, b } = await made;
    expect(a.companyId).not.toBe(b.companyId);
    const url = (
      await db.$queryRaw<{ db: string }[]>`select current_database() as db`
    )[0];
    expect(url?.db).toBe("captable_test");
  });

  it("builds a working tRPC caller for a tenant", async () => {
    const { a } = await made;
    const caller = callerFor(a);
    expect(typeof caller.company.switchCompany).toBe("function");
  });
});
