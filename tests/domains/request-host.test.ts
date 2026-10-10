import { db } from "@/server/db";
import {
  assignPlatformSubdomain,
  clearResolveCache,
  renamePlatformSubdomain,
} from "@/server/domains/registry";
import { resolveRequestHost } from "@/server/domains/request-host";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: true,
    canonicalHost: "dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
  }),
}));

let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  await db.$transaction((tx) =>
    assignPlatformSubdomain(tx, {
      companyId: a.companyId,
      label: "rh-a",
      createdById: a.userId,
    }),
  );
});
afterAll(async () => cleanupTenants(a, b));

describe("resolveRequestHost", () => {
  it("canonical", async () =>
    expect(await resolveRequestHost("dealroom.tin.info")).toEqual({
      kind: "canonical",
    }));
  it("tenant", async () =>
    expect(
      await resolveRequestHost("RH-A.dealroom.tin.info:443"),
    ).toMatchObject({ kind: "tenant", companyId: a.companyId }));
  it("unknown label", async () =>
    expect(await resolveRequestHost("ghost.dealroom.tin.info")).toEqual({
      kind: "unknown",
    }));
  it("unregistered custom host", async () =>
    expect(await resolveRequestHost("evil.example.com")).toEqual({
      kind: "unknown",
    }));
  it("malformed and multi-level hosts are unknown", async () => {
    expect(await resolveRequestHost("bad host")).toEqual({ kind: "unknown" });
    expect(await resolveRequestHost("a.b.dealroom.tin.info")).toEqual({
      kind: "unknown",
    });
  });
  it("alias redirects to the primary", async () => {
    await db.$transaction((tx) =>
      renamePlatformSubdomain(tx, {
        companyId: a.companyId,
        label: "rh-a2",
        createdById: a.userId,
      }),
    );
    clearResolveCache();
    expect(await resolveRequestHost("rh-a.dealroom.tin.info")).toEqual({
      kind: "alias",
      redirectHost: "rh-a2.dealroom.tin.info",
    });
  });
});
