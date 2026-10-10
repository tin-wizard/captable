import { readFileSync } from "node:fs";
import { env } from "@/env";
import { db } from "@/server/db";
import {
  assignPlatformSubdomain,
  clearResolveCache,
} from "@/server/domains/registry";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

const state = vi.hoisted(() => ({
  enabled: true,
  host: { kind: "canonical" } as Record<string, unknown>,
}));

vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: state.enabled,
    canonicalHost: "dealroom.tin.info",
    canonicalOrigin: "https://dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
    port: "",
  }),
  tenantOrigin: (h: string) => `https://${h}`,
}));
vi.mock("@/server/domains/request-host", () => ({
  getRequestHost: async () => state.host,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-dr-path": "/data-rooms/x?token=t" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));

import { assertHostOwns, companyUrl, userUrl } from "@/server/domains/links";

let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  await db.$transaction((tx) =>
    assignPlatformSubdomain(tx, {
      companyId: a.companyId,
      label: "lk-a",
      createdById: a.userId,
    }),
  );
});
afterAll(async () => cleanupTenants(a, b));
beforeEach(() => {
  state.enabled = true;
  clearResolveCache();
});

describe("companyUrl", () => {
  it("uses the primary host when enabled", async () =>
    expect(await companyUrl(db, a.companyId, "/p")).toMatch(
      /^https:\/\/lk-a\..+\/p$/,
    ));
  it("falls back to the base url without a primary", async () =>
    expect(await companyUrl(db, b.companyId, "/p")).toBe(
      `${env.NEXT_PUBLIC_BASE_URL}/p`,
    ));
  it("falls back to the base url when the flag is off", async () => {
    state.enabled = false;
    expect(await companyUrl(db, a.companyId, "/p")).toBe(
      `${env.NEXT_PUBLIC_BASE_URL}/p`,
    );
  });
  it("userUrl is canonical", () =>
    expect(userUrl("/x")).toBe("https://dealroom.tin.info/x"));
});

describe("assertHostOwns", () => {
  it("canonical renders", async () => {
    state.host = { kind: "canonical" };
    await expect(assertHostOwns(a.companyId)).resolves.toBeUndefined();
  });
  it("own tenant host renders", async () => {
    state.host = { kind: "tenant", companyId: a.companyId };
    await expect(assertHostOwns(a.companyId)).resolves.toBeUndefined();
  });
  it("another company's tenant host -> notFound", async () => {
    state.host = { kind: "tenant", companyId: b.companyId };
    await expect(assertHostOwns(a.companyId)).rejects.toThrow("NOT_FOUND");
  });
  it("unknown host -> notFound", async () => {
    state.host = { kind: "unknown" };
    await expect(assertHostOwns(a.companyId)).rejects.toThrow("NOT_FOUND");
  });
  it("alias redirects to the primary with the original path", async () => {
    state.host = { kind: "alias", redirectHost: "lk-a.dealroom.tin.info" };
    await expect(assertHostOwns(a.companyId)).rejects.toThrow(
      "REDIRECT:https://lk-a.dealroom.tin.info/data-rooms/x?token=t",
    );
  });
});

describe("public pages", () => {
  it.each([
    "src/app/(documents)/data-rooms/[publicId]/page.tsx",
    "src/app/(documents)/data-rooms/[publicId]/[bucketId]/page.tsx",
    "src/app/updates/[publicId]/page.tsx",
    "src/app/(documents)/esign/[token]/page.tsx",
  ])("%s calls assertHostOwns", (f) =>
    expect(readFileSync(f, "utf8")).toMatch(/await assertHostOwns\(/),
  );

  it("S7: recipient copy-link tokens carry the update publicId", () =>
    expect(
      readFileSync("src/trpc/routers/update/procedures/get-updates.ts", "utf8"),
    ).toMatch(/publicId,[^\n]*\n\s*recipientId: recipient\.id/));
});
