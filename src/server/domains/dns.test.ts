import { describe, expect, it } from "vitest";
import { type DnsDeps, challengeName, checkDomainDns } from "./dns";

const base = {
  hostname: "investors.implexus.io",
  token: "tok123",
  canonicalHost: "dealroom.tin.info",
  baseDomain: "dealroom.tin.info",
  serverIps: ["91.98.230.192"],
};
const none = () =>
  Promise.reject(Object.assign(new Error("nx"), { code: "ENODATA" }));
const deps = (o: Partial<DnsDeps>): DnsDeps => ({
  resolveTxt: none,
  resolveCname: none,
  resolve4: none,
  ...o,
});

describe("checkDomainDns", () => {
  it("owned when the challenge TXT equals the token (chunks joined)", async () => {
    const d = deps({
      resolveTxt: async (n) =>
        n === challengeName(base.hostname) ? [["to", "k123"]] : [],
    });
    expect(await checkDomainDns(base, d)).toEqual({
      owned: true,
      routed: false,
    });
  });
  it("not owned for another token or no record", async () => {
    expect(
      (
        await checkDomainDns(
          base,
          deps({ resolveTxt: async () => [["other"]] }),
        )
      ).owned,
    ).toBe(false);
    expect((await checkDomainDns(base, deps({}))).owned).toBe(false);
  });
  it("routed by CNAME to the canonical host or any platform host", async () => {
    expect(
      (
        await checkDomainDns(
          base,
          deps({ resolveCname: async () => ["dealroom.tin.info"] }),
        )
      ).routed,
    ).toBe(true);
    expect(
      (
        await checkDomainDns(
          base,
          deps({ resolveCname: async () => ["acme.dealroom.tin.info"] }),
        )
      ).routed,
    ).toBe(true);
    expect(
      (
        await checkDomainDns(
          base,
          deps({ resolveCname: async () => ["evil.example.net"] }),
        )
      ).routed,
    ).toBe(false);
    // chain: hostname -> proxy.example.net. -> acme.dealroom.tin.info
    const chain: Record<string, string> = {
      [base.hostname]: "proxy.example.net.",
      "proxy.example.net": "acme.dealroom.tin.info",
    };
    expect(
      (
        await checkDomainDns(
          base,
          deps({ resolveCname: async (n) => [chain[n] ?? ""] }),
        )
      ).routed,
    ).toBe(true);
  });
  it("routed by A record only when it matches a configured server IP", async () => {
    expect(
      (
        await checkDomainDns(
          base,
          deps({ resolve4: async () => ["91.98.230.192"] }),
        )
      ).routed,
    ).toBe(true);
    expect(
      (await checkDomainDns(base, deps({ resolve4: async () => ["1.2.3.4"] })))
        .routed,
    ).toBe(false);
    expect(
      (
        await checkDomainDns(
          { ...base, serverIps: [] },
          deps({ resolve4: async () => ["91.98.230.192"] }),
        )
      ).routed,
    ).toBe(false);
  });
  it("runs the TXT, CNAME and A lookups concurrently", async () => {
    // each lookup waits until all three have started: a sequential check would hang
    let started = 0;
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const wait = async <T>(v: T) => {
      if (++started === 3) release();
      await gate;
      return v;
    };
    expect(
      await checkDomainDns(base, {
        resolveTxt: () => wait([["tok123"]]),
        resolveCname: () => wait(["dealroom.tin.info"]),
        resolve4: () => wait(["1.2.3.4"]),
      }),
    ).toEqual({ owned: true, routed: true });
  }, 2_000);
});
