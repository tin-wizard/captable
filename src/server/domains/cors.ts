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

// Best-effort and never throws: replaces only the managed rule, leaving the
// platform rule (and anything else) as read.
export async function syncCustomOriginsCors(
  origins: string[],
  deps: Deps = realDeps(),
): Promise<{ skipped: true } | { skipped: false; ok: boolean }> {
  const { accountId, token, buckets } = deps.env;
  if (!accountId || !token) return { skipped: true };
  const unique = [...new Set(origins)].filter((o) => o !== "*").sort();
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  let ok = true;
  for (const bucket of new Set(buckets)) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/cors`;
    try {
      const got = await deps.fetch(url, { headers });
      const j = (await got.json().catch(() => null)) as {
        success?: boolean;
        result?: { rules?: Rule[] };
      } | null;
      // a bucket with no CORS yet may answer 404; anything else must parse
      const existing = got.ok && j?.success ? j.result?.rules ?? [] : null;
      if (existing === null && got.status !== 404)
        throw new Error(`GET ${got.status}`);
      const rules = (existing ?? []).filter((r) => r.id !== MANAGED_CORS_ID);
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
      const put = await deps.fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ rules }),
      });
      const pj = (await put.json().catch(() => null)) as {
        success?: boolean;
      } | null;
      if (!put.ok || pj?.success === false)
        throw new Error(`PUT ${put.status}`);
    } catch (e) {
      ok = false;
      logger.warn({ err: e, bucket }, "R2 CORS sync failed");
    }
  }
  return { skipped: false, ok };
}
