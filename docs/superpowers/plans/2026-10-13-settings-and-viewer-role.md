# Company Settings (timezone, retention) and Viewer Role Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each company choose its timezone and how long view data is kept, and let an admin create a read-only "Viewer" role in one click.

**Architecture:** Two columns on `Company` (`timezone`, `viewRetentionMonths`) edited from a new "Preferences" card on the Company settings page through a dedicated procedure (the onboarding form and schema are not touched). Timezone is consumed in three places only: analytics day buckets, the digest send hour, and (later) nudge quiet hours. Retention replaces the global 24-month constant in the purge job. The Viewer preset is a client-side "Start from" choice in the existing role dialog; no new table.

**Tech Stack:** Next.js 16, Prisma 5.14 (relationMode "prisma"), tRPC v10, pg-boss 10, `Intl.DateTimeFormat` (no date library added), vitest, Biome 1.7.3, pnpm.

**Spec:** Chat decisions of 2026-10-13: retention choices 6 / 12 / 24 / 36 months or "Keep", default 24, always shown to admins; timezone per company; Viewer role = read data rooms, updates, documents, templates and audits, no holdings, no edit. Research: DocSend and Papermark publish no retention period; GDPR requires a documented purpose and period, not a number.

## Assumptions (stated so they can be corrected)
- Existing companies keep today's behaviour: `timezone = "UTC"`, `viewRetentionMonths = 24`.
- "Keep" is stored as `null` and means the purge skips that company. It is the admin's explicit choice.
- Retention applies to `ViewEvent` only. The audit log, e-sign audit and share records are not purged by it.
- A timezone change re-buckets how days are *displayed*; stored timestamps do not change.

## Global Constraints
- Migration is additive: two columns with defaults; the running image must keep working against the migrated schema.
- `company:update` permission is required to change either setting; reading them needs `company:read`.
- A timezone value must be a valid IANA name (validated with `Intl.DateTimeFormat`, not a hard-coded list); invalid values are rejected server side.
- No change to the onboarding schema `ZodOnboardingMutationSchema` or `company.updateCompany`.
- The digest keeps working with no behaviour change for companies left on UTC.
- `pnpm biome check <files>` (not `pnpm lint`), `pnpm tsc --noEmit`, full vitest green. One vitest process at a time. Never bare `git stash`.
- Production steps (migration, deploy) by the orchestrator with the owner's approval.

## Review Focus
1. **Day boundary.** An event at 23:30 UTC for a company in Pacific/Auckland (UTC+12/13) belongs to the next local day. Pinned in Task 2.
2. **DST.** A 30-day range across a DST change returns exactly one bucket per local calendar day, none doubled or missing. Pinned in Task 2.
3. **Retention "Keep".** A company with `null` is never purged; others are purged at their own cutoff in one run. Pinned in Task 3.
4. **Digest hour.** A UTC company gets its digest at 07:00 UTC and an Asia/Kolkata company at 07:30 Kolkata time (the job fires on the hour, so a :30 zone is reached when its local hour is 7), each exactly once per local day. Pinned in Task 4.
5. **Permission.** A member without `company:update` cannot change either value. Pinned in Task 1.
6. **Viewer preset.** It can never include `securities`, `stakeholders` write, `members`, `roles` or any non-read action. Pinned in Task 5.

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Columns, procedure, Preferences card | `sonnet` | `general-purpose` | Multi-file with a permission-gated mutation; Opus reviews (tenant data write) |
| 2. Timezone-aware day buckets | `opus` | `general-purpose` | Cross-cutting change to analytics aggregation; boundary and DST correctness |
| 3. Per-company retention purge | `sonnet` | `general-purpose` | Small job change with exact tests |
| 4. Digest at local 07:00 | `sonnet` | `general-purpose` | Schedule change, tested with injected clock; Opus reviews (emails, multi-company loop) |
| 5. Viewer preset | `sonnet` | `general-purpose` | UI plus a safety test |
| Reviews | `sonnet` (`opus` for 1, 2, 4) | `general-purpose` | Per matrix |

---

### Task 1: Columns, `company.updatePreferences`, Preferences card

**Files:**
- Modify: `prisma/schema.prisma` (Company), create `prisma/migrations/20261017000000_company_preferences/migration.sql`
- Create: `src/trpc/routers/company-router/procedures/preferences.ts`; modify `src/trpc/routers/company-router/router.ts`
- Create: `src/components/company/preferences-card.tsx`; modify `src/app/(authenticated)/(dashboard)/[publicId]/settings/company/page.tsx`
- Test: `tests/tenant/company-preferences.test.ts`; role case in `tests/tenant/roles.test.ts`

**Interfaces:**
- Produces: `Company.timezone: string` (default `"UTC"`), `Company.viewRetentionMonths: number | null` (default `24`); `company.preferences` (query, `company:read`) returning `{ timezone, viewRetentionMonths }`; `company.updatePreferences({ timezone, viewRetentionMonths })` (mutation, `company:update`), `viewRetentionMonths ∈ {6, 12, 24, 36, null}`; `src/lib/timezone.ts` exporting `isValidTimezone(tz: string): boolean`.

- [ ] **Step 1: Failing tests** (`tests/tenant/company-preferences.test.ts`)

```ts
it("saves a valid timezone and retention", async () => {
  await callerFor(a).company.updatePreferences({ timezone: "Europe/Berlin", viewRetentionMonths: 12 });
  const c = await db.company.findUniqueOrThrow({ where: { id: a.companyId } });
  expect(c).toMatchObject({ timezone: "Europe/Berlin", viewRetentionMonths: 12 });
});
it("null means keep forever", async () => {
  await callerFor(a).company.updatePreferences({ timezone: "UTC", viewRetentionMonths: null });
  expect((await db.company.findUniqueOrThrow({ where: { id: a.companyId } })).viewRetentionMonths).toBeNull();
});
it("rejects an unknown timezone and a retention that is not offered", async () => {
  await expect(callerFor(a).company.updatePreferences({ timezone: "Mars/Phobos", viewRetentionMonths: 24 })).rejects.toThrow();
  await expect(callerFor(a).company.updatePreferences({ timezone: "UTC", viewRetentionMonths: 7 as never })).rejects.toThrow();
});
it("only changes the caller's company and needs company:update", async () => {
  // member with company:read only is refused; tenant B's row is unchanged (seed helper pattern of activity-list.test.ts)
});
```

(Use the `memberWith` pattern from `tests/tenant/analytics-document.test.ts` for the last case and assert company B's values are still `UTC` / `24`.)

- [ ] **Step 2:** Run `pnpm vitest run tests/tenant/company-preferences.test.ts` — Expected FAIL.
- [ ] **Step 3: Migration and schema**

```sql
ALTER TABLE "Company" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "viewRetentionMonths" INTEGER DEFAULT 24;
```

```prisma
  // IANA name used for day buckets, the digest hour and quiet hours
  timezone            String @default("UTC")
  // null = keep view data until the company deletes it
  viewRetentionMonths Int?   @default(24)
```

- [ ] **Step 4: Procedure** (`isValidTimezone` is `try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true } catch { return false }`; apply `.refine(isValidTimezone)` in the zod input). Write an audit row `company.updated` with summary "<name> changed company preferences" in the same style as `updateCompany`. Read via tenant client scoped to `ctx.tenant.companyId`.
- [ ] **Step 5: Card** — a select of common timezones built from `Intl.supportedValuesOf("timeZone")` (browser) with the company's current value preselected, a retention select (6 months, 12 months, 24 months (default), 36 months, Keep until I delete it) with a one-line explanation under it: "View events older than this are deleted daily. The audit log is not affected." Show "Currently deleting data older than 24 months" using the saved value. Save button with toast.
- [ ] **Step 6:** Run the new test, `roles.test.ts` (add `company.updatePreferences` → `["company","update"]`), `architecture.test.ts`, `cross-tenant.test.ts`; tsc; biome.
- [ ] **Step 7:** Commit `feat(company): timezone and view retention preferences`.

---

### Task 2: Timezone-aware day buckets

**Files:**
- Modify: `src/server/analytics/range.ts` (add `tz` support), `document.ts`, `esign.ts`, `company.ts`, `src/trpc/routers/overview-router/procedures/summary.ts`, the three analytics procedures that call them
- Test: `src/server/analytics/range.test.ts` (extend), `tests/tenant/analytics-document.test.ts` (one tz case)

**Interfaces:**
- Produces: `localDay(date: Date, tz: string): string` (`YYYY-MM-DD` in `tz`), `dayBuckets(from, to, tz = "UTC"): string[]`, and `parseRange(input, now, tz = "UTC")` whose `from`/`to` are the instants of local midnight and local end of day. Callers pass `ctx` company timezone read once (`db.company.findUniqueOrThrow({ select: { timezone: true } })`).

- [ ] **Step 1: Failing tests** (`range.test.ts`)

```ts
it("localDay moves a late-UTC instant into the next day east of UTC", () => {
  expect(localDay(new Date("2026-03-10T23:30:00Z"), "Pacific/Auckland")).toBe("2026-03-11");
  expect(localDay(new Date("2026-03-10T23:30:00Z"), "UTC")).toBe("2026-03-10");
  expect(localDay(new Date("2026-03-10T03:30:00Z"), "America/Los_Angeles")).toBe("2026-03-09");
});
it("dayBuckets has one entry per local day across a DST change", () => {
  const b = dayBuckets(new Date("2026-03-05T12:00:00Z"), new Date("2026-03-15T12:00:00Z"), "America/New_York");
  expect(b).toEqual([...new Set(b)]);
  expect(b[0]).toBe("2026-03-05");
  expect(b.at(-1)).toBe("2026-03-15");
  expect(b).toHaveLength(11);
});
it("parseRange anchors to local midnight", () => {
  const r = parseRange({ range: "7d" }, new Date("2026-03-10T23:30:00Z"), "Pacific/Auckland");
  expect(localDay(r.to, "Pacific/Auckland")).toBe("2026-03-11");
  expect(r.days).toBe(7);
});
```

- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement** with `Intl.DateTimeFormat("en-CA", { timeZone, year, month, day })` for `localDay` (en-CA formats `YYYY-MM-DD`). `dayBuckets` walks calendar days by stepping from `localDay(from)` to `localDay(to)` using the string date (add one day with UTC date arithmetic on the `YYYY-MM-DD` value, never by adding 24 h to an instant, so DST cannot skip or duplicate a day). `parseRange` finds the instant of local midnight by taking the UTC instant of that date at 00:00 and correcting by `tz` offset at that moment (compute offset with `Intl.DateTimeFormat(..., { timeZoneName: "shortOffset" })` or the difference of `localDay` parts; keep the algorithm in one function with the tests above as its specification). Default `tz = "UTC"` keeps every existing call and test unchanged.
- [ ] **Step 4:** Thread `tz` through the four aggregators: replace each `day(e.createdAt)` / `toISOString().slice(0, 10)` key with `localDay(e.createdAt, tz)` and each `dayBuckets(range.from, range.to)` with the `tz` form. Add one case to `analytics-document.test.ts`: a company set to `Pacific/Auckland` with an event at 23:30 UTC appears in the next day's bucket.
- [ ] **Step 5:** Run the whole `tests/tenant/analytics-*.test.ts`, `overview-summary.test.ts`, `src/server/analytics`; tsc; biome.
- [ ] **Step 6:** Commit `feat(analytics): day buckets follow the company timezone`.

---

### Task 3: Per-company retention purge

**Files:** Modify `src/jobs/purge-view-events.ts`; test `tests/tenant/purge-view-events.test.ts` (extend).

**Interfaces:** `retentionCutoff(now: Date, months: number): Date`; the worker deletes, per company with a non-null `viewRetentionMonths`, `ViewEvent` rows older than that company's cutoff. `RETENTION_MONTHS` constant is removed (grep for other users first).

- [ ] **Step 1: Failing tests:** company A (12 months) loses a 13-month-old event and keeps an 11-month-old one; company B (`null`) keeps a 30-month-old event; company C (24) loses a 25-month-old event; a single run handles all three.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement: `db.company.findMany({ where: { viewRetentionMonths: { not: null } }, select: { id: true, viewRetentionMonths: true } })`, then one `deleteMany` per company with `{ companyId, createdAt: { lt: cutoff } }`. Keep the global `db` (platform job) and the per-company filter explicit.
- [ ] **Step 4:** Run the purge test and `view-events.test.ts`; commit `feat(retention): purge view events per company`.

---

### Task 4: Digest at local 07:00

**Files:** Modify `src/jobs/view-digest-email.ts`, `src/jobs/register.ts`; test `tests/tenant/view-digest-job.test.ts` (extend).

**Interfaces:** the worker accepts an optional `now` through a module-level injectable (`export const clock = { now: () => new Date() }`), runs hourly, and for each company sends only when `localHour(now, company.timezone) === 7`.

- [ ] **Step 1: Failing tests** (inject `clock.now`):
  - at `2026-03-10T07:00:00Z` a UTC company receives its digest and an Asia/Kolkata company does not (local 12:30);
  - at `2026-03-10T02:00:00Z` the Kolkata company receives it (local 07:30) and the UTC company does not;
  - running the worker twice within the same hour sends once (idempotency).
- [ ] **Step 2: Idempotency column.** Add `Company.lastDigestOn TEXT?` (the local `YYYY-MM-DD` of the last successful digest) in migration `20261018000000_digest_last_on` (`ALTER TABLE "Company" ADD COLUMN "lastDigestOn" TEXT;`). Skip a company when it equals today's local date; set it after a successful company run.
- [ ] **Step 3:** Change the schedule to `0 * * * *` in `register.ts` and unschedule the old `0 7 * * *` entry with `queue.unschedule("email.view-digest")` before scheduling (pg-boss keys schedules by name, so re-scheduling replaces it; verify with the `captable_queue.schedule` table in the test).
- [ ] **Step 4:** Run digest tests, `architecture.test.ts`; commit `feat(digest): send at 07:00 in the company timezone`.

---

### Task 5: Viewer role preset

**Files:** Modify `src/components/modals/role-create-update-modal.tsx`; test `src/components/modals/viewer-preset.test.ts` (pure).

**Interfaces:** `VIEWER_PRESET: Record<string, string[]>` exported from a small `src/lib/rbac/presets.ts` (subject → actions), built from the `SUBJECTS` list already in the modal: `read` on `data-rooms`, `updates`, `documents`, `templates`, `audits`; nothing else.

- [ ] **Step 1: Failing tests (pure):** every action in `VIEWER_PRESET` is `"read"`; the key set equals exactly `["audits","data-rooms","documents","templates","updates"]`; none of `securities`, `stakeholders`, `members`, `roles`, `company`, `billing`, `api-keys` appear; every key exists in the app's `SUBJECTS`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `presets.ts`; in the create dialog add a "Start from" select (Blank, Viewer (read-only)); choosing Viewer sets the permission inputs and the name field to "Viewer" if empty. Editing afterwards works as before.
- [ ] **Step 4:** Run the test, `roles.test.ts`, tsc, biome; commit `feat(roles): Viewer preset in the create role dialog`.

---

## Self-review
- **Coverage:** timezone setting and use (Tasks 1, 2, 4), retention setting and purge (Tasks 1, 3), Viewer preset (Task 5), admin sees the period (Task 1 card).
- **Karpathy check:** every task states its verification (tests listed first); no abstraction beyond one `localDay` helper; nothing speculative (no per-user timezone, no retention for other tables).
- **Ponytail:** reuses `Intl`, existing role dialog, existing job/queue patterns; skipped: per-user timezone, retention for audit data, a general presets system.
- **Known limits:** :30 and :45 offset zones send the digest at local `07:30` / `07:45` (the hour is 7); timezone changes re-bucket displays only.
- **Release:** two migrations (`company_preferences`, `digest_last_on`); apply both before the image; rollback-safe.
