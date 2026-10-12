import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { kind: "canonical" } as { kind: string; publicId?: string },
  getProfile: vi.fn(async () => ({ id: "m1" })),
  redirect: vi.fn((u: string) => {
    throw new Error(`REDIRECT:${u}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("@/server/domains/request-host", () => ({
  getRequestHost: async () => h.host,
}));
vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({ canonicalOrigin: "https://dealroom.tin.info" }),
}));
vi.mock("@/trpc/server", () => ({
  api: { member: { getProfile: { query: h.getProfile } } },
}));
vi.mock("@/components/member/member-profile", () => ({
  ProfileSettings: () => null,
}));
vi.mock("@/components/member/view-alerts-setting", () => ({
  ViewAlertsSetting: () => null,
}));

import ProfileSettingsPage from "@/app/(authenticated)/(dashboard)/[publicId]/settings/profile/page";

const params = Promise.resolve({ publicId: "pub" });

describe("profile settings page", () => {
  beforeEach(() => {
    h.getProfile.mockClear();
    h.redirect.mockClear();
  });

  // getProfile is canonical-only: calling it on a company host throws FORBIDDEN
  it("on a company host redirects to canonical without fetching", async () => {
    h.host = { kind: "tenant", publicId: "pub" };
    await expect(ProfileSettingsPage({ params })).rejects.toThrow(
      "REDIRECT:https://dealroom.tin.info/pub/settings/profile",
    );
    expect(h.getProfile).not.toHaveBeenCalled();
  });

  it("on the canonical host fetches the profile and renders", async () => {
    h.host = { kind: "canonical" };
    const out = await ProfileSettingsPage({ params });
    expect(h.getProfile).toHaveBeenCalledOnce();
    expect(h.redirect).not.toHaveBeenCalled();
    expect(out).toBeTruthy();
  });
});
