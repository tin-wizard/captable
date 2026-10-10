import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  redirect: vi.fn((u: string) => {
    throw new Error(`REDIRECT:${u}`);
  }),
  permanentRedirect: vi.fn((u: string) => {
    throw new Error(`PERMANENT:${u}`);
  }),
}));
vi.mock("next/navigation", () => nav);
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-dr-path": "/pub-a/x" }),
}));
vi.mock("@/server/domains/request-host", () => ({
  getRequestHost: async () => ({ kind: "alias", redirectHost: "b.example" }),
}));
vi.mock("@/server/domains/config", () => ({
  tenantOrigin: (h: string) => `https://${h}`,
}));
vi.mock("@/server/auth", () => ({
  getServerComponentAuthSession: async () => null,
}));

import AuthenticatedLayout from "@/app/(authenticated)/layout";

describe("(authenticated) layout on an alias host", () => {
  // a cached 308 would loop after renaming A→B→A
  it("redirects temporarily (307), never permanently", async () => {
    await expect(AuthenticatedLayout({ children: null })).rejects.toThrow(
      "REDIRECT:https://b.example/pub-a/x",
    );
    expect(nav.permanentRedirect).not.toHaveBeenCalled();
  });
});
