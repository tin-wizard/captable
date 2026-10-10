import { GET as callback } from "@/app/auth/handoff/callback/route";
import { GET as issue } from "@/app/auth/handoff/issue/route";
import { GET as start } from "@/app/auth/handoff/start/route";
import { db } from "@/server/db";
import type { RequestHost } from "@/server/domains/request-host";
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

const HOST = "hr-a.dealroom.tin.info";
const CANON = "https://dealroom.tin.info";

let a: Tenant;
let host: RequestHost;
let session: Session | null;

vi.mock("@/server/domains/request-host", () => ({
  getRequestHost: async () => host,
}));
vi.mock("@/server/auth", () => ({ getServerAuthSession: async () => session }));
vi.mock("@/server/domains/registry", () => ({
  resolveHostname: async (h: string) =>
    h === HOST
      ? {
          companyId: a.companyId,
          publicId: "pub-a",
          status: "ACTIVE",
          primaryHostname: null,
        }
      : null,
}));

beforeAll(async () => {
  a = await seedTenant("hr");
});
afterAll(async () => {
  await db.authHandoff.deleteMany({ where: { userId: a.userId } });
  await cleanupTenants(a);
});
beforeEach(() => {
  session = a.session;
});

const tenant = (): RequestHost => ({
  kind: "tenant",
  hostname: HOST,
  companyId: a.companyId,
  publicId: "pub-a",
});
const req = (url: string, cookie?: string) =>
  new NextRequest(url, cookie ? { headers: { cookie } } : undefined);
const loc = (r: Response) => r.headers.get("location") ?? "";

// start -> issue, returning the callback URL and the state cookie pair
async function startAndIssue(next = "/docs") {
  host = tenant();
  const s = await start(
    req(`https://${HOST}/auth/handoff/start?next=${encodeURIComponent(next)}`),
  );
  expect(s.status).toBe(303);
  const stateCookie = (s.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  host = { kind: "canonical" };
  const i = await issue(req(loc(s)));
  expect(i.status).toBe(303);
  return { callbackUrl: loc(i), stateCookie, issueUrl: loc(s) };
}

describe("handoff routes", () => {
  it("start on canonical returns 404", async () => {
    host = { kind: "canonical" };
    const r = await start(req(`${CANON}/auth/handoff/start`));
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("start on an unknown host goes to canonical /domain-not-found", async () => {
    host = { kind: "unknown" };
    const r = await start(
      req("https://nope.dealroom.tin.info/auth/handoff/start"),
    );
    expect(loc(r)).toBe(`${CANON}/domain-not-found`);
  });

  it("start on an alias host redirects to the primary host's start, keeping the query", async () => {
    host = { kind: "alias", redirectHost: HOST };
    const r = await start(
      req("https://old.dealroom.tin.info/auth/handoff/start?next=%2Fdocs&r=1"),
    );
    expect(r.status).toBe(307);
    expect(loc(r)).toBe(`https://${HOST}/auth/handoff/start?next=%2Fdocs&r=1`);
  });

  it("start with r=2 renders the stop page, not another redirect", async () => {
    host = tenant();
    const r = await start(
      req(`https://${HOST}/auth/handoff/start?next=%2Fdocs&r=2`),
    );
    expect(r.status).toBe(200);
    expect(loc(r)).toBe("");
    const body = await r.text();
    expect(body).toContain("Sign-in didn&#39;t complete");
    expect(body).toContain('href="/auth/handoff/start?next=%2Fdocs"');
  });

  it("start sets a per-nonce __Host- state cookie and redirects to canonical issue", async () => {
    host = tenant();
    const r = await start(
      req(`https://${HOST}/auth/handoff/start?next=%2Fdocs`),
    );
    const set = r.headers.get("set-cookie") ?? "";
    const u = new URL(loc(r));
    expect(u.origin + u.pathname).toBe(`${CANON}/auth/handoff/issue`);
    expect(set).toMatch(
      new RegExp(`^__Host-dr-handoff-${u.searchParams.get("n")}=`),
    );
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/Secure/i);
    expect(set).not.toMatch(/Domain=/i);
  });

  it("issue without a session redirects to /login?callbackUrl=…", async () => {
    host = { kind: "canonical" };
    session = null;
    const r = await issue(
      req(
        `${CANON}/auth/handoff/issue?host=${HOST}&s=x&n=abcdefgh&r=0&next=%2F`,
      ),
    );
    expect(r.status).toBe(307);
    const u = new URL(loc(r));
    expect(u.origin + u.pathname).toBe(`${CANON}/login`);
    expect(u.searchParams.get("callbackUrl")).toBe(
      `/auth/handoff/issue?host=${HOST}&s=x&n=abcdefgh&r=0&next=%2F`,
    );
  });

  it("issue for an unknown host doesn't redirect to it", async () => {
    host = { kind: "canonical" };
    const r = await issue(
      req(`${CANON}/auth/handoff/issue?host=evil.com&s=x&n=abcdefgh&r=0`),
    );
    expect(loc(r)).not.toContain("evil.com");
    expect(loc(r).startsWith(CANON)).toBe(true);
  });

  it("issue on a company host is 404", async () => {
    host = tenant();
    const r = await issue(
      req(`https://${HOST}/auth/handoff/issue?host=${HOST}&s=x&n=abcdefgh`),
    );
    expect(r.status).toBe(404);
  });

  it("issue for a non-member renders 403", async () => {
    host = { kind: "canonical" };
    session = { ...a.session, user: { ...a.session.user, id: "someone-else" } };
    const r = await issue(
      req(`${CANON}/auth/handoff/issue?host=${HOST}&s=x&n=abcdefgh&r=0`),
    );
    expect(r.status).toBe(403);
    expect(await r.text()).toContain(
      "You don&#39;t have access to this company",
    );
  });

  it("callback sets a host-only __Host-dr-tenant cookie and redirects to the stored next", async () => {
    const { callbackUrl, stateCookie } = await startAndIssue("/docs");
    expect(callbackUrl).not.toContain("next=");
    host = tenant();
    const r = await callback(req(callbackUrl, stateCookie));
    expect(r.status).toBe(303);
    expect(loc(r)).toBe("/docs");
    const set = r.headers.getSetCookie();
    const t = set.find((c) => c.startsWith("__Host-dr-tenant="));
    expect(t).toBeDefined();
    expect(t).toMatch(/Path=\//);
    expect(t).toMatch(/Secure/i);
    expect(t).toMatch(/HttpOnly/i);
    expect(t).not.toMatch(/Domain=/i);
    // state cookie cleared
    expect(
      set.some((c) => c.startsWith(`${stateCookie.split("=")[0]}=;`)),
    ).toBe(true);
  });

  it("issue with next=https://evil.com stores / and callback ignores a query next", async () => {
    const { issueUrl, stateCookie } = await startAndIssue();
    const u = new URL(issueUrl);
    u.searchParams.set("next", "https://evil.com");
    host = { kind: "canonical" };
    const i = await issue(req(u.toString()));
    host = tenant();
    const r = await callback(
      req(`${loc(i)}&next=https://evil.com`, stateCookie),
    );
    expect(loc(r)).toBe("/");
  });

  it("callback without the state cookie retries start with r+1", async () => {
    const { callbackUrl } = await startAndIssue();
    host = tenant();
    const r = await callback(req(callbackUrl));
    expect(r.status).toBe(303);
    expect(loc(r)).toBe("/auth/handoff/start?next=/&r=1");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});
