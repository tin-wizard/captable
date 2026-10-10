import { type JWT, encode } from "next-auth/jwt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

vi.stubEnv("NEXTAUTH_URL", "https://dealroom.tin.info"); // before the dynamic imports below
const { SESSION_COOKIE, authOptions } = await import("@/server/auth");
const { sessionFromCookieHeader } = await import(
  "@/server/api/middlewares/session-token"
);

let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});
afterAll(async () => cleanupTenants(a, b));

describe("REST cookie auth", () => {
  it("decodes the canonical cookie in-process", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no hairpin");
    });
    try {
      const jwt = await encode({
        token: {
          sub: a.userId,
          companyId: a.companyId,
          memberId: "m",
          sv: 0,
        } as JWT,
        secret: process.env.NEXTAUTH_SECRET as string,
      });
      const s = await sessionFromCookieHeader(`${SESSION_COOKIE}=${jwt}`);
      expect(s?.user.id).toBe(a.userId);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores the old __Secure- name", async () => {
    const jwt = await encode({
      token: { sub: a.userId, sv: 0 } as JWT,
      secret: process.env.NEXTAUTH_SECRET as string,
    });
    expect(
      await sessionFromCookieHeader(`__Secure-next-auth.session-token=${jwt}`),
    ).toBeNull();
  });

  it("rejects a token whose session version is stale", async () => {
    const jwt = await encode({
      token: { sub: a.userId, sv: 1 } as JWT,
      secret: process.env.NEXTAUTH_SECRET as string,
    });
    expect(
      await sessionFromCookieHeader(`${SESSION_COOKIE}=${jwt}`),
    ).toBeNull();
  });

  it("gives every NextAuth cookie a __Host- name on https", () => {
    const cookies = Object.values(authOptions.cookies ?? {});
    expect(cookies).toHaveLength(6);
    for (const c of cookies) {
      expect(c.name.startsWith("__Host-")).toBe(true);
      expect(c.options).not.toHaveProperty("domain");
    }
  });
});
