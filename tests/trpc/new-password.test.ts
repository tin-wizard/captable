import { db } from "@/server/db";
import { appRouter } from "@/trpc/api/root";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTenant } from "../helpers/seed";

let a: Tenant;
beforeAll(async () => {
  a = await seedTenant("np");
});
afterAll(async () => {
  await cleanupTenants(a);
});

describe("auth.newPassword", () => {
  it("revokes every session by bumping sessionVersion", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    const token = nanoid(32);
    await db.passwordResetToken.create({
      data: {
        email: user.email ?? "",
        token,
        expires: new Date(Date.now() + 60_000),
      },
    });
    const caller = appRouter.createCaller({
      db,
      session: null,
      requestIp: "127.0.0.1",
      userAgent: "vitest",
      headers: new Headers(),
      host: { kind: "canonical" },
    });
    await caller.auth.newPassword({ token, password: "N3w-passw0rd!x" });
    const after = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    expect(after.sessionVersion).toBe(user.sessionVersion + 1);
  });
});
