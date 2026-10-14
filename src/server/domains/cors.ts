import { env as appEnv } from "@/env";
import { logger } from "@/lib/logger";

// Cloudflare R2 bucket CORS: GET|PUT /accounts/{id}/r2/buckets/{bucket}/cors,
// body { rules: [{ id?, allowed: { origins, methods, headers? }, exposeHeaders?, maxAgeSeconds? }] }.
export const MANAGED_CORS_ID = "dealroom-custom-domains";

type Rule = { id?: string } & Record<string, unknown>;
type Deps = {
  fetch: typeof fetch;
  env: { accountId?: string; token?: string; buckets: string[] };
};

const realDeps = (): Deps => ({
  fetch,
  env: {
    accountId: appEnv.CLOUDFLARE_ACCOUNT_ID,
    token: appEnv.CLOUDFLARE_API_TOKEN,
    buckets: [appEnv.UPLOAD_BUCKET_PRIVATE, appEnv.UPLOAD_BUCKET_PUBLIC],
  },
});

const TIMEOUT_MS = 5000;
const NO_SUCH_BUCKET = 10006;
let warnedSkip = false;

// Existing rules, or null when the response is not an unmistakable answer.
// Empty is accepted only from a JSON 404 {success:false} (R2 "no CORS
// configured"; the exact code is not documented, so NoSuchBucket is excluded).
async function readRules(res: Response): Promise<Rule[] | null> {
  const j = (await res.json().catch(() => null)) as {
    success?: boolean;
    errors?: { code?: number }[];
    result?: { rules?: unknown } | null;
  } | null;
  if (!j || typeof j !== "object") return null;
  if (res.ok)
    return j.success === true && Array.isArray(j.result?.rules)
      ? (j.result.rules as Rule[])
      : null;
  const noBucket = j.errors?.some((e) => e?.code === NO_SUCH_BUCKET);
  return res.status === 404 && j.success === false && !noBucket ? [] : null;
}

// An explicit controller and timer (always cleared) instead of AbortSignal.timeout:
// the timer also covers reading the body, and nothing is left pending after the call.
async function timed<T>(
  f: typeof fetch,
  url: string,
  init: RequestInit,
  read: (r: Response) => Promise<T>,
): Promise<{ res: Response; value: T }> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, { ...init, signal: c.signal });
    return { res, value: await read(res) };
  } finally {
    clearTimeout(t);
  }
}

// Best-effort and never throws: replaces only the managed rule, leaving the
// platform rule (and anything else) as read. Any unexpected GET aborts that
// bucket before a PUT, so a bad response can never wipe existing rules.
export async function syncCustomOriginsCors(
  origins: string[],
  deps?: Deps,
): Promise<{ skipped: true } | { skipped: false; ok: boolean }> {
  try {
    const { fetch: f, env } = deps ?? realDeps();
    const { accountId, token, buckets } = env;
    if (!accountId || !token) {
      if (!warnedSkip) {
        warnedSkip = true;
        logger.warn(
          "R2 CORS sync skipped: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN missing",
        );
      }
      return { skipped: true };
    }
    const unique = [...new Set(origins)].filter((o) => o !== "*").sort();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    let ok = true;
    for (const bucket of new Set(buckets)) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/cors`;
      try {
        const { res: got, value: existing } = await timed(
          f,
          url,
          { headers },
          readRules,
        );
        if (!existing) throw new Error(`unexpected GET response ${got.status}`);
        const rules = existing.filter((r) => r.id !== MANAGED_CORS_ID);
        if (unique.length)
          rules.push({
            id: MANAGED_CORS_ID,
            allowed: {
              origins: unique,
              methods: ["GET", "PUT", "HEAD"],
              headers: ["*"],
            },
            maxAgeSeconds: 3600,
          });
        const { res: put, value: pj } = await timed(
          f,
          url,
          { method: "PUT", headers, body: JSON.stringify({ rules }) },
          async (r) =>
            (await r.json().catch(() => null)) as {
              success?: boolean;
            } | null,
        );
        if (!put.ok || pj?.success === false)
          throw new Error(`PUT ${put.status}`);
      } catch (e) {
        ok = false;
        logger.warn({ err: e, bucket }, "R2 CORS sync failed");
      }
    }
    return { skipped: false, ok };
  } catch (e) {
    logger.warn({ err: e }, "R2 CORS sync failed");
    return { skipped: false, ok: false };
  }
}
