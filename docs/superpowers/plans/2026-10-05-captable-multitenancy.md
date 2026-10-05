# Captable Multitenancy Hardening + Hub Linkage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Captable's tenant isolation structural (not per-procedure convention), enforce roles on every cap-table mutation, and link each company/user to the TIN Hub's tenant/user identity without duplicating tenant logic.

**Architecture:** Keep Captable's own tenancy (`Company` + `Member`, NextAuth, Prisma, Neon). Add (1) one Prisma client extension that scopes every query to the caller's company, handed out by a single `withTenant` tRPC base procedure; (2) RBAC policies on every mutation; (3) explicit tenant-switching and tenant-owned files/emails; (4) Hub identity columns now, Hub sync later behind a gate. Hubs own *who/which customer*; Captable owns *what a member may do inside a company*.

**Tech Stack:** Next.js 14, tRPC 10 (`createCaller`), Prisma 5 client extensions, NextAuth 4 (JWT), Hono REST, Postgres (Neon), Vitest 1, Biome.

**Spec:** Section 1 of this document (design + decisions). Evidence: read-only audits of Captable, `shared-identity-hub`, `tin-boss-api`, `shared-client-care-hub`, and a graphify graph of `src/` (2,166 nodes, 7,356 edges, 90 communities).

## Global Constraints

- Never run tests or migrations against Neon. Tests use `TEST_DATABASE_URL` and refuse any non-local host (Task 1).
- Prisma stays at `^5.13` (extended `where` on unique operations is relied on). tRPC stays v10 (`router.createCaller(ctx)`).
- `relationMode = "prisma"` stays (no DB foreign keys); integrity is enforced in app code and the tenant extension.
- No new runtime dependency. Everything below uses Prisma, tRPC, Zod and Vitest, already installed.
- Commit after every task. Pre-commit runs `biome check --apply`; do not use `--no-verify`.
- One PR per phase, each opened against `main` (not stacked on an unmerged branch).
- Hub repos are read-only inputs. Fixes in them are listed as dependencies (section 5), not tasks here.

---

## 1. Design and decisions

### 1.1 What the code looks like today (from the graph)

- `checkMembership()` is the #3 hub node (degree 69, 36 files): the single tenant checkpoint, called by hand in 37 files.
- 44 files use `withAuth`, 20 use `withAccessControl` (role check), 9 are `withoutAuth`.
- 13 `withAuth` files never call `checkMembership`; the tenant-relevant ones are `create-bucket`, `get-document`, `create-document`, `get-updates`, `clone-update`. 41 places read `session.user.companyId` straight from the JWT.
- 37 Prisma models: 18 carry `companyId`; 6 are tenant-scoped only through a parent; the rest are global (`User`, `Account`, `Session`, `Passkey`, tokens, `Bucket`, `AccessToken`, billing).
- RBAC subjects exist for 9 areas; cap-table mutations (shares, options, SAFEs, share classes, equity plans, updates, data rooms, templates, member toggles) have **no** role check.

### 1.2 Decision gates (answer before the phase that needs them)

| # | Decision | Default used in this plan | Needed by |
|---|----------|---------------------------|-----------|
| D1 | Stay on NextAuth+Prisma, link to Hub by tenant id (not move to Supabase) | **Stay** | Phase 4 |
| D2 | Role matrix for CUSTOM roles on cap-table subjects (table in Task 8) | Read-only default; admins grant writes | Phase 2 |
| D3 | Which IdP the Hub fronts for login (Supabase Auth vs WorkOS) | Unknown — blocks Phase 4b only | Phase 4b |
| D4 | Add Postgres RLS as defense in depth | **Defer** (trigger in section 6) | Phase 5 |

### 1.3 Approaches considered

1. **Per-procedure filters (status quo).** Failed three times already in the audit. Rejected.
2. **Prisma client extension + one base procedure (chosen).** Lowest rung that gives a structural guarantee in the app layer: forgetting a filter becomes impossible for covered models. Limits: raw SQL and nested writes are not covered (guarded by a test, Task 5).
3. **Postgres RLS via per-transaction `SET LOCAL`.** Strongest, but needs a transaction around every request and does not help the connection pooler on Neon without care. Kept as Phase 5, gated.
4. **Adopt the Hub packages directly.** Rejected: `domain-identity` needs Supabase `auth.uid()` for isolation, gives Prisma nothing, and its tenant switching/sync/Next adapter are unbuilt.

### 1.4 Ownership split (this prevents duplicated logic)

| Concern | Owner |
|---------|-------|
| Identity of a person, SSO, platform operators | Hub |
| Which tenant a customer is (`tenant_id`) | Hub; Captable stores `hubTenantId` |
| Membership in a company, role, status | Captable (`Member`) |
| What a role may do (`cap-table` subjects) | Captable (`CustomRole`) |
| Tenant-scoped data access | Captable (tenant extension) |

---

## 2. File structure

| File | Responsibility |
|------|----------------|
| `src/server/tenant-db.ts` (new) | `tenantDb(db, companyId)`: Prisma extension scoping all tenant models |
| `src/trpc/api/trpc.ts` (modify) | add `withTenant`: session → active membership → `ctx.tenant` (scoped db, companyId, member) |
| `src/lib/rbac/subjects.ts` (modify) | new subjects for cap-table areas |
| `tests/tenant/*.test.ts` (new) | cross-tenant matrix + architecture guard |
| `vitest.config.ts` (new) + `tests/setup.ts` (new) | test DB guard + seeding |
| `prisma/schema.prisma` (modify) | `Stakeholder` composite unique, `Bucket.companyId`, `Company.hubTenantId`, `User.hubUserId` |

---

## 3. Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Test harness + DB guard | `sonnet` | `general-purpose` | Multi-file setup with edge cases (guard must be right) |
| 2. Cross-tenant matrix test (fails first) | `opus` | `general-purpose` | Security test design; decides what "isolated" means |
| 3. `tenantDb` extension | `opus` | `general-purpose` | Tenant isolation core; security rule 3 |
| 4. `withTenant` base procedure | `opus` | `general-purpose` | Auth path; security rule 3 |
| 5b. Reference-integrity guard | `opus` | `general-purpose` | Tenant isolation; security rule 3 |
| 5. Architecture guard test | `sonnet` | `general-purpose` | Test over file contents, clear spec |
| 6–7. Migrate routers (batches) | `sonnet` | `general-purpose` | Mechanical across files; **opus review** each batch |
| 8–9. RBAC subjects + policies | `opus` | `general-purpose` | Permissions design; rule 3 |
| 10. Explicit tenant switching | `opus` | `general-purpose` | Session/JWT/tenant; rule 3 |
| 11–12. Stakeholder email + Bucket owner migrations | `opus` | `general-purpose` | Schema + backfill touching isolation |
| 13. Hub identity columns | `haiku` | `general-purpose` | Two nullable columns, exact spec |
| Reviews | `opus` | `general-purpose` | Every phase touches tenant isolation |
| Deploys / prod migrations | orchestrator | — | Needs credentials; never delegated |

Before each later phase the orchestrator writes a **Previous Phase Context Review** (diff, test results, deviations, open items) and passes the findings into the next brief.

---

## 4. Phases and tasks

### Phase 0 — Safety net (no behaviour change)

#### Task 1: Test harness with a hard database guard

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`, `tests/helpers/seed.ts`
- Modify: `package.json` (`"test": "vitest run"`)

**Interfaces:**
- Produces: `seedTwoTenants(): Promise<{ a: Tenant; b: Tenant }>` where `Tenant = { companyId: string; memberId: string; userId: string; session: Session }`; `callerFor(t: Tenant)` returning `appRouter.createCaller(ctx)`.

- [ ] **Step 1: Write the guard test first**

```ts
// tests/setup.test.ts
import { describe, expect, it } from "vitest";
import { assertLocalTestDb } from "./setup";

describe("assertLocalTestDb", () => {
  it("accepts localhost", () => {
    expect(() => assertLocalTestDb("postgres://u:p@localhost:54331/captable_test")).not.toThrow();
  });
  it("rejects Neon and any remote host", () => {
    expect(() => assertLocalTestDb("postgres://u:p@ep-x.neon.tech/neondb")).toThrow();
    expect(() => assertLocalTestDb(undefined)).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run tests/setup.test.ts` → "assertLocalTestDb is not a function".

- [ ] **Step 3: Implement**

```ts
// tests/setup.ts
export function assertLocalTestDb(url: string | undefined) {
  const host = url ? new URL(url).hostname : "";
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error("TEST_DATABASE_URL must point at a local database (never Neon)");
  }
}
assertLocalTestDb(process.env.TEST_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
```

```ts
// vitest.config.ts
import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { setupFiles: ["tests/setup.ts"], include: ["tests/**/*.test.ts", "src/**/*.test.ts"] },
});
```

`setup.ts` runs for every test file, so it must not throw for the guard unit test: run that one file with `TEST_DATABASE_URL=postgres://u:p@localhost:54331/captable_test`.

- [ ] **Step 4: Create the test DB once** — `docker exec captable-database createdb -U captable captable_test`, then `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test pnpm prisma migrate deploy`.
- [ ] **Step 5: Seed helper.** `seedTwoTenants` creates two `User`, two `Company`, two `Member` (ADMIN, ACTIVE, onboarded) via Prisma, returns sessions shaped like `Session.user` (`id, memberId, companyId, companyPublicId, email, name`). Delete rows by id in `afterAll`.
- [ ] **Step 6: Run and commit** — `pnpm test` PASS; `git commit -m "test: add vitest harness with local-db guard"`.

#### Task 2: Cross-tenant matrix test (written to FAIL where gaps remain)

**Files:** Create `tests/tenant/cross-tenant.test.ts`

**Interfaces:** Consumes `seedTwoTenants`, `callerFor` (Task 1).

- [ ] **Step 1: Write the matrix.** For tenant B create one of each: share class, equity plan, stakeholder, document, update, data room, template, safe. Then, as tenant A's caller, attempt `read`, `update`, `delete`, and `link-as-reference` on B's ids. Expected for every case: throws or returns not-found; B's row is unchanged afterwards.

```ts
const cases: [string, (a: Caller, ids: Ids) => Promise<unknown>][] = [
  ["shareClass.update", (a, i) => a.shareClass.update({ ...validShareClass, id: i.shareClassId })],
  ["equityPlan.update", (a, i) => a.equityPlan.update({ ...validPlan, id: i.equityPlanId })],
  ["update.save",       (a, i) => a.update.save({ ...validUpdate, publicId: i.updatePublicId })],
  ["dataRoom.save",     (a, i) => a.dataRoom.save({ name: "x", publicId: i.dataRoomPublicId })],
  // ...one row per procedure that takes an id; list generated from appRouter keys (Step 2)
];
it.each(cases)("%s cannot touch another tenant", async (_n, run) => {
  await expect(run(callerA, idsB)).rejects.toThrow();
  expect(await b.snapshot()).toEqual(before);
});
```

- [ ] **Step 2: Generate the case list** from `Object.keys(appRouter._def.procedures)` and fail the suite if any id-taking procedure has no case (forces coverage as routers grow).
- [ ] **Step 3: Run.** Expect the six already-fixed holes to PASS and any unfixed ones to FAIL — record failures in the PR; they are the Phase 1 acceptance list.
- [ ] **Step 4: Commit** — `git commit -m "test: cross-tenant isolation matrix"`.

### Phase 1 — Structural tenant isolation

#### Task 3: `tenantDb` Prisma extension

**Files:** Create `src/server/tenant-db.ts`; Test `tests/tenant/tenant-db.test.ts`

**Interfaces:**
- Produces: `tenantDb(db: TPrisma, companyId: string)` — a Prisma client whose queries on tenant models are filtered/stamped with `companyId`.
- Produces: `TENANT_MODELS: ReadonlySet<string>`, `PARENT_SCOPED: Record<string, string>`.

- [ ] **Step 1: Failing tests** (real DB, two tenants): `findMany` returns only own rows; `findFirst({where:{id: otherTenantId}})` returns null; `update({where:{id: other}})` throws; `create` without `companyId` stamps it; `create` with a *different* `companyId` is overridden; `createMany` stamps all rows; a child model (`dataRoomDocument.findMany`) returns only rows whose parent belongs to the tenant; a non-tenant model (`user`) is untouched.
- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement**

```ts
// src/server/tenant-db.ts
import type { TPrisma } from "./db";

// models with a direct companyId column
export const TENANT_MODELS = new Set([
  "BankAccount", "Member", "CustomRole", "Stakeholder", "Audit", "ShareClass",
  "EquityPlan", "Document", "DataRoom", "Template", "Share", "Option",
  "Investment", "Safe", "ConvertibleNote", "Update", "EsignAudit",
]);

// child models scoped only through a parent relation
export const PARENT_SCOPED: Record<string, string> = {
  TemplateField: "template",
  EsignRecipient: "template",
  DataRoomDocument: "dataRoom",
  DataRoomRecipient: "dataRoom",
  DocumentShare: "document",
  UpdateRecipient: "update",
};

const WHERE_OPS = new Set([
  "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "findMany",
  "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany",
]);

export function tenantDb(db: TPrisma, companyId: string) {
  return db.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        // biome-ignore lint/suspicious/noExplicitAny: args shape varies per operation
        async $allOperations({ model, operation, args, query }: any) {
          const a = { ...args };
          if (TENANT_MODELS.has(model)) {
            if (WHERE_OPS.has(operation)) a.where = { ...a.where, companyId };
            else if (operation === "create") a.data = { ...a.data, companyId };
            else if (operation === "createMany")
              a.data = [a.data].flat().map((d: object) => ({ ...d, companyId }));
            else if (operation === "upsert") {
              a.where = { ...a.where, companyId };
              a.create = { ...a.create, companyId };
            } else throw new Error(`tenantDb: unsupported ${model}.${operation}`);
          } else if (model in PARENT_SCOPED) {
            const rel = PARENT_SCOPED[model] as string;
            if (WHERE_OPS.has(operation))
              a.where = { ...a.where, [rel]: { ...a.where?.[rel], companyId } };
            // creates on child models must go through the parent (checked in Task 5)
          }
          return query(a);
        },
      },
    },
  });
}
```

- [ ] **Step 4: Run tests, expect PASS.** If `findUnique` rejects the extra `where` key, switch those two ops to `findFirst`/`findFirstOrThrow` inside the extension (ponytail: only if the test shows the failure).
- [ ] **Step 5: Commit** — `git commit -m "feat: tenant-scoped prisma client extension"`.

**Known limits (written into the file header):** raw SQL (`$queryRaw`), nested writes inside `data`, and `include`d children are not scoped; Task 5 guards the first two; includes of parent-scoped children inherit the parent's scope.

#### Task 4: `withTenant` base procedure

**Files:** Modify `src/trpc/api/trpc.ts`; Test `tests/tenant/with-tenant.test.ts`

**Interfaces:**
- Consumes: `tenantDb`, existing `checkMembership` (`src/server/auth.ts`, already requires ACTIVE + onboarded + matching user).
- Produces: `withTenant` — like `withAuth`, plus `ctx.tenant = { db: ReturnType<typeof tenantDb>, companyId: string, memberId: string, role: Role, customRoleId: string | null }`.

- [ ] **Step 1: Failing tests:** an inactive member is rejected; a member of company A whose JWT claims company B is rejected; a valid member gets `ctx.tenant.companyId` equal to their membership and a `db` that cannot read the other tenant.
- [ ] **Step 2: Implement**

```ts
export const withTenant = t.procedure.use(authMiddleware).use(async ({ ctx, next }) => {
  const m = await checkMembership({ session: ctx.session, tx: ctx.db });
  return next({
    ctx: {
      ...ctx,
      tenant: { db: tenantDb(ctx.db, m.companyId), companyId: m.companyId,
                memberId: m.memberId, role: m.role, customRoleId: m.customRoleId },
    },
  });
});
```

- [ ] **Step 3: Make `withAccessControl` build on it** (reuse `ctx.tenant`, drop its own membership lookup) so there is one membership resolution per request. Re-run the existing RBAC tests.
- [ ] **Step 4: Commit** — `git commit -m "feat: withTenant base procedure"`.

#### Task 5: Architecture guard (keeps it from regressing)

**Files:** Create `tests/tenant/architecture.test.ts`

- [ ] **Step 1: Write the test.** Scan `src/trpc/routers/**` and `src/server/api/routes/**`. Fail if a file (a) uses `withAuth` and references `ctx.db` outside an allowlist (`onboarding`, `passkey`, `common`, `get-profile`, `update-profile`, `update-password`, `accept-member`, `get-products`), (b) calls `$queryRaw`/`$executeRaw`, or (c) calls `.create` on a `PARENT_SCOPED` model without a parent id taken from a scoped lookup.
- [ ] **Step 2: Run, expect FAIL listing every unmigrated file** — this list is the migration to-do for Tasks 6–7. Commit the test with the allowlist set to current offenders so CI is green, then shrink the allowlist to zero as tasks complete.

#### Task 5b: Reference-integrity guard (added after the Task 2 matrix run)

`tenantDb` scopes which rows a query touches; it does not validate **ids a client supplies as data** (a `bucketId` or `memberId` pointing at another tenant). The matrix found 14 such cases (marked `it.fails` / `// GAP:` in `tests/tenant/cross-tenant.test.ts`). Fix with one shared guard, extending `assertTenantOwns` (`src/server/tenant-guard.ts`):

**Files:** Modify `src/server/tenant-guard.ts` (+ its test); modify the call sites below.

**Interfaces:** `assertTenantOwns(tx, companyId, refs)` gains `memberId`, `customRoleId`, `documentId`, `templateRecipientId`, `bucketId` (bucket check depends on Task 12's `Bucket.companyId`; until then it checks the id is referenced only by this company's rows).

| Gap (from the matrix) | Call site | Check |
|---|---|---|
| B's bucket attached to A's records | `add-share.ts:49`, `add-option.ts:45`, `create-safe.ts:79`, `add-existing-safe.ts:31`, `create-document.ts:33`, `create-template.ts:34` | `bucketId` |
| Field points at B's recipient | `template-field-router/procedures/add-fields.ts:114` | recipient belongs to A's template |
| Update/data-room recipient is B's member/stakeholder | `update/procedures/share-update.ts:53`, `data-room-router/router.ts:277` | `memberId`, `stakeholderId` |
| A's member given B's custom role | `rbac/access-control.ts:148` (`getRoleById`), `update-member.ts:23`, `invite-member.ts:76` | role `companyId` |
| `switchCompany` writes B's member row | `company-router/router.ts:48` | also `userId` (Task 10) |

- [ ] **Step 1:** for each row, add the guard call, run the matrix; the matching `it.fails` case now fails (the gap closed) — flip it to a normal `it`.
- [ ] **Step 2:** commit per row group. The 14 `it.fails` cases reach zero by the end of Phase 3.

Also found (not tenancy, fix opportunistically): `add-stakeholders.ts:27` fires an `Audit.create` without awaiting it inside a transaction; `audit.allEsignAudits` is an existence oracle for template ids.

#### Task 6: Migrate cap-table routers (batch 1: securities)

**Files (modify):** `share-class/router.ts`, `equity-plan/router.ts`, `securities-router/procedures/{add-share,add-option,delete-*,get-*}.ts`, `safe/procedures/*`, `stakeholder-router/**`

- [ ] **Step 1:** switch `withAuth` → `withTenant`; replace `checkMembership` calls and `ctx.db` with `ctx.tenant.db` / `ctx.tenant.companyId`. Remove now-redundant `companyId` in `where` only after the matrix test passes (keep them one release as belt-and-braces; remove in Task 7).
- [ ] **Step 2:** run `pnpm tsc --noEmit`, `pnpm test`; the matrix and architecture allowlist must shrink.
- [ ] **Step 3: Opus review** of the diff (brief includes the Phase 0 failures list). Commit per router.

#### Lessons from Task 6 that Task 7 must apply

- **A scoped client silently rewrites `where.companyId` to equality.** Any query that deliberately reads another company's rows (or `companyId: { not/in }`) is neutered, not rejected. `assertBucketUsable` was caught this way; it now uses a relation filter. `assertTenantOwns` (equality) is safe.
- **`company-router` `switchCompany` must stay on `withAuth` + `ctx.db`** (it reads the caller's membership in a *different* company). Move it into its own procedure file and add that file to `ALLOWLIST_TENANTLESS` with that reason; migrate `getCompany`/`updateCompany` normally.
- **Keep global-by-design:** `src/server/company.ts` (`getCompanyList`), the JWT callback in `src/server/auth.ts`, `accept-member.ts`, and all token-based public flows (`get-signing-fields`, `sign-template`, `esign-service`, data-room and update public pages).
- **Fix while migrating:** `member-router/procedures/revoke-invite.ts` (member lookup and token delete have no company check: a member of A can revoke B's invite tokens); `common/router.ts` is mislabelled tenantless in the allowlist (it reads the session company without `checkMembership`; move it to `withTenant`).
- **Extend the architecture test's rule (a)** to also flag `withTenant`/`withAccessControl` files that use `ctx.db`.
- Non-members now get `UNAUTHORIZED` from the middleware instead of `{ success: false }` in mutation bodies; check client code that relies on the old shape.

#### Task 7: Migrate remaining routers (batch 2)

**Files (modify):** `document-router`, `document-share-router`, `update`, `data-room-router`, `template-router`, `template-field-router`, `member-router`, `company-router`, `bucket-router`, `bank-accounts`, `audit-router`, REST `src/server/api/routes/**` (use the same `tenantDb` via the bearer/cookie membership already resolved in the middleware).

- [ ] **Step 1–3:** same as Task 6. REST: in `src/server/api/middlewares/*` set `c.set("tenantDb", tenantDb(db, membership.companyId))` and read it in handlers.
- [ ] **Step 4:** architecture allowlist reaches only the genuinely tenantless files (`onboarding`, `passkey`, `common`, profile/password, billing products). **Commit and open PR 1.**

### Phase 2 — Roles on every mutation

#### Task 8: Subjects and the role matrix (needs decision D2)

**Files:** Modify `src/lib/rbac/subjects.ts`; Test `src/lib/rbac/rbac.test.ts`

- [ ] **Step 1: Add subjects** `"securities"`, `"updates"`, `"data-rooms"`, `"templates"`, `"cap-table-settings"` (share classes, equity plans). Existing: `stakeholder`, `members`, `documents`, `roles`, `audits`, `billing`, `company`, `developer`, `bank-accounts`.
- [ ] **Step 2: Matrix (defaults; confirm with the business):**

| Subject | read | create/update | delete |
|---------|------|---------------|--------|
| securities (shares, options, SAFEs) | members | CUSTOM with `securities:create/update` | CUSTOM with `securities:delete` |
| cap-table-settings (classes, plans) | members | ADMIN or granted | ADMIN or granted |
| updates, data-rooms, templates | members | granted | granted |
| members (toggle, remove, re-invite, revoke) | members | **ADMIN or granted `members:update`**; cannot target self-demote or the last ADMIN | same |

- [ ] **Step 3: Test** that a CUSTOM role with no permissions is denied each mutation, an ADMIN is allowed, and removing/deactivating the last ADMIN is refused.
- [ ] **Step 4: Commit.**

#### Task 9: Apply policies to every mutation

**Files (modify):** each mutation procedure: swap `withTenant` → `withAccessControl` with `.meta({ policies: { <subject>: { allow: ["<action>"] } } })` per the matrix; add the last-admin guard to `toggle-activation`, `remove-member`, `re-invite`, `revoke-invite`.

- [ ] **Step 1:** extend `tests/tenant/cross-tenant.test.ts` with a "same-tenant, insufficient role" column (CUSTOM role, no grants) for every mutation. Expect FAIL, then implement, then PASS.
- [ ] **Step 2: Opus review. Commit. Open PR 2.**

### Phase 3 — Session, switching, tenant-owned data

#### Task 10: Explicit tenant switching

**Files:** Modify `src/server/auth.ts` (`jwt` callback), `src/trpc/routers/company-router/router.ts` (`switchCompany`); Test `tests/tenant/switch.test.ts`

- [ ] **Step 1: Failing tests:** `switchCompany` to a company where the caller is not an ACTIVE onboarded member throws and changes nothing (today it bumps `lastAccessed` on any member id); after a valid switch, the next request resolves the chosen company; deactivating a member invalidates it on the next request (already true via `checkMembership`).
- [ ] **Step 2: Implement.** `switchCompany` verifies `{ id: memberId, userId: session.user.id, status: "ACTIVE", isOnboarded: true }`, then bumps `lastAccessed`; the `jwt` callback keeps choosing the most recent *valid* member.
- [ ] **Step 3: Commit.**

#### Task 11: Stakeholder email unique per company

**Files:** Modify `prisma/schema.prisma:280` (`email String @unique` → drop; add `@@unique([companyId, email])`); new migration.

- [ ] **Step 1:** `pnpm prisma migrate dev --name stakeholder_email_per_company` against the **local** DB; confirm it drops the global unique and adds the composite one.
- [ ] **Step 2:** grep for `stakeholder.findUnique({ where: { email` and fix callers to use `companyId_email`. Test: the same email can be a stakeholder in two companies.
- [ ] **Step 3:** Commit. Production migration is run by the orchestrator, not delegated.

#### Task 12: Buckets get an owner

**Files:** Modify `prisma/schema.prisma` (`Bucket.companyId String?`, index), `src/trpc/routers/bucket-router/{schema,procedures/create-bucket}.ts`, `src/server/file-uploads.ts`; migration with backfill.

- [ ] **Step 1: Migration** adds nullable `companyId`; backfill SQL sets it from `Document.bucketId` and `Template.bucketId` (orphan buckets stay null and are flagged).
- [ ] **Step 2: `createBucket` stops accepting a client `key`.** The server generates `${companyPublicId}/${nanoid()}`; presigned GET/PUT only for keys with the caller's company prefix or a `Bucket.companyId` match.
- [ ] **Step 3: Tests:** tenant A cannot register or fetch tenant B's key. Commit. **Open PR 3** (Phases 3 tasks 10–12).

### Phase 4 — Hub linkage

#### Task 13: Hub identity columns (can ship now)

**Files:** Modify `prisma/schema.prisma`; migration.

- [ ] **Step 1:** add `Company.hubTenantId String? @unique` and `User.hubUserId String? @unique`. Nothing reads them yet.
- [ ] **Step 2:** a one-off admin script `scripts/link-hub-tenant.ts <companyPublicId> <hubTenantId>` (validates UUID, refuses to overwrite). Commit.

#### Phase 4b — Hub sync (BLOCKED; not tasks until the gate opens)

Gate opens when **all** of these exist in the Hubs (section 5): published signing key (JWKS), a stable claims contract containing `tenant_id` and a user id, a membership read endpoint or webhook in `tin-boss-api`, and decision D3. When open, Phase 4b becomes: (a) a NextAuth OIDC/WorkOS provider that maps the IdP organization → `Company.hubTenantId` and only provisions a `Member` for pre-linked companies; (b) an inbound signed webhook `POST /api/hub/memberships` that upserts `Member` status for linked companies; (c) platform-operator read access via a Hub claim, never via a DB role name. Written as its own spec + plan at that time.

### Phase 5 — RLS defense in depth (deferred)

Trigger: a second isolation bug found *despite* `tenantDb`, or a compliance requirement. Approach: `SET LOCAL app.company_id` inside an interactive transaction per request and `CREATE POLICY ... USING (company_id = current_setting('app.company_id'))` on the 18 tenant tables. Not planned now (YAGNI).

---

## 5. Dependencies in the Hub repos (not Captable tasks)

| Repo | Needed before Phase 4b |
|------|------------------------|
| `shared-identity-hub` | Close the `x-tenant-id` header bypass in `get_current_tenant_id()` (unaudited tenant pick by tenantless platform admins); one canonical "operator" definition (4 exist); tenant switching + `identity-next` (specified, unbuilt) |
| `tin-boss-api` | Tenant/membership read endpoint or webhook (none exist); JWKS endpoint; claims revocation story |
| `shared-client-care-hub` | Composite `(tenant_id, id)` foreign keys on CRM tables; unify `get_user_tenant_id` vs `get_current_tenant_id`. Not needed by Captable |

## 6. Risks and what would change the plan

- **Prisma won't accept the extra `where` on `findUnique`** → Task 3 Step 4 fallback (use `findFirst`).
- **A router relies on cross-tenant reads** (e.g. platform admin) → none found in the audit; the architecture test will surface any.
- **Raw SQL appears** → architecture test fails; use `tenantDb` or add a dedicated scoped helper.
- **Neon pooling** → `tenantDb` is app-level and unaffected; Phase 5 would need direct connections.
- **Bucket backfill leaves orphans** → report them; do not delete automatically.

## 7. Self-review

- **Spec coverage:** isolation (T2–T7), roles (T8–T9), switching/lifecycle (T10), tenant-owned data (T11–T12), Hub linkage (T13, 4b gate), regression guard (T5). Not covered by design: RLS (gated), Hub-side fixes (section 5).
- **Placeholders:** none; tasks 6–7 list exact files and the mechanical change; Task 8's matrix is a default pending decision D2.
- **Type consistency:** `tenantDb`, `TENANT_MODELS`, `PARENT_SCOPED`, `ctx.tenant`, `withTenant`, `seedTwoTenants`, `callerFor` are used with the same names throughout.
