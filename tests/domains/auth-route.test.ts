import { GET, POST } from "@/app/api/auth/[...nextauth]/route";
import { POST as signout } from "@/app/auth/signout/route";
import { db } from "@/server/db";
import type { RequestHost } from "@/server/domains/request-host";
import {
  mintTenantSession,
  tenantCookieName,
} from "@/server/domains/tenant-session";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Tenant, cleanupTenants, seedTenant } from "../helpers/seed";

const HOST = "ar-a.dealroom.tin.info";
const CANON = "https://dealroom.tin.info";

let a: Tenant;
let host: RequestHost;
let session: Session | null;
let enabled = true;

const nextAuthHandler = vi.hoisted(() =>
  vi.fn(async () => new Response("delegated", { status: 200 })),
);
vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  default: () => nextAuthHandler,
}));
vi.mock("@/server/domains/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/domains/config")>();
  return { ...mod, domainConfig: () => ({ ...mod.domainConfig(), enabled }) };
});
vi.mock("@/server/domains/request-host", () => ({
  getRequestHost: async () => host,
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getServerAuthSession: async () => session,
}));

beforeAll(async () => {
  a = await seedTenant("ar");
});
afterAll(async () => {
  await cleanupTenants(a);
});
beforeEach(() => {
  session = a.session;
  enabled = true;
  host = {
    kind: "tenant",
    hostname: HOST,
    companyId: a.companyId,
    publicId: "pub-a",
  };
  nextAuthHandler.mockClear();
});

const call = (
  fn: typeof GET,
  method: string,
  action: string[],
  origin = `https://${HOST}`,
) =>
  fn(new NextRequest(`${origin}/api/auth/${action.join("/")}`, { method }), {
    params: Promise.resolve({ nextauth: action }),
  });

describe("/api/auth on a company host", () => {
  it("GET and POST session return the tenant session as JSON", async () => {
    for (const fn of [GET, POST]) {
      const r = await call(fn, fn === GET ? "GET" : "POST", ["session"]);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual(a.session);
    }
  });

  it("session returns {} when signed out", async () => {
    session = null;
    const r = await call(GET, "GET", ["session"]);
    expect(await r.json()).toEqual({});
  });

  it("csrf returns an empty token", async () => {
    const r = await call(GET, "GET", ["csrf"]);
    expect(await r.json()).toEqual({ csrfToken: "" });
  });

  it("signin/google and providers return 404", async () => {
    expect((await call(POST, "POST", ["signin", "google"])).status).toBe(404);
    expect((await call(GET, "GET", ["providers"])).status).toBe(404);
    expect(nextAuthHandler).not.toHaveBeenCalled();
  });
});

describe("/api/auth on canonical", () => {
  it("providers is delegated to NextAuth", async () => {
    host = { kind: "canonical" };
    const r = await call(GET, "GET", ["providers"], CANON);
    expect(await r.text()).toBe("delegated");
    expect(nextAuthHandler).toHaveBeenCalledTimes(1);
  });

  it("flag off delegates even on a tenant-looking host", async () => {
    enabled = false;
    await call(GET, "GET", ["session"]);
    expect(nextAuthHandler).toHaveBeenCalledTimes(1);
  });
});

describe("POST /auth/signout", () => {
  const req = (cookie?: string) =>
    new NextRequest(`https://${HOST}/auth/signout`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
    });

  it("bumps sessionVersion, clears the cookie and 303s to canonical /logout", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    const token = await mintTenantSession({
      sub: a.userId,
      cid: a.companyId,
      mid: a.memberId,
      pid: "pub-a",
      hst: HOST,
      sv: before.sessionVersion,
    });
    const r = await signout(req(`${tenantCookieName()}=${token}`));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`${CANON}/logout`);
    const setCookie = r.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${tenantCookieName()}=;`);
    expect(setCookie).toMatch(/Max-Age=0/i);
    const after = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
  });

  it("without a session still clears the cookie and redirects", async () => {
    const r = await signout(req());
    expect(r.status).toBe(303);
    expect(r.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);
  });

  it("404s on canonical and when the flag is off", async () => {
    host = { kind: "canonical" };
    expect((await signout(req())).status).toBe(404);
    host = {
      kind: "tenant",
      hostname: HOST,
      companyId: a.companyId,
      publicId: "pub-a",
    };
    enabled = false;
    expect((await signout(req())).status).toBe(404);
  });
});
