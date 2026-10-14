import { GET } from "@/app/api/domains/tls-ask/route";
import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, cleanupTenants, seedTenant } from "../helpers/seed";

// counts the route's companyDomain lookups (spying on Prisma's extended
// delegates breaks them for the rest of the file)
const lookups = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/server/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/db")>();
  return {
    ...mod,
    db: new Proxy(mod.db, {
      get: (t, k) => {
        if (k === "companyDomain") lookups.n++;
        return t[k as keyof typeof t];
      },
    }),
  };
});

const env = vi.hoisted(() => ({
  DOMAINS_ENABLED: "1",
  TLS_ASK_SECRET: "s3cret-value" as string | undefined,
}));
vi.mock("@/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/env")>();
  return {
    env: new Proxy(mod.env, {
      get: (t, k) => (k in env ? env[k as keyof typeof env] : t[k as never]),
    }),
  };
});

const run = nanoid(6)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x");
const h = (s: string) => `${s}-${run}.implexus.io`;
const hosts = {
  active: h("active"),
  alias: h("alias"),
  aliasLive: h("alias-live"),
  aliasExpired: h("alias-expired"),
  pending: h("pending"),
  released: h("released"),
  platform: `ask-${run}.dealroom.tin.info`,
};

let t: Tenant;
beforeAll(async () => {
  t = await seedTenant(`ask-${run}`);
  const row = (
    hostname: string,
    kind: "PLATFORM" | "CUSTOM",
    status: "ACTIVE" | "ALIAS" | "PENDING" | "RELEASED",
    isPrimary = false,
    aliasExpiresAt: Date | null = null,
  ) => ({
    companyId: t.companyId,
    hostname,
    kind,
    status,
    isPrimary,
    aliasExpiresAt,
  });
  await db.companyDomain.createMany({
    data: [
      row(hosts.active, "CUSTOM", "ACTIVE", true),
      row(hosts.alias, "CUSTOM", "ALIAS"),
      row(
        hosts.aliasLive,
        "CUSTOM",
        "ALIAS",
        false,
        new Date(Date.now() + 864e5),
      ),
      row(
        hosts.aliasExpired,
        "CUSTOM",
        "ALIAS",
        false,
        new Date(Date.now() - 864e5),
      ),
      row(hosts.pending, "CUSTOM", "PENDING"),
      row(hosts.released, "CUSTOM", "RELEASED"),
      row(hosts.platform, "PLATFORM", "ALIAS"),
    ],
  });
});
afterAll(() => cleanupTenants(t));

const ask = async (q: Record<string, string>) => {
  const res = await GET(
    new NextRequest(
      `http://app:3000/api/domains/tls-ask?${new URLSearchParams(q)}`,
    ),
  );
  expect(await res.text()).toBe("");
  return res.status;
};
const secret = "s3cret-value";

describe("TLS ask endpoint", () => {
  it("is 404 for everything without a configured secret or with the flag off", async () => {
    env.TLS_ASK_SECRET = undefined;
    try {
      expect(await ask({ domain: hosts.active, secret })).toBe(404);
      expect(await ask({ domain: hosts.active, secret: "" })).toBe(404);
    } finally {
      env.TLS_ASK_SECRET = secret;
    }
    env.DOMAINS_ENABLED = "0";
    try {
      expect(await ask({ domain: hosts.active, secret })).toBe(404);
    } finally {
      env.DOMAINS_ENABLED = "1";
    }
  });

  it("is 404 for a wrong or missing secret, before any db call", async () => {
    lookups.n = 0;
    expect(await ask({ domain: hosts.active })).toBe(404);
    expect(await ask({ domain: hosts.active, secret: "wrong" })).toBe(404);
    expect(
      await ask({ domain: hosts.active, secret: `${secret.slice(0, -1)}X` }),
    ).toBe(404);
    expect(lookups.n).toBe(0);
  });

  it("is 404 with an empty body for a same-length multi-byte or wrong-length secret", async () => {
    // same UTF-16 length as the secret, twice the UTF-8 bytes
    expect(
      await ask({ domain: hosts.active, secret: "é".repeat(secret.length) }),
    ).toBe(404);
    expect(await ask({ domain: hosts.active, secret: `${secret}x` })).toBe(404);
    expect(await ask({ domain: hosts.active, secret })).toBe(200);
  });

  it("answers 200 only for live custom hostnames", async () => {
    expect(await ask({ domain: hosts.active, secret })).toBe(200);
    expect(await ask({ domain: hosts.alias, secret })).toBe(200); // permanent
    expect(await ask({ domain: hosts.aliasLive, secret })).toBe(200);
    expect(await ask({ domain: hosts.aliasExpired, secret })).toBe(404);
    expect(await ask({ domain: hosts.pending, secret })).toBe(404);
    expect(await ask({ domain: hosts.released, secret })).toBe(404);
    expect(await ask({ domain: hosts.platform, secret })).toBe(404);
    expect(await ask({ domain: `unknown-${run}.example.com`, secret })).toBe(
      404,
    );
    expect(await ask({ secret })).toBe(404);
    expect(lookups.n).toBeGreaterThan(0); // the counter does see the route
  });

  it("lowercases the domain", async () => {
    expect(await ask({ domain: hosts.active.toUpperCase(), secret })).toBe(200);
  });
});
