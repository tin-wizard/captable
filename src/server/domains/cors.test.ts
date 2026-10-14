import { describe, expect, it, vi } from "vitest";
import { MANAGED_CORS_ID, syncCustomOriginsCors } from "./cors";

const platform = {
  id: "platform",
  allowed: {
    origins: ["https://*.dealroom.tin.info"],
    methods: ["GET", "PUT", "HEAD"],
    headers: ["*"],
  },
  maxAgeSeconds: 600,
};
const stale = {
  id: MANAGED_CORS_ID,
  allowed: { origins: ["https://old.example.com"], methods: ["GET"] },
};

function fakeFetch(rules: unknown[], put = { ok: true, success: true }) {
  return vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === "PUT")
      return Response.json(
        { success: put.success },
        { status: put.ok ? 200 : 500 },
      );
    return Response.json({ success: true, result: { rules } });
  });
}
const env = { accountId: "acc", token: "tok", buckets: ["priv", "pub"] };
const puts = (f: ReturnType<typeof fakeFetch>) =>
  f.mock.calls.filter(([, i]) => i?.method === "PUT");

describe("syncCustomOriginsCors", () => {
  it("skips without token or account id, no fetch", async () => {
    const f = fakeFetch([]);
    for (const e of [
      { ...env, token: undefined },
      { ...env, accountId: undefined },
    ])
      expect(
        await syncCustomOriginsCors(["https://a.io"], {
          fetch: f as never,
          env: e,
        }),
      ).toEqual({ skipped: true });
    expect(f).not.toHaveBeenCalled();
  });

  it("PUTs per bucket: untouched platform rule plus one sorted unique managed rule", async () => {
    const f = fakeFetch([structuredClone(platform), stale]);
    const r = await syncCustomOriginsCors(
      ["https://b.io", "https://a.io", "https://b.io"],
      { fetch: f as never, env },
    );
    expect(r).toEqual({ skipped: false, ok: true });
    const p = puts(f);
    expect(p).toHaveLength(2);
    expect(p[0]?.[0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/priv/cors",
    );
    const body = JSON.parse(p[0]?.[1]?.body as string);
    expect(body.rules).toEqual([
      platform,
      {
        id: MANAGED_CORS_ID,
        allowed: {
          origins: ["https://a.io", "https://b.io"],
          methods: ["GET", "PUT", "HEAD"],
          headers: ["*"],
        },
        maxAgeSeconds: 3600,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('"*"],"methods"');
  });

  it("dedupes buckets", async () => {
    const f = fakeFetch([]);
    await syncCustomOriginsCors(["https://a.io"], {
      fetch: f as never,
      env: { ...env, buckets: ["same", "same"] },
    });
    expect(puts(f)).toHaveLength(1);
  });

  it("empty origins removes only the managed rule", async () => {
    const f = fakeFetch([structuredClone(platform), stale]);
    await syncCustomOriginsCors([], { fetch: f as never, env });
    expect(JSON.parse(puts(f)[0]?.[1]?.body as string).rules).toEqual([
      platform,
    ]);
  });

  it("non-2xx or success:false is ok:false and never throws", async () => {
    for (const put of [
      { ok: false, success: true },
      { ok: true, success: false },
    ])
      expect(
        await syncCustomOriginsCors(["https://a.io"], {
          fetch: fakeFetch([platform], put) as never,
          env,
        }),
      ).toEqual({ skipped: false, ok: false });
    const boom = vi.fn().mockRejectedValue(new Error("net"));
    expect(
      await syncCustomOriginsCors(["https://a.io"], {
        fetch: boom as never,
        env,
      }),
    ).toEqual({ skipped: false, ok: false });
  });
});
