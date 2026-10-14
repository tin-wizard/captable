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
    for (const r of body.rules) expect(r.allowed.origins).not.toContain("*");
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

  const getResp = (res: () => Response) =>
    vi.fn((_u: string, init?: RequestInit) =>
      init?.method === "PUT" ? Response.json({ success: true }) : res(),
    );
  const run = (f: ReturnType<typeof getResp>) =>
    syncCustomOriginsCors(["https://a.io"], { fetch: f as never, env });

  it("GET 404 JSON success:false means no CORS yet: PUT only the managed rule", async () => {
    const f = getResp(() =>
      Response.json(
        { success: false, errors: [{ code: 10059 }] },
        { status: 404 },
      ),
    );
    expect(await run(f)).toEqual({ skipped: false, ok: true });
    const rules = JSON.parse(puts(f)[0]?.[1]?.body as string).rules;
    expect(rules.map((r: { id: string }) => r.id)).toEqual([MANAGED_CORS_ID]);
  });

  const bad: [string, () => Response][] = [
    ["404 non-JSON", () => new Response("nope", { status: 404 })],
    [
      "404 NoSuchBucket",
      () =>
        Response.json(
          { success: false, errors: [{ code: 10006 }] },
          { status: 404 },
        ),
    ],
    ["500", () => Response.json({ success: false }, { status: 500 })],
    ["200 non-JSON", () => new Response("<html>", { status: 200 })],
    [
      "403 success:false",
      () => Response.json({ success: false }, { status: 403 }),
    ],
    ["result null", () => Response.json({ success: true, result: null })],
    ["result {}", () => Response.json({ success: true, result: {} })],
    [
      "rules string",
      () => Response.json({ success: true, result: { rules: "x" } }),
    ],
  ];
  it.each(bad)("GET %s: no PUT, ok:false", async (_n, res) => {
    const f = getResp(res);
    expect(await run(f)).toEqual({ skipped: false, ok: false });
    expect(puts(f)).toHaveLength(0);
  });

  it("timeout/abort is ok:false without throwing, and fetches carry a signal", async () => {
    const abort = vi
      .fn()
      .mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect(await run(abort as never)).toEqual({ skipped: false, ok: false });
    const f = fakeFetch([]);
    await run(f as never);
    for (const [, init] of f.mock.calls)
      expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("never throws when deps are malformed", async () => {
    expect(
      await syncCustomOriginsCors([], { fetch: null, env: null } as never),
    ).toEqual({ skipped: false, ok: false });
  });
});
