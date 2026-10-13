import { beforeEach, describe, expect, it, vi } from "vitest";

type Entry = {
  company: { id: string; publicId: string; name: string };
  url: string;
};
const h = vi.hoisted(() => {
  const s = { list: [] as Entry[] };
  return {
    host: { kind: "canonical" } as { kind: string; [k: string]: string },
    session: null as null | {
      user: { id: string; companyId?: string; companyPublicId?: string };
    },
    s,
    getCompanyList: vi.fn(async (_userId: string) => s.list),
    homeUrl: vi.fn(async () => "https://stale.dealroom.tin.info/stale"),
    redirect: vi.fn((u: string) => {
      throw new Error(`REDIRECT:${u}`);
    }),
    notFound: vi.fn(() => {
      throw new Error("NOT_FOUND");
    }),
  };
});
vi.mock("next/navigation", () => ({
  redirect: h.redirect,
  notFound: h.notFound,
}));
vi.mock("@/server/domains/request-host", () => ({
  getRequestHost: async () => h.host,
}));
vi.mock("@/server/auth", () => ({
  getServerComponentAuthSession: async () => h.session,
  withServerComponentSession: () => {
    if (!h.session) return Promise.reject(new Error("session not found"));
    return Promise.resolve(h.session);
  },
}));
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/company", () => ({ getCompanyList: h.getCompanyList }));
vi.mock("@/server/domains/links", () => ({ companyEntryUrl: h.homeUrl }));
vi.mock("@/components/onboarding/company-chooser", () => ({
  CompanyChooser: () => null,
}));

import ChooseCompanyPage from "@/app/(authenticated)/choose-company/page";
import HomePage from "@/app/page";

const entry = (n: string): Entry => ({
  company: { id: `c-${n}`, publicId: `p-${n}`, name: `${n} Inc` },
  url: `https://${n}.dealroom.tin.info/p-${n}`,
});

beforeEach(() => {
  h.host = { kind: "canonical" };
  h.session = { user: { id: "u1" } };
  h.s.list = [];
  h.getCompanyList.mockClear();
});

describe("home page", () => {
  it("tenant host, signed in: company home, no chooser lookup", async () => {
    h.host = { kind: "tenant", publicId: "pub" };
    await expect(HomePage()).rejects.toThrow("REDIRECT:/pub");
    expect(h.getCompanyList).not.toHaveBeenCalled();
  });

  it("one company: straight to it, ignoring a stale session company", async () => {
    h.session = { user: { id: "u1", companyId: "x", companyPublicId: "x" } };
    h.s.list = [entry("acme")];
    await expect(HomePage()).rejects.toThrow(
      "REDIRECT:https://acme.dealroom.tin.info/p-acme",
    );
    expect(h.getCompanyList).toHaveBeenCalledWith("u1");
  });

  it("several companies: the chooser", async () => {
    h.s.list = [entry("acme"), entry("beta")];
    await expect(HomePage()).rejects.toThrow("REDIRECT:/choose-company");
  });

  it("no company: today's fallback (session company, else /login)", async () => {
    h.session = { user: { id: "u1", companyId: "x", companyPublicId: "x" } };
    await expect(HomePage()).rejects.toThrow(
      "REDIRECT:https://stale.dealroom.tin.info/stale",
    );
    h.session = { user: { id: "u1" } };
    await expect(HomePage()).rejects.toThrow("REDIRECT:/login");
  });

  it("unknown host, signed in: no chooser (today's fallback)", async () => {
    h.host = { kind: "unknown" };
    h.s.list = [entry("acme"), entry("beta")];
    await expect(HomePage()).rejects.toThrow("REDIRECT:/login");
    expect(h.getCompanyList).not.toHaveBeenCalled();
  });

  it("signed out: /login without a lookup", async () => {
    h.session = null;
    await expect(HomePage()).rejects.toThrow("REDIRECT:/login");
    expect(h.getCompanyList).not.toHaveBeenCalled();
  });
});

describe("choose-company page", () => {
  it("lists only the session user's companies, current one marked", async () => {
    h.session = { user: { id: "u1", companyPublicId: "p-beta" } };
    h.s.list = [entry("acme"), entry("beta")];
    const out = await ChooseCompanyPage();
    expect(h.getCompanyList).toHaveBeenCalledWith("u1");
    expect(out.props).toEqual({
      companies: [
        {
          id: "c-acme",
          name: "acme Inc",
          url: entry("acme").url,
          current: false,
        },
        {
          id: "c-beta",
          name: "beta Inc",
          url: entry("beta").url,
          current: true,
        },
      ],
    });
  });

  it("no companies: back to / (never an empty chooser)", async () => {
    await expect(ChooseCompanyPage()).rejects.toThrow("REDIRECT:/");
  });

  it("not on the canonical host: 404", async () => {
    for (const kind of ["tenant", "unknown"]) {
      h.host = { kind };
      await expect(ChooseCompanyPage()).rejects.toThrow("NOT_FOUND");
    }
    expect(h.getCompanyList).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    h.session = null;
    await expect(ChooseCompanyPage()).rejects.toThrow("session not found");
  });
});
