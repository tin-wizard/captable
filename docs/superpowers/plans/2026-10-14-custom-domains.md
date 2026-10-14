# Custom Company Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every company keeps its default address (`<name>.dealroom.tin.info`) and can add its own domain such as `investors.implexus.io`, the way Vercel does: add it in Settings, prove ownership with DNS, and from then on it is the company's address and the default address redirects to it.

**Architecture:** The registry already models this: `CompanyDomain` has `kind PLATFORM|CUSTOM`, one primary per company, unique live hostnames, and every link and email already goes through `primaryHostname()`. We add a `PENDING` status plus a verification token, a small module that validates hostnames, checks DNS and moves the primary, a tRPC sub-router and a Settings card. TLS certificates come from Caddy on-demand TLS gated by an authenticated "ask" endpoint, and upload CORS is kept in sync with the verified origins through the Cloudflare API.

**Tech Stack:** Next.js 16, Prisma 5.14, tRPC v10, `node:dns/promises`, Caddy 2.10 (on-demand TLS), Cloudflare R2 CORS API, vitest 1.6, Playwright, Biome 1.7.3, pnpm.

**Spec:** Chat decisions of 2026-10-14: (1) Vercel-style default domain plus custom domains; (2) the default address redirects to the custom one; (3) R2 CORS best practice = explicit origin allow-list kept in sync, never `*`; (4) only admins (`company:update`) manage domains. Code audit via graphify of `src/server/domains/*` and `src/trpc/routers/domain-router`.

## Rules of the model (read first)
- A company always has exactly one **primary** live address. Every other live row is an `ALIAS` that redirects to the primary (`aliasExpiresAt = null` means permanent). The platform address is never deleted; it becomes a permanent alias while a custom domain is primary.
- `PENDING` = added but not yet proven. It does not resolve, never gets a certificate, and does not block anyone else from claiming the same hostname.
- Ownership proof = a TXT record `_dealroom-challenge.<hostname>` equal to the row's `verificationToken`; routing proof = the hostname is a CNAME (chain) to our canonical host or any `*.<baseDomain>` host, or an A record equal to one of `CUSTOM_DOMAIN_IPS`.

## Global Constraints
- Everything is behind `DOMAINS_ENABLED=1`; with the flag off the custom-domain procedures return `NOT_FOUND`, the Settings card renders nothing, `/api/domains/tls-ask` returns 404.
- Only `company:update` (admins) may list, add, verify, set primary or remove custom domains (`list` included, because it returns the verification token).
- No new dependency. DNS uses `node:dns/promises`; the Cloudflare call uses `fetch`.
- Hostnames are lowercase ASCII only; internationalised names must be entered in `xn--` form. No ports, paths, IPs, single labels, underscores, or anything equal to or under the platform base domain or the canonical host.
- The new environment variables are all optional: `CUSTOM_DOMAIN_IPS` (comma list of server IPs for apex A-record routing), `TLS_ASK_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`. Missing `TLS_ASK_SECRET` means the ask endpoint always answers 404 (no certificates are ever issued); missing Cloudflare values mean CORS sync is skipped and the UI says so.
- One additive migration only. Production applies it by hand (Neon backup branch first) before the image. Never bare `git stash`; one vitest process; `pnpm biome check <files>`, `pnpm tsc --noEmit`, full vitest green before the PR.

## Review Focus
1. **Hostname takeover.** Another company's `PENDING` row never blocks a claim; an `ACTIVE`/`ALIAS` row of another company always does; a token from company A never verifies the same hostname for company B. Pinned in Task 1.
2. **Hostnames that must be refused:** IPs, `localhost`, `x.dealroom.tin.info`, the canonical host, uppercase, unicode, underscores, ports, URLs with paths, trailing dots, single labels. Pinned in Task 1.
3. **Never zero addresses.** Removing the primary custom domain promotes the platform address; nothing can leave a company with no primary. Pinned in Task 1.
4. **Canonical-only pages on a custom host** (`/signup`, `/forgot-password`, `/reset-password/*`, `/verify-email`, `/onboarding`, `/company/new`, `/logout`) redirect to the canonical host exactly as on platform hosts. Pinned in Task 2.
5. **TLS ask cannot be used to enumerate** custom domains or to obtain certificates for unverified hosts: wrong or missing secret -> 404; `PENDING` and `RELEASED` -> 404. Pinned in Task 2.
6. **Rename vs custom primary.** Renaming the platform address while a custom domain is primary is refused with a clear error (it would otherwise create a second primary). Pinned in Task 1.
7. **Resolve cache.** Every mutation clears the registry resolve cache so a verified or removed domain takes effect immediately. Pinned in Task 1.

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Schema, hostname rules, DNS check, registry | `opus` | `general-purpose` | Tenant ownership and takeover risk; security rule 3 |
| 2. tRPC, proxy, TLS ask endpoint | `opus` | `general-purpose` | Auth path, host resolution, certificate gating |
| 3. R2 CORS sync | `sonnet` | `general-purpose` | One external API call behind a fake fetch; exact shape in the task |
| 4. Settings card | `sonnet` | `general-purpose` | Composition with existing components over a tested API |
| 5. Runbook and e2e | `sonnet` | `general-purpose` | Config text plus one spec; reviewed by the orchestrator |
| Reviews | `opus` for 1 and 2, `sonnet` for 3-5; final review `opus` | `general-purpose` | Per matrix |
| Production steps (migration, Caddy, env, deploy) | orchestrator only | — | Needs the user's approval |

---

### Task 1: Schema, hostname rules, DNS check and registry functions

**Files:**
- Modify: `prisma/schema.prisma` (enum `DomainStatus`, model `CompanyDomain`)
- Create: `prisma/migrations/20261023000000_custom_domains/migration.sql`
- Create: `src/server/domains/core/custom-hostname.ts`, `src/server/domains/core/custom-hostname.test.ts`
- Create: `src/server/domains/dns.ts`, `src/server/domains/dns.test.ts`
- Create: `src/server/domains/custom.ts`, `tests/domains/custom-domains.test.ts`
- Modify: `src/server/domains/registry.ts` (permanent aliases, rename guard)
- Modify: `src/env.js` (optional vars)

**Interfaces (produced):**

```ts
// core/custom-hostname.ts (pure, no Node imports)
export type CustomHostnameResult =
  | { ok: true; hostname: string }
  | { ok: false; reason: "empty" | "format" | "platform" };
export function normalizeCustomHostname(
  raw: string,
  cfg: { canonicalHost: string; baseDomain: string },
): CustomHostnameResult;

// dns.ts
export const challengeName = (hostname: string) => `_dealroom-challenge.${hostname}`;
export type DnsDeps = {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
};
export const realDnsDeps: DnsDeps;
export function checkDomainDns(
  input: { hostname: string; token: string; canonicalHost: string; baseDomain: string; serverIps: string[] },
  deps: DnsDeps,
): Promise<{ owned: boolean; routed: boolean }>;

// custom.ts
export type CustomDomainErrorCode =
  | "empty" | "format" | "platform" | "taken" | "limit" | "not-found" | "not-verified";
export class CustomDomainError extends Error { code: CustomDomainErrorCode }
export type DomainRow = {
  id: string; hostname: string; kind: "PLATFORM" | "CUSTOM";
  status: "PENDING" | "ACTIVE" | "ALIAS"; isPrimary: boolean;
  verificationToken: string | null; verifiedAt: Date | null;
};
export function listDomains(companyId: string): Promise<DomainRow[]>;
export function addCustomDomain(i: { companyId: string; raw: string; createdById: string }): Promise<DomainRow>;
export function verifyCustomDomain(
  i: { companyId: string; domainId: string }, deps?: DnsDeps,
): Promise<{ ok: true; row: DomainRow } | { ok: false; owned: boolean; routed: boolean }>;
export function setPrimaryDomain(i: { companyId: string; domainId: string }): Promise<void>;
export function removeCustomDomain(i: { companyId: string; domainId: string }): Promise<void>;
export function liveCustomHostnames(): Promise<string[]>; // ACTIVE and ALIAS custom rows, for CORS sync and TLS ask
```

- [ ] **Step 1: Migration and schema.** `prisma/schema.prisma`: add `PENDING` to `DomainStatus`; add to `CompanyDomain`: `verificationToken String?` and `verifiedAt DateTime?`. Migration (the new enum value cannot be used in the same transaction, so the new index predicate names only existing values):

```sql
ALTER TYPE "DomainStatus" ADD VALUE 'PENDING';
ALTER TABLE "CompanyDomain" ADD COLUMN "verificationToken" TEXT, ADD COLUMN "verifiedAt" TIMESTAMP(3);
-- A pending claim must not block the real owner: only ACTIVE/ALIAS rows own a hostname.
DROP INDEX "CompanyDomain_hostname_live_key";
CREATE UNIQUE INDEX "CompanyDomain_hostname_live_key"
  ON "CompanyDomain" ("hostname") WHERE "status" IN ('ACTIVE', 'ALIAS');
```
Run `pnpm prisma generate`; apply to the local test DB (localhost:54331 `captable_test`) the way earlier migrations were (psql of this file only if `migrate deploy` hits old drift).

- [ ] **Step 2: Failing tests for the pure hostname rules** (`custom-hostname.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { normalizeCustomHostname } from "./custom-hostname";

const cfg = { canonicalHost: "dealroom.tin.info", baseDomain: "dealroom.tin.info" };
const ok = (raw: string) => normalizeCustomHostname(raw, cfg);

describe("normalizeCustomHostname", () => {
  it("accepts a plain subdomain and a pasted URL", () => {
    expect(ok("investors.implexus.io")).toEqual({ ok: true, hostname: "investors.implexus.io" });
    expect(ok("  HTTPS://Investors.Implexus.io/path?x=1 ")).toEqual({ ok: true, hostname: "investors.implexus.io" });
    expect(ok("implexus.io")).toEqual({ ok: true, hostname: "implexus.io" });
  });
  it("accepts punycode labels", () => {
    expect(ok("xn--bcher-kva.example.com")).toMatchObject({ ok: true });
  });
  it("refuses the platform domain and anything under it", () => {
    for (const h of ["dealroom.tin.info", "acme.dealroom.tin.info", "a.b.dealroom.tin.info"])
      expect(ok(h)).toEqual({ ok: false, reason: "platform" });
  });
  it("refuses empty and badly formed input", () => {
    expect(ok("")).toEqual({ ok: false, reason: "empty" });
    for (const bad of [
      "localhost", "a.localhost", "10.0.0.1", "1.2.3.4", "[::1]", "a_b.example.com",
      "exa mple.com", "example.com:8080", "example.com.", "-a.example.com",
      "a..example.com", "bücher.example.com", "a.b", "x".repeat(64) + ".com",
      "example.internal", "example.local",
    ])
      expect(ok(bad), bad).toEqual({ ok: false, reason: "format" });
  });
});
```

- [ ] **Step 3:** Run, expect FAIL. Implement `custom-hostname.ts`:

```ts
// Pure: also imported by client components.
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const BAD_TLDS = new Set(["localhost", "local", "internal", "invalid"]);

export function normalizeCustomHostname(raw, cfg) {
  const h = (raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0] ?? "");
  if (!h) return { ok: false, reason: "empty" };
  const labels = h.split(".");
  const tld = labels[labels.length - 1] ?? "";
  if (h.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !TLD.test(tld) || BAD_TLDS.has(tld))
    return { ok: false, reason: "format" };
  if (h === cfg.canonicalHost || h === cfg.baseDomain || h.endsWith(`.${cfg.baseDomain}`))
    return { ok: false, reason: "platform" };
  return { ok: true, hostname: h };
}
```
Note the reserved-label list for platform labels does not apply here; a company may own `tin.example.com`. Run the test, expect PASS.

- [ ] **Step 4: Failing tests for the DNS check** (`dns.test.ts`) with injected deps:

```ts
import { describe, expect, it } from "vitest";
import { checkDomainDns, challengeName, type DnsDeps } from "./dns";

const base = { hostname: "investors.implexus.io", token: "tok123", canonicalHost: "dealroom.tin.info", baseDomain: "dealroom.tin.info", serverIps: ["91.98.230.192"] };
const none = async () => { throw Object.assign(new Error("nx"), { code: "ENODATA" }); };
const deps = (o: Partial<DnsDeps>): DnsDeps => ({ resolveTxt: none, resolveCname: none, resolve4: none, ...o });

describe("checkDomainDns", () => {
  it("owned when the challenge TXT equals the token (chunks joined)", async () => {
    const d = deps({ resolveTxt: async (n) => (n === challengeName(base.hostname) ? [["to", "k123"]] : []) });
    expect(await checkDomainDns(base, d)).toEqual({ owned: true, routed: false });
  });
  it("not owned for another token or no record", async () => {
    expect((await checkDomainDns(base, deps({ resolveTxt: async () => [["other"]] }))).owned).toBe(false);
    expect((await checkDomainDns(base, deps({}))).owned).toBe(false);
  });
  it("routed by CNAME to the canonical host or any platform host", async () => {
    expect((await checkDomainDns(base, deps({ resolveCname: async () => ["dealroom.tin.info"] }))).routed).toBe(true);
    expect((await checkDomainDns(base, deps({ resolveCname: async () => ["acme.dealroom.tin.info"] }))).routed).toBe(true);
    expect((await checkDomainDns(base, deps({ resolveCname: async () => ["evil.example.net"] }))).routed).toBe(false);
  });
  it("routed by A record only when it matches a configured server IP", async () => {
    expect((await checkDomainDns(base, deps({ resolve4: async () => ["91.98.230.192"] }))).routed).toBe(true);
    expect((await checkDomainDns(base, deps({ resolve4: async () => ["1.2.3.4"] }))).routed).toBe(false);
    expect((await checkDomainDns({ ...base, serverIps: [] }, deps({ resolve4: async () => ["91.98.230.192"] }))).routed).toBe(false);
  });
});
```
Implement `dns.ts` (`realDnsDeps` wraps `node:dns/promises` `resolveTxt`/`resolveCname`/`resolve4` with a 5 s `Promise.race` timeout; every lookup error counts as "no record").

- [ ] **Step 5: Failing integration tests** (`tests/domains/custom-domains.test.ts`, same fixtures and `vi.mock("@/server/domains/config")` as `tests/domains/registry.test.ts`, two tenants `a`, `b`, a `fakeDns(ok: boolean)` helper returning TXT = the row token and CNAME = `dealroom.tin.info`). Cases, each asserting real rows: (a) `addCustomDomain` creates a `PENDING`, non-primary row with a 32-hex token and refuses `platform`/`format`; adding the same hostname twice for one company is idempotent; (b) more than 5 non-released custom rows -> `limit`; (c) company B can add the same hostname while A's is `PENDING`, but after A verifies, B's `verifyCustomDomain` throws `taken` and B's token never verifies against A's row; (d) `verifyCustomDomain` with DNS missing returns `{ ok:false, owned:false, routed:false }` and the row stays `PENDING`; with DNS ok the row is `ACTIVE`, `isPrimary`, `verifiedAt` set, the old platform row is `ALIAS` with `aliasExpiresAt === null`, and `resolveHostname(platformHost)` returns `status: "ALIAS"` with `primaryHostname` = the custom host (permanent alias, even long after) and `resolveHostname(customHost)` returns `ACTIVE`; (e) a `PENDING` hostname does not resolve; (f) `primaryHostname(db, companyId)` returns the custom host; (g) `setPrimaryDomain` back to the platform row makes the custom one a permanent `ALIAS`, and refuses (`not-found`) a `PENDING` or another company's row; (h) `removeCustomDomain` of the primary promotes the platform row to `ACTIVE` primary, the custom row is `RELEASED`, and a second company can then add and verify that hostname; removing a `PENDING` row works and leaves the primary untouched; (i) `renamePlatformSubdomain` while a custom domain is primary throws `PlatformRenameBlockedError`; (j) `liveCustomHostnames()` contains ACTIVE and ALIAS custom hosts only; (k) the resolve cache is cleared (verify, then resolve immediately, no `clearResolveCache()` in the test between).
- [ ] **Step 6:** Run, expect FAIL. Implement `custom.ts` with these exact rules:
  - `addCustomDomain`: `normalizeCustomHostname` with `domainConfig()`; map failures to `CustomDomainError`; `findFirst` an existing non-`RELEASED` row for `(companyId, hostname)` and return it; `taken` when ANY other company has an `ACTIVE`/`ALIAS` row for the hostname; `limit` when the company already has 5 non-released `CUSTOM` rows; create `PENDING`, `isPrimary:false`, `verificationToken: randomBytes(16).toString("hex")`, `createdById`.
  - `verifyCustomDomain`: load the row (`companyId`, `kind: "CUSTOM"`, status `PENDING`; else `not-found`); `checkDomainDns` with `serverIps` from `CUSTOM_DOMAIN_IPS`; if not both true return the flags; otherwise in one `$transaction`: set `ACTIVE` + `verifiedAt`, then `makePrimary` (below); a `P2002` on the live-hostname index becomes `CustomDomainError("taken")`; `clearResolveCache()`.
  - `makePrimary(tx, companyId, domainId)`: `updateMany({ where: { companyId, isPrimary: true, id: { not: domainId } }, data: { isPrimary: false, status: "ALIAS", aliasExpiresAt: null } })` then `update({ where: { id: domainId }, data: { isPrimary: true, status: "ACTIVE", aliasExpiresAt: null } })`.
  - `setPrimaryDomain`: target must be this company's `ACTIVE` or `ALIAS` row (else `not-found`); `makePrimary`; clear cache.
  - `removeCustomDomain`: target must be this company's `CUSTOM` row in `PENDING|ACTIVE|ALIAS`; set `RELEASED`, `releasedAt`, `isPrimary:false`; if it was primary promote `findFirst({ where: { companyId, id: { not }, status: { in: ["ACTIVE","ALIAS"] } }, orderBy: { kind: "asc" } })` (platform sorts first) via `makePrimary`; clear cache.
  - Every query uses the unscoped `db` as `registry.ts` does and always includes `companyId` in `where`.
- [ ] **Step 7: Registry changes** (`registry.ts`): add a helper `liveAliasWhere()` returning `{ status: "ALIAS", OR: [{ aliasExpiresAt: null }, { aliasExpiresAt: { gt: new Date() } }] }` and use it everywhere an alias is considered live (`resolveHostname`, the `readonly` branch of `suggestAvailableLabel`, the `ownAlias` promotion in `renamePlatformSubdomain`, and `availability()`/`current` in `src/trpc/routers/domain-router/router.ts` — keep `current.aliases` listing only aliases that have an expiry). `releaseExpiredAliases` keeps `lt` so a null expiry never expires. Add `export class PlatformRenameBlockedError extends Error {}` and throw it at the top of `renamePlatformSubdomain` when the company's primary row has `kind: "CUSTOM"`. Add the failing-then-passing assertion for this in the Step 5 file (case i).
- [ ] **Step 8:** `src/env.js`: add `CUSTOM_DOMAIN_IPS`, `TLS_ASK_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` as optional strings (schema + runtimeEnv, same style as `TENANT_BASE_DOMAIN`).
- [ ] **Step 9:** Run `src/server/domains`, `tests/domains`, `tests/tenant/architecture.test.ts`, `tsc`, `biome`. Commit `feat(domains): custom domain model, DNS check and registry functions`.

---

### Task 2: tRPC procedures, proxy and the TLS ask endpoint

**Files:**
- Modify: `src/trpc/routers/domain-router/router.ts` (sub-router `custom`; map `PlatformRenameBlockedError`)
- Create: `src/app/api/domains/tls-ask/route.ts`, `tests/domains/tls-ask.test.ts`
- Modify: `src/proxy.ts`, `src/proxy.test.ts`
- Test: `tests/domains/domain-router.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 `custom.ts` exports.
- Produces (all `withAccessControl`, policy `{ company: { allow: ["update"] } }`, flag off -> `NOT_FOUND`): `domain.custom.list` -> `{ rows: DomainRow[], dnsTarget: string, txtName(hostname) is computed client-side }` (return `dnsTarget: domainConfig().canonicalHost`); `domain.custom.add({ hostname })` -> `DomainRow`; `domain.custom.verify({ domainId })` -> `{ ok: true } | { ok: false, owned: boolean, routed: boolean }`; `domain.custom.setPrimary({ domainId })`; `domain.custom.remove({ domainId })`. Errors: `CustomDomainError.code` -> `BAD_REQUEST` for `empty|format|platform|limit`, `CONFLICT` for `taken`, `NOT_FOUND` for `not-found`; the message is the code string so the client can map copy. Each mutation writes an `Audit` row (`domain.added`, `domain.verified`, `domain.primary-changed`, `domain.removed`) with the hostname in the summary, exactly like the existing `rename` mutation.

- [ ] **Step 1: Failing tests (router):** a member without `company:update` is refused on all five; admin round trip add -> verify (inject DNS by mocking `@/server/domains/dns` `realDnsDeps`) -> primary changes; flag off -> `NOT_FOUND`; `taken` is `CONFLICT`; audit rows exist; another company's `domainId` is `NOT_FOUND`; `rename` while a custom domain is primary is `BAD_REQUEST` with message `custom-primary`.
- [ ] **Step 2: Failing tests (proxy):** `https://investors.implexus.io/signup`, `/forgot-password`, `/reset-password/tok`, `/logout`, `/onboarding` redirect 307 to `${canonicalOrigin}<same path+search>` when the host classifies as `custom`; `/login` and `/abc/stakeholders` on a custom host are NOT redirected; a custom host never gets the platform label 404. In `proxy.ts` change the canonical-only branch from `cls.kind === "platform"` to `cls.kind === "platform" || cls.kind === "custom"` and leave the label-format 404 and the `noindex` header platform-only.
- [ ] **Step 3: Failing tests (ask endpoint)** `tests/domains/tls-ask.test.ts`: with `TLS_ASK_SECRET` unset -> 404 for everything; wrong or missing `secret` -> 404; correct secret + unknown host -> 404; `PENDING` -> 404; `RELEASED` -> 404; `ACTIVE` custom and `ALIAS` custom -> 200; a PLATFORM host -> 404; uppercase `domain` is lowercased; the response body is always empty.
- [ ] **Step 4: Implement** the route:

```ts
// Caddy calls this before it asks Let's Encrypt for a certificate (on-demand TLS).
import { env } from "@/env";
import { db } from "@/server/db";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: NextRequest) {
  const secret = env.TLS_ASK_SECRET;
  const params = request.nextUrl.searchParams;
  if (env.DOMAINS_ENABLED !== "1" || !secret || !same(params.get("secret") ?? "", secret))
    return new Response(null, { status: 404 });
  const domain = (params.get("domain") ?? "").toLowerCase();
  const live = domain
    ? await db.companyDomain.count({
        where: { hostname: domain, kind: "CUSTOM", status: { in: ["ACTIVE", "ALIAS"] } },
      })
    : 0;
  return new Response(null, { status: live ? 200 : 404 });
}
```
Implement the five procedures as thin wrappers over Task 1, mirroring `rename` for audit and error mapping.
- [ ] **Step 5:** Run `tests/domains`, `src/proxy.test.ts`, `tests/tenant/roles.test.ts`, `tests/tenant/architecture.test.ts`, `tsc`, `biome`. Commit `feat(domains): custom domain API, canonical-only on custom hosts, TLS ask`.

---

### Task 3: R2 CORS sync

**Files:**
- Create: `src/server/domains/cors.ts`, `src/server/domains/cors.test.ts`
- Modify: `src/server/domains/custom.ts` (call the sync after activate, remove, set-primary), `src/trpc/routers/domain-router/router.ts` (return `corsSynced: boolean`)

**Interfaces:** `syncCustomOriginsCors(origins: string[], deps?: { fetch: typeof fetch; env: { accountId?: string; token?: string; buckets: string[] } }): Promise<{ skipped: true } | { skipped: false; ok: boolean }>`; origins are `https://<hostname>` for `liveCustomHostnames()`.

Cloudflare R2 CORS API: `GET|PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket}/cors`, body/result `{ "rules": [ { "id": string, "allowed": { "methods": string[], "origins": string[], "headers": string[] }, "exposeHeaders"?: string[], "maxAgeSeconds"?: number } ] }`. Confirm the shape against the current Cloudflare R2 documentation (use the Context7 tool) before coding; if it differs, adapt the code and say so in the report.

- [ ] **Step 1: Failing tests** with a fake `fetch`: (a) no token or account id -> `{ skipped: true }` and zero fetch calls; (b) existing rules (the platform rule for `https://*.dealroom.tin.info` and a stale managed rule `dealroom-custom-domains`) -> one `PUT` per bucket whose rules are the untouched platform rule plus ONE managed rule with `id: "dealroom-custom-domains"` and exactly the given origins (sorted, unique); (c) empty origins -> the managed rule is removed, all other rules untouched; (d) a non-2xx or `success:false` response -> `{ skipped:false, ok:false }` and no throw; (e) the platform rule is never modified (deep-equal).
- [ ] **Step 2:** Implement: for each bucket in `[UPLOAD_BUCKET_PRIVATE, UPLOAD_BUCKET_PUBLIC]` deduped, GET, replace the managed rule (`methods: ["GET","PUT","HEAD"]`, `headers: ["*"]`, `maxAgeSeconds: 3600`), PUT. Best-effort: wrap in try/catch, never throw into the caller; log with the module logger. No origin is ever `*`.
- [ ] **Step 3:** In `custom.ts` call `void syncCustomOriginsCors(...)` AFTER the transaction commits (never inside it); surface the boolean to the router so the UI can say "Uploads from this address need the Cloudflare CORS entry" when `false`. Run tests, `tsc`, `biome`. Commit `feat(domains): keep R2 CORS in sync with verified custom domains`.

---

### Task 4: Settings card

**Files:**
- Create: `src/components/company/custom-domains.tsx`
- Modify: `src/app/(authenticated)/(dashboard)/[publicId]/settings/company/page.tsx` (render after `<CompanyAddress />`), `src/components/company/company-address.tsx` (hide the rename control when the primary address is a custom domain)
- Create: `src/components/company/custom-domains-copy.ts` + `custom-domains-copy.test.ts` (pure helpers)

**Interfaces:** pure helpers `txtRecord(hostname: string, token: string): { name: string; value: string }` -> `{ name: "_dealroom-challenge.<hostname>", value: token }`; `cnameRecord(hostname, target)`; `domainStatusLabel(row): "Primary" | "Redirects to primary" | "Pending verification"`.

- [ ] **Step 1: Failing test** for the three helpers (exact strings above, `Redirects to primary` for `ALIAS`, `Primary` when `isPrimary`, `Pending verification` for `PENDING`).
- [ ] **Step 2: Implement** the component with the existing UI kit (`Button`, `Input`, `AlertDialog` as in `company-address.tsx`; `api.domain.custom.*`; `toast`). Behaviour: renders nothing when `domain.current` says disabled; lists rows (platform first) with a status label; "Add domain" field with inline error copy (`format`: "Enter a domain like investors.example.com", `platform`: "That address belongs to Deal Room", `taken`: "That domain is already connected to another company", `limit`: "You can connect up to 5 domains"); for a `PENDING` row show a panel with the two DNS records as copyable rows (TXT `txtRecord(...)` and `CNAME <hostname> -> <dnsTarget>`, plus the note "Using the bare domain? Point an A record at our server instead and tell us"), a "Verify" button that shows which of "ownership" and "routing" is still missing using the `{ owned, routed }` result, and "Remove"; for an `ACTIVE`/`ALIAS` custom row show "Make primary" (when not primary) and "Remove" with a confirmation dialog that states what happens to the address ("People opening this address will be sent to <primary>"); a muted note when `corsSynced === false`. Only mounted for users who can update (the procedures refuse others anyway).
- [ ] **Step 3:** In `company-address.tsx` read `domain.custom.list` data (or extend `domain.current` with `primaryKind`) and return `null` for the rename control when the primary is a custom domain; show one line "Your default address <platform host> redirects to <custom host>".
- [ ] **Step 4:** Run the helper test, `tsc`, `biome`. Visual check on the dev server if one can be started (state plainly if not). Commit `feat(domains): custom domains card in company settings`.

---

### Task 5: Runbook and end-to-end

**Files:**
- Create: `docs/operations/custom-domains.md`
- Modify: `e2e/subdomains.spec.ts` (and `e2e/seed.ts` / `e2e/Caddyfile` / `e2e/playwright.config.ts` only if the harness can resolve a second domain)

- [ ] **Step 1: Runbook** `docs/operations/custom-domains.md`: (a) customer steps (CNAME to `dealroom.tin.info`, TXT record, apex note); (b) operator one-time setup — env vars (`TLS_ASK_SECRET` the same value in the app `.env` and in `.caddy.env`; `CUSTOM_DOMAIN_IPS=91.98.230.192`; a scoped Cloudflare API token with only "Workers R2 Storage: Edit" typed by the operator, plus `CLOUDFLARE_ACCOUNT_ID`); (c) the Caddyfile change, verified with `caddy validate` before reload (the terminal tool blocks `docker exec`, so run `docker run --rm -v /opt/captable/Caddyfile:/etc/caddy/Caddyfile:ro dealroom-caddy:2.10.2-cf0.2.4 caddy validate --config /etc/caddy/Caddyfile`):

```
{
	on_demand_tls {
		ask http://app:3000/api/domains/tls-ask?secret={env.TLS_ASK_SECRET}
	}
}

# ...existing "dealroom.tin.info, *.dealroom.tin.info" block unchanged...

# Any other host gets a certificate only if the app says it is a verified custom domain.
https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	reverse_proxy app:3000 {
		header_up X-Real-IP {remote_host}
	}
}
```
Confirm the `ask` syntax is still valid for Caddy 2.10 with the Caddy documentation (Context7) and record the result in the runbook; (d) test domain procedure (a throwaway `test-custom.tin.info` CNAME), rollback (restore Caddyfile backup, unset the secret = no certificates issued); (e) known limits (one server IP, 5 domains per company, platform rename blocked while a custom domain is primary).
- [ ] **Step 2: e2e.** Read `e2e/playwright.config.ts`, `e2e/Caddyfile` and `e2e/seed.ts`. If the harness can resolve an extra hostname (host-resolver rules or `*.test`), add one spec: seed a company with a CUSTOM `ACTIVE` primary row, then assert (a) the platform address redirects to the custom host, (b) `/login` on the custom host shows the company login page, (c) `/signup` on it redirects to the canonical host. If it cannot, skip the spec and say why in the report; the integration tests in Tasks 1-2 are the coverage.
- [ ] **Step 3:** `tsc`, `biome`, full vitest once. Commit `docs(domains): custom domain runbook and e2e`.

---

## Release (orchestrator only, with the user's approval at each step)
1. Merge the PR; build the image.
2. Neon backup branch, then apply migration `20261023000000_custom_domains` by hand with its `_prisma_migrations` row (statements in one transaction as in earlier releases).
3. Deploy the image with the usual script; verify health.
4. Operator step: add the env vars and the Caddyfile change per the runbook (backup first, `caddy validate`, `docker compose up -d caddy`).
5. Test with a throwaway domain you control, then connect `investors.implexus.io` for Implexus.
Nothing changes for existing companies: no custom rows exist, every platform address stays primary.

## Self-review
- **Coverage:** add/verify/primary/remove (Tasks 1-2), redirect to custom (permanent alias in Task 1, resolution unchanged), admins only (Task 2), TLS (Tasks 2 and 5), CORS best practice (Task 3), UI (Task 4), operations (Task 5).
- **Placeholders:** none; pure helpers and the endpoint are given in full, integration cases list exact assertions.
- **Types:** `DomainRow`, `CustomDomainError`, `DnsDeps`, `normalizeCustomHostname`, `syncCustomOriginsCors` are defined once and reused with the same names.
- **Known limits:** one server IP; platform address cannot be renamed while a custom domain is primary; the address box on `/login` still takes the platform address (it redirects); no wildcard custom domains; DNS checks are on demand (no background re-verification, so a domain that later loses its DNS keeps working until removed).
- **Karpathy/ponytail:** assumptions are stated first; no new dependency; skipped on purpose: multiple verification methods, automatic re-checks, per-domain redirects other than "to primary", subdomain-wildcard customer domains.
