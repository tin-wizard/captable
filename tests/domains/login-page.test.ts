import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { kind: "canonical" } as { kind: string; [k: string]: string },
  session: null as null | { user: { companyPublicId?: string } },
  view: vi.fn(async (i: { next: string | null }) => ({ next: i.next })),
  redirect: vi.fn((u: string) => {
    throw new Error(`REDIRECT:${u}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-dr-path": "/login?callbackUrl=%2Fx" }),
}));
vi.mock("@/server/domains/request-host", () => ({
  getRequestHost: async () => h.host,
}));
vi.mock("@/server/auth", () => ({
  getServerComponentAuthSession: async () => h.session,
}));
vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: true,
    canonicalOrigin: "https://dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
    port: "",
  }),
  tenantOrigin: (host: string) => `https://${host}`,
}));
vi.mock("@/server/domains/login-view", () => ({ getTenantLoginView: h.view }));
vi.mock("@/components/onboarding/signin", () => ({ default: () => null }));
vi.mock("@/components/onboarding/tenant-login", () => ({
  TenantLogin: () => null,
}));

import SignIn from "@/app/(unauthenticated)/login/page";

const searchParams = Promise.resolve({ callbackUrl: "/pub/stakeholders" });
const tenant = {
  kind: "tenant",
  hostname: "acme.dealroom.tin.info",
  companyId: "c1",
  publicId: "pub",
};

describe("login page", () => {
  beforeEach(() => {
    h.session = null;
    h.view.mockClear();
  });

  it("tenant host, signed in: goes to the company home", async () => {
    h.host = tenant;
    h.session = { user: {} };
    await expect(SignIn({ searchParams })).rejects.toThrow("REDIRECT:/pub");
    expect(h.view).not.toHaveBeenCalled();
  });

  it("tenant host, signed out: renders the company login view", async () => {
    h.host = tenant;
    const out = await SignIn({ searchParams });
    expect(out.props).toEqual({ next: "/pub/stakeholders" });
    expect(h.view).toHaveBeenCalledWith({
      companyId: "c1",
      hostname: "acme.dealroom.tin.info",
      next: "/pub/stakeholders",
    });
  });

  it("alias host: same path and query on the primary host", async () => {
    h.host = { kind: "alias", redirectHost: "new.dealroom.tin.info" };
    await expect(SignIn({ searchParams })).rejects.toThrow(
      "REDIRECT:https://new.dealroom.tin.info/login?callbackUrl=%2Fx",
    );
  });

  it("unknown host: domain-not-found on canonical", async () => {
    h.host = { kind: "unknown" };
    await expect(SignIn({ searchParams })).rejects.toThrow(
      "REDIRECT:https://dealroom.tin.info/domain-not-found",
    );
  });

  it("canonical host: unchanged (session redirect, else the sign-in form)", async () => {
    h.host = { kind: "canonical" };
    h.session = { user: { companyPublicId: "pub" } };
    await expect(SignIn({ searchParams })).rejects.toThrow("REDIRECT:/pub");
    h.session = null;
    const out = await SignIn({ searchParams });
    expect(out.props.companyAddress).toEqual({
      baseDomain: "dealroom.tin.info",
      scheme: "https",
      port: "",
    });
    expect(h.view).not.toHaveBeenCalled();
  });
});
