import { encode } from "next-auth/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TENANT_SESSION_SECONDS,
  mintTenantSession,
  readTenantSession,
} from "./tenant-session";

const claims = {
  sub: "u1",
  cid: "c1",
  mid: "m1",
  pid: "p1",
  hst: "botski.dealroom.tin.info",
  sv: 0,
};
const secret = process.env.NEXTAUTH_SECRET as string;

describe("tenant session", () => {
  afterEach(() => vi.useRealTimers());

  it("round-trips on its own host", async () => {
    const t = await mintTenantSession(claims);
    expect(
      await readTenantSession(t, "botski.dealroom.tin.info"),
    ).toMatchObject(claims);
  });
  it("does not decode on another host (salt binding)", async () => {
    const t = await mintTenantSession(claims);
    expect(await readTenantSession(t, "konnect.dealroom.tin.info")).toBeNull();
    expect(await readTenantSession(t, "dealroom.tin.info")).toBeNull();
  });
  it("rejects garbage and empty input", async () => {
    expect(
      await readTenantSession("garbage", "botski.dealroom.tin.info"),
    ).toBeNull();
    expect(
      await readTenantSession(undefined, "botski.dealroom.tin.info"),
    ).toBeNull();
  });
  it("rejects an expired token", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await mintTenantSession(claims);
    vi.setSystemTime(Date.now() + (TENANT_SESSION_SECONDS + 60) * 1000);
    expect(await readTenantSession(t, claims.hst)).toBeNull();
  });
  it("rejects a token whose hst does not match the host it decodes on", async () => {
    const host = "konnect.dealroom.tin.info";
    const t = await encode({
      token: claims,
      secret,
      salt: `dr-tenant:${host}`,
    });
    expect(await readTenantSession(t, host)).toBeNull();
  });
  it("rejects a token missing required claims", async () => {
    const { mid: _mid, ...partial } = claims;
    const t = await encode({
      token: partial,
      secret,
      salt: `dr-tenant:${claims.hst}`,
    });
    expect(await readTenantSession(t, claims.hst)).toBeNull();
  });
});
