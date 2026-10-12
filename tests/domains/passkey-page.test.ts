import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { kind: "canonical" } as { kind: string; [k: string]: string },
  find: vi.fn(async () => ({ data: [] })),
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
  api: { passkey: { find: { query: h.find } } },
}));
vi.mock("@/components/security/SettingHeader", () => ({
  SettingsHeader: () => null,
}));
vi.mock("@/components/security/passkey/create-passkey-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/security/passkey/user-passkeys-data-table", () => ({
  default: () => null,
}));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/card", () => ({ Card: () => null }));

import PasskeyPage from "@/app/(authenticated)/(dashboard)/[publicId]/settings/security/passkey/page";

const params = Promise.resolve({ publicId: "pub" });
const target =
  "REDIRECT:https://dealroom.tin.info/pub/settings/security/passkey";

describe("passkey settings page", () => {
  beforeEach(() => {
    h.find.mockClear();
    h.redirect.mockClear();
  });

  // passkey.find is canonical-only: calling it on a company host throws FORBIDDEN
  it.each([
    ["tenant", { kind: "tenant", publicId: "pub" }],
    ["alias", { kind: "alias", redirectHost: "new.dealroom.tin.info" }],
  ])(
    "on a %s host redirects to canonical without fetching",
    async (_, host) => {
      h.host = host;
      await expect(PasskeyPage({ params })).rejects.toThrow(target);
      expect(h.find).not.toHaveBeenCalled();
    },
  );

  it("on the canonical host fetches passkeys and renders", async () => {
    h.host = { kind: "canonical" };
    const out = await PasskeyPage({ params });
    expect(h.find).toHaveBeenCalledOnce();
    expect(h.redirect).not.toHaveBeenCalled();
    expect(out).toBeTruthy();
  });
});
