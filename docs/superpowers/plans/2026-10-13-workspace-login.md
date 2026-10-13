# Company-First Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the login page company-aware, the way Outline's is: enter your company address first, a branded login on each company's own address, and a "choose a company" step for people who belong to several.

**Architecture:** Almost all the security plumbing already exists (host classification, one-time-code handoff between the canonical host and company hosts, neutral "address isn't set up" page). This plan only changes the front of the flow: (1) a client-side company-address box on the canonical `/login`; (2) a real `/login` page on company hosts instead of an immediate redirect, showing the company name and logo only when the company opted in; (3) a canonical `/choose-company` page used when a user belongs to more than one company. No server lookup is added for the address box, so it cannot be used to enumerate companies.

**Tech Stack:** Next.js 16 (App Router, `src/proxy.ts`), NextAuth, Prisma 5.14, tRPC v10, vitest 1.6, Playwright (`e2e/subdomains.spec.ts`), Biome 1.7.3, pnpm.

**Spec:** Chat decisions of 2026-10-13 after the Outline audit (fork at `/Users/developer/Projects/outline`: `app/scenes/Launchpad`, `server/utils/vault.ts`, `server/routes/api/auth/auth.ts`): (1) company address first, (2) company name and logo on the company login page are opt-in per company, (3) a chooser for multi-company users, (4) email magic link is out of scope (later).

## Global Constraints
- The address box never calls the server: it validates the label format in the browser and navigates to `https://<label>.<baseDomain>/login`. A wrong address ends on the existing neutral `/domain-not-found` page.
- Do NOT reject reserved labels client-side: the operator assigned `tin.dealroom.tin.info` although "tin" is in `RESERVED_LABELS`. Only the format (`validateLabel(...) === "format"`) is checked in the browser.
- A company host's login page reveals the company name and logo ONLY when `Company.showNameOnLogin` is true; otherwise it shows the host name (`acme.dealroom.tin.info`), which is already public.
- Unknown, invalid or alias hosts keep today's behaviour: unknown -> `${canonicalOrigin}/domain-not-found`; alias -> same path on the primary host; invalid -> 404 (proxy).
- The handoff routes, tenant cookie, CSRF check and `safeNextPath` rules are unchanged. `callbackUrl` always passes through `safeNextPath`.
- The chooser lists only the signed-in user's `ACTIVE`, onboarded memberships (via `getCompanyList`), links come from `companyHomeUrl` (built from the database), and `/choose-company` is canonical-only.
- Existing sign-in methods, the email/password form and `callbackUrl` handling on the canonical `/login` are unchanged and stay on the same page, so the e2e `login()` helper keeps working.
- Migration is additive (one boolean, default false); production applies it by hand with a Neon backup branch, like earlier releases. No new dependency. Never bare `git stash`; one vitest process; `pnpm biome check <files>`, `pnpm tsc --noEmit`.

## Review Focus
1. **No enumeration.** The address box makes no request; a company host with `showNameOnLogin = false` reveals nothing beyond its own host name. Pinned in Tasks 1 and 3.
2. **Open redirect / host injection.** The address box result and the "Continue" link are built from a validated label and `safeNextPath`, never from raw input. Pinned in Tasks 1 and 3.
3. **Reserved label that is really a company (`tin`).** The address box must still navigate for `tin`. Pinned in Task 1.
4. **Deep link survives.** A logged-out user opening `acme.../stakeholders` reaches the company login page, clicks Continue, and ends on `/stakeholders` after the handoff. Pinned in Task 3 (e2e).
5. **Chooser edge cases.** Zero memberships go to onboarding as today, one goes straight to its company, many see the chooser; a user never sees another user's companies, and non-members of a company never get a link to it. Pinned in Task 4.
6. **Company-host `/login` for an already-signed-in tenant session** redirects to the company home instead of showing the login page. Pinned in Task 3.

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Company-address box on canonical `/login` | `sonnet` | `general-purpose` | Small client component plus a pure helper with exact tests |
| 2. `showNameOnLogin` setting (migration, preferences, switch) | `sonnet` | `general-purpose` | Mirrors the existing preferences pattern; migration is one column |
| 3. Company-host login page and proxy change | `opus` | `general-purpose` | Auth path and host resolution; security rule 3 |
| 4. `/choose-company` page and home rule | `opus` | `general-purpose` | Session and membership listing; security rule 3 |
| Reviews | `opus` for 3 and 4, `sonnet` for 1 and 2; final review `opus` | `general-purpose` | Per matrix |

---

### Task 1: Company-address box on the canonical login page

**Files:**
- Create: `src/server/domains/core/workspace-url.ts`, `src/server/domains/core/workspace-url.test.ts`
- Create: `src/components/onboarding/company-address-form.tsx`
- Modify: `src/components/onboarding/signin/index.tsx` (render the box above the existing buttons), `src/app/(unauthenticated)/login/page.tsx` (pass base-domain props)

**Interfaces:**
- Produces: `workspaceLoginUrl(input: { label: string; baseDomain: string; scheme: "http" | "https"; port: string; next?: string | null }): { ok: true; url: string } | { ok: false; reason: "empty" | "format" }`; `CompanyAddressForm` props `{ baseDomain: string; scheme: "http" | "https"; port: string; next: string }`.
- Consumes: `validateLabel` from `src/server/domains/core/subdomain.ts`, `safeNextPath` from `src/server/domains/core/host.ts`.

- [ ] **Step 1: Write the failing test** (`workspace-url.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { workspaceLoginUrl } from "./workspace-url";

const cfg = { baseDomain: "dealroom.tin.info", scheme: "https" as const, port: "" };

describe("workspaceLoginUrl", () => {
  it("builds the company login url from a label", () => {
    expect(workspaceLoginUrl({ ...cfg, label: "konnect" })).toEqual({
      ok: true,
      url: "https://konnect.dealroom.tin.info/login",
    });
  });
  it("trims, lowercases and accepts a pasted full address", () => {
    expect(workspaceLoginUrl({ ...cfg, label: "  Konnect " })).toMatchObject({ ok: true });
    expect(
      workspaceLoginUrl({ ...cfg, label: "https://konnect.dealroom.tin.info/x" }),
    ).toEqual({ ok: true, url: "https://konnect.dealroom.tin.info/login" });
    expect(
      workspaceLoginUrl({ ...cfg, label: "konnect.dealroom.tin.info" }),
    ).toEqual({ ok: true, url: "https://konnect.dealroom.tin.info/login" });
  });
  it("keeps a reserved label that is a real company (tin)", () => {
    expect(workspaceLoginUrl({ ...cfg, label: "tin" })).toEqual({
      ok: true,
      url: "https://tin.dealroom.tin.info/login",
    });
  });
  it("rejects empty and badly formed labels, never a host of another domain", () => {
    expect(workspaceLoginUrl({ ...cfg, label: "" })).toEqual({ ok: false, reason: "empty" });
    for (const bad of ["a", "-ab", "ab-", "a--b", "a b", "evil.com", "a.b.dealroom.tin.info", "//evil.com", "x@y"]) {
      expect(workspaceLoginUrl({ ...cfg, label: bad })).toEqual({ ok: false, reason: "format" });
    }
  });
  it("passes the next path through safeNextPath only", () => {
    expect(
      workspaceLoginUrl({ ...cfg, label: "konnect", next: "/abc/stakeholders" }),
    ).toEqual({
      ok: true,
      url: "https://konnect.dealroom.tin.info/login?callbackUrl=%2Fabc%2Fstakeholders",
    });
    expect(
      workspaceLoginUrl({ ...cfg, label: "konnect", next: "https://evil.com" }),
    ).toEqual({ ok: true, url: "https://konnect.dealroom.tin.info/login" });
  });
  it("includes the dev port", () => {
    expect(
      workspaceLoginUrl({ baseDomain: "lvh.me", scheme: "http", port: "3000", label: "acme" }),
    ).toEqual({ ok: true, url: "http://acme.lvh.me:3000/login" });
  });
});
```

- [ ] **Step 2:** `pnpm vitest run src/server/domains/core/workspace-url.test.ts` (localhost `TEST_DATABASE_URL` exported as other tests do). Expected FAIL (module missing).
- [ ] **Step 3: Implement** `workspace-url.ts` as a pure module (no Node/Next imports): normalise the input (trim, lowercase, strip scheme, path, query and a trailing `.<baseDomain>`), reject `empty`, reject when the remainder contains a dot or `validateLabel(label) === "format"` (do not reject `reserved`), then build `${scheme}://${label}.${baseDomain}${port ? `:${port}` : ""}/login` and append `?callbackUrl=<encoded safeNextPath(next)>` only when `safeNextPath(next) !== "/"`.
- [ ] **Step 4:** Run the test. Expected PASS. Then build `CompanyAddressForm`: a small form "Company address" with an input and the suffix `.{baseDomain}`, a "Continue" button, an inline error ("Enter your company address" / "Use letters, numbers and hyphens"), submit calls `workspaceLoginUrl` and `window.location.assign(url)`; no network call. Render it in `SignInForm` above the passkey button with a short "Don't know your address? Log in below." line; pass `domainConfig()` values (`baseDomain`, `scheme`, `port`) and `safeNextPath(callbackUrl)` from the server page. When `DOMAINS_ENABLED` is off (`domainConfig().enabled === false`) render nothing new.
- [ ] **Step 5:** `pnpm tsc --noEmit`, `pnpm biome check` on changed files. Commit `feat(login): company address box on the login page`.

---

### Task 2: `showNameOnLogin` setting

**Files:**
- Create: `prisma/migrations/20261022000000_company_login_branding/migration.sql`
- Modify: `prisma/schema.prisma` (Company), `src/trpc/routers/company-router/procedures/preferences.ts`, the Preferences card component (find it with `grep -rn "autoNudge" src/components` — the card that already holds timezone, retention, auto-nudges and NDA text)
- Test: `tests/tenant/company-preferences.test.ts` (extend)

**Interfaces:**
- Produces: `Company.showNameOnLogin Boolean @default(false)`; `company.preferences` returns `showNameOnLogin: boolean`; `company.updatePreferences` accepts optional `showNameOnLogin: boolean`.

- [ ] **Step 1: Failing tests** in `company-preferences.test.ts`: (a) a new company reads `showNameOnLogin === false`; (b) `updatePreferences({ ...current, showNameOnLogin: true })` persists true and an audit row is written (reuse the existing audit assertion in that file); (c) omitting `showNameOnLogin` leaves it unchanged; (d) a member without `company:update` is refused (copy the existing refusal case).
- [ ] **Step 2:** Run it, expect FAIL. **Step 3:** Add the column (`showNameOnLogin Boolean @default(false)` after `ndaText`), the migration (`ALTER TABLE "Company" ADD COLUMN "showNameOnLogin" BOOLEAN NOT NULL DEFAULT false;`), select it in `preferencesProcedure`, add `showNameOnLogin: z.boolean().optional()` to the update input (it is already spread into `data`), and add a switch to the Preferences card: label "Show our name and logo on the login page", help text "When off, people opening your company address see only the address. Turn on to show your company name and logo." **Step 4:** Run the test file and `tests/tenant/roles.test.ts`; `pnpm prisma generate`; tsc; biome. **Step 5:** Commit `feat(company): opt-in company name on the login page`.

---

### Task 3: Company-host login page

**Files:**
- Create: `src/server/domains/login-view.ts`, `tests/tenant/login-view.test.ts`, `src/components/onboarding/tenant-login.tsx`
- Modify: `src/app/(unauthenticated)/login/page.tsx`, `src/proxy.ts` (`tenantAuthRedirect`: stop redirecting `/login`), `src/proxy.test.ts`

**Interfaces:**
- Consumes: `getRequestHost()` (`src/server/domains/request-host.ts`), `Company.showNameOnLogin` (Task 2), `safeNextPath`.
- Produces: `getTenantLoginView(input: { companyId: string; hostname: string; next: string | null }): Promise<{ title: string; subtitle: string; logo: string | null; continueHref: string; canonicalLoginHref: string }>` — `title` is the company name only when `showNameOnLogin`, else the hostname; `logo` is `Company.logo` only when opted in; `continueHref` is `/auth/handoff/start?next=<encoded safeNextPath(next)>`.

- [ ] **Step 1: Failing tests** (`tests/tenant/login-view.test.ts`, DB-backed like the other tenant tests): (a) not opted in -> `title` is the hostname and neither the company name nor logo appears anywhere in the returned object (`JSON.stringify` does not contain them); (b) opted in -> title is the company name and logo is returned; (c) `next` of `https://evil.com` and `//evil.com` yields `next=%2F`; (d) a deep path `/abc/stakeholders` survives; (e) the company id of another tenant never leaks (call with company A's id and assert B's name is absent).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement `getTenantLoginView` using the plain `db` client selecting only `name`, `logo`, `showNameOnLogin` for `companyId`.
- [ ] **Step 4:** Update `proxy.test.ts` first (failing): `tenantAuthRedirect("/login", ...)` now returns `null`; the "redirects tenant login to handoff" proxy test now expects no redirect (`NextResponse.next`) and the `x-dr-path` header; signup and canonical-only paths are unchanged. Then edit `tenantAuthRedirect` to drop the `/login` branch. Keep everything else in `proxy.ts` as is.
- [ ] **Step 5:** Branch `login/page.tsx` on `await getRequestHost()`: `canonical` -> today's behaviour (session redirect, then `SignInForm` with the Task 1 props); `tenant` -> if a tenant session exists redirect `/${host.publicId}`, else render `TenantLogin` from `getTenantLoginView` (title, optional logo, a primary "Continue" button linking `continueHref`, a secondary "Use a different company" link to `canonicalLoginHref`); `alias` -> `redirect(\`${tenantOrigin(host.redirectHost)}/login${search}\`)`; `unknown` -> `redirect(\`${canonicalOrigin}/domain-not-found\`)`. When `DOMAINS_ENABLED` is off the page is exactly today's.
- [ ] **Step 6:** Extend `e2e/subdomains.spec.ts`: (a) opening `${botskiUrl}/stakeholders` logged out lands on the company login page (path `/login`), "Continue" returns to `/stakeholders` after login (adjust the existing deep-link test at ~line 118-125 instead of duplicating it); (b) a company with the setting off shows its hostname and not its name on `/login`; with it on shows the name. Run `pnpm tsc --noEmit`, `pnpm biome check`, `pnpm vitest run src/proxy.test.ts tests/tenant/login-view.test.ts src/server/domains` and, if a local Playwright setup exists, the e2e file; otherwise note that CI runs it.
- [ ] **Step 7:** Commit `feat(login): company-host login page`.

---

### Task 4: Choose-a-company page

**Files:**
- Create: `src/app/(authenticated)/choose-company/page.tsx`, `src/components/onboarding/company-chooser.tsx`, `src/server/company-chooser.ts`, `tests/tenant/company-chooser.test.ts`
- Modify: `src/app/page.tsx` (home rule), `src/proxy.ts` (`CANONICAL_ONLY` gains `"/choose-company"`), `src/proxy.test.ts`

**Interfaces:**
- Consumes: `getCompanyList(userId)` (`src/server/company.ts`, returns `{ id, company: { id, publicId, name }, url }[]`).
- Produces: `chooserDecision(companies: { url: string }[]): { kind: "none" } | { kind: "single"; url: string } | { kind: "many" }` in `src/server/company-chooser.ts`.

- [ ] **Step 1: Failing tests** (`company-chooser.test.ts`): `chooserDecision([])` is `none`; one entry is `single` with its url; two or more is `many`. DB-backed: user with two active onboarded memberships gets both from `getCompanyList`, a user with one `ACTIVE` and one `INVITED`/non-onboarded membership gets one, and another user's company never appears.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement `chooserDecision`; in `src/app/page.tsx` keep the tenant-host branch; for a canonical session compute `chooserDecision(await getCompanyList(session.user.id))`: `single` -> redirect to its url, `many` -> `redirect("/choose-company")`, `none` -> the existing fallback (`/login`, which sends onboarding users to `/onboarding`). Do not touch the logged-in redirect inside `login/page.tsx`.
- [ ] **Step 4:** Build the page: server component requiring a session (`withServerComponentSession`), canonical host only (tenant host -> `notFound()`), lists the companies as cards (name, link to `company.url`), highlights the current one, and shows "Create a company" (`/company/new`) and "Log out" links. Add `/choose-company` to `CANONICAL_ONLY` and its proxy test.
- [ ] **Step 5:** e2e: a user with two companies logs in and lands on `/choose-company`, picks one, and arrives on that company's host; a user with one company still lands directly on it (adapt the existing `login()` assertions that expect a company page after login only if they break). tsc, biome, vitest on the new and touched tests. Commit `feat(login): choose a company`.

---

## Self-review
- **Coverage:** company address first (Task 1), opt-in branding (Tasks 2-3), chooser (Task 4), unknown/alias hosts unchanged (Task 3), magic link deferred (stated).
- **Placeholders:** none; Task 3 and 4 name exact functions and the exact behaviours tests assert.
- **Types:** `workspaceLoginUrl`, `getTenantLoginView`, `chooserDecision` are defined once and reused with the same names.
- **Known limits:** the company login page needs one extra click (Continue) versus today's instant redirect; the chooser appears on every landing at `/` for multi-company users; per-company sign-in methods and magic link are not included; the opt-in setting is per company and needs one hand-applied migration.
- **Release:** image plus migration `20261022000000_company_login_branding` (apply before the image, Neon backup branch first), everything off by default except the address box and the company login page, which are always on when domains are enabled.
