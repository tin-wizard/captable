import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { isSameOrigin, logLine, proxy, tenantAuthRedirect } from "./proxy";

const cfg = vi.hoisted(() => ({
  enabled: true,
  canonicalHost: "dealroom.tin.info",
  canonicalOrigin: "https://dealroom.tin.info",
  baseDomain: "dealroom.tin.info",
  scheme: "https",
  port: "",
}));
vi.mock("@/server/domains/config", () => ({ domainConfig: () => cfg }));

const req = (
  url: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) =>
  new NextRequest(url, {
    method: init.method ?? "GET",
    headers: { host: new URL(url).host, ...init.headers },
  });

describe("request log line", () => {
  it("never contains the query string", () => {
    const line = logLine(
      {
        method: "GET",
        url: "https://dealroom.tin.info/data-rooms/x?token=SECRET",
      },
      "1.2.3.4",
    );
    expect(line).toContain("/data-rooms/x");
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("?");
  });
});

describe("isSameOrigin", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("allows GET without Origin", () =>
    expect(
      isSameOrigin({ method: "GET", headers: h({}) }, "a.dealroom.tin.info"),
    ).toBe(true));
  it("allows same-origin POST", () =>
    expect(
      isSameOrigin(
        {
          method: "POST",
          headers: h({ origin: "https://a.dealroom.tin.info" }),
        },
        "a.dealroom.tin.info",
      ),
    ).toBe(true));
  it("allows POST with Sec-Fetch-Site same-origin", () =>
    expect(
      isSameOrigin(
        { method: "POST", headers: h({ "sec-fetch-site": "same-origin" }) },
        "a.dealroom.tin.info",
      ),
    ).toBe(true));
  it("rejects a sibling-subdomain POST (same-site, not same-origin)", () =>
    expect(
      isSameOrigin(
        {
          method: "POST",
          headers: h({
            origin: "https://mattermost.tin.info",
            "sec-fetch-site": "same-site",
          }),
        },
        "a.dealroom.tin.info",
      ),
    ).toBe(false));
  it("rejects POST without Origin or Sec-Fetch-Site", () =>
    expect(
      isSameOrigin({ method: "POST", headers: h({}) }, "a.dealroom.tin.info"),
    ).toBe(false));
  it("rejects a malformed Origin", () =>
    expect(
      isSameOrigin(
        { method: "POST", headers: h({ origin: "null" }) },
        "a.dealroom.tin.info",
      ),
    ).toBe(false));
});

describe("tenantAuthRedirect", () => {
  it("login is left to the page (company login view)", () =>
    expect(tenantAuthRedirect("/login")).toBeNull());
  it("signup goes to canonical", () =>
    expect(tenantAuthRedirect("/signup")).toBe("canonical:/signup"));
  it("sub-paths of canonical-only pages go to canonical", () =>
    expect(tenantAuthRedirect("/reset-password/tok")).toBe(
      "canonical:/reset-password/tok",
    ));
  it("logout goes to canonical", () =>
    expect(tenantAuthRedirect("/logout")).toBe("canonical:/logout"));
  it("the company chooser goes to canonical", () =>
    expect(tenantAuthRedirect("/choose-company")).toBe(
      "canonical:/choose-company",
    ));
  it("ordinary pages are untouched", () =>
    expect(tenantAuthRedirect("/abc/stakeholders")).toBeNull());
  it("prefix look-alikes are untouched", () =>
    expect(tenantAuthRedirect("/newsletter")).toBeNull());
});

describe("proxy", () => {
  it("404s malformed platform labels and multi-level hosts", () => {
    expect(proxy(req("https://a--b.dealroom.tin.info/")).status).toBe(404);
    expect(proxy(req("https://a.b.dealroom.tin.info/")).status).toBe(404);
  });
  it("lets tenant login through to the page and redirects signup to canonical", () => {
    const login = proxy(
      req("https://acme.dealroom.tin.info/login?callbackUrl=%2Fx"),
    );
    expect(login.status).toBe(200);
    expect(login.headers.get("location")).toBeNull();
    expect(login.headers.get("x-middleware-request-x-dr-path")).toBe(
      "/login?callbackUrl=%2Fx",
    );
    const signup = proxy(req("https://acme.dealroom.tin.info/signup?ref=1"));
    expect(signup.headers.get("location")).toBe(
      "https://dealroom.tin.info/signup?ref=1",
    );
  });
  it("sends the company chooser on a company host to canonical", () => {
    expect(
      proxy(req("https://acme.dealroom.tin.info/choose-company")).headers.get(
        "location",
      ),
    ).toBe("https://dealroom.tin.info/choose-company");
  });
  it("overwrites inbound x-dr-path and marks platform hosts noindex", () => {
    const res = proxy(
      req("https://acme.dealroom.tin.info/abc/x?y=1", {
        headers: { "x-dr-path": "/forged" },
      }),
    );
    expect(res.headers.get("x-middleware-request-x-dr-path")).toBe(
      "/abc/x?y=1",
    );
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(
      proxy(req("https://dealroom.tin.info/")).headers.get("x-robots-tag"),
    ).toBeNull();
  });
  it("redirects canonical-only pages on a custom host to canonical", () => {
    for (const path of [
      "/signup?ref=1",
      "/forgot-password",
      "/reset-password/tok",
      "/verify-email",
      "/logout",
      "/onboarding",
      "/company/new",
    ]) {
      const res = proxy(req(`https://investors.implexus.io${path}`));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(
        `https://dealroom.tin.info${path}`,
      );
    }
  });
  it("passes login and company pages on a custom host; no label 404, no noindex", () => {
    for (const path of ["/login", "/abc/stakeholders"]) {
      const res = proxy(req(`https://investors.implexus.io${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-robots-tag")).toBeNull();
    }
    // a custom label that would be a malformed platform label is still fine
    expect(proxy(req("https://a--b.implexus.io/")).status).toBe(200);
  });
  it("lets Caddy's internal ask call through (host app:3000)", () => {
    const res = proxy(
      req("http://app:3000/api/domains/tls-ask?domain=x.io&secret=s"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
  it("403s a cross-origin POST except on exempt paths", () => {
    const post = (path: string) =>
      proxy(
        req(`https://dealroom.tin.info${path}`, {
          method: "POST",
          headers: { origin: "https://evil.com" },
        }),
      );
    expect(post("/api/trpc/x").status).toBe(403);
    expect(post("/api/auth/callback/credentials").status).toBe(403);
    expect(post("/api/stripe/webhook").status).toBe(200);
    expect(post("/api/v1/companies").status).toBe(200);
  });
  it("with the flag off: no host 404s or redirects, same-origin still enforced", () => {
    cfg.enabled = false;
    try {
      expect(proxy(req("https://a--b.dealroom.tin.info/")).status).toBe(200);
      expect(proxy(req("https://acme.dealroom.tin.info/signup")).status).toBe(
        200,
      );
      expect(
        proxy(req("https://acme.dealroom.tin.info/x")).headers.get(
          "x-middleware-request-x-dr-path",
        ),
      ).toBe("/x");
      expect(
        proxy(req("https://dealroom.tin.info/api/trpc/x", { method: "POST" }))
          .status,
      ).toBe(403);
    } finally {
      cfg.enabled = true;
    }
  });
});
