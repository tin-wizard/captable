# Automatic Reminders (Auto-Nudges) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optionally remind recipients who have not opened a shared data room or update, automatically, at most twice, only inside working hours, with a one-click opt-out for the recipient and a stop switch for the owner.

**Architecture:** The manual "Send reminder" logic (claim, expiry and cooldown checks, link, email, audit) is moved unchanged into one shared function that both the manual mutations and a new hourly job call. Opt-in lives at two levels (company master switch, per-room / per-update switch). Cadence is derived from a `nudgeCount` on the recipient. The recipient email carries a token-authenticated unsubscribe link.

**Tech Stack:** Next.js 16, Prisma 5.14, tRPC v10, pg-boss 10, react-email, vitest, Biome 1.7.3, pnpm.

**Spec:** Chat decisions of 2026-10-13: yes to auto-nudges; proposal accepted: opt-in per company and per room, day 3 and day 7 then stop, quiet hours 09:00–18:00 in the company timezone, a per-recipient stop, and a visible log. Depends on the Settings plan (`Company.timezone`); build that first.

## Assumptions
- Day 3 and day 7 are counted from the share (or re-share): the first auto reminder when the recipient has waited 3 days (the existing `UNOPENED_AFTER_DAYS`), the second when 4 more days have passed since the first. Never a third.
- A manual reminder counts as one of the two, so a person pressing the button never causes a duplicate auto reminder the same day.
- "Opened" means a human (non-bot) view, same as the Not opened yet list.
- The reminder email is the existing "Reminder:" email plus a footer line with an opt-out link. Auto and manual reminders look the same to the recipient, and the log says which was which.
- Nothing is sent for expired links, links expiring within 24 h, drafts or private updates, or recipients who opted out.

## Global Constraints
- Migration additive; the previously deployed image must keep working against the migrated schema.
- Off by default everywhere: `Company.autoNudge`, `DataRoom.autoNudge`, `Update.autoNudge` default false.
- A hard per-company cap of 200 automatic reminders per hourly run and 2 per recipient ever (`nudgeCount`), enforced in the claim, not only in the query.
- The unsubscribe route is token-authenticated by the existing recipient token, idempotent, and answers like an unknown link for revoked or unknown recipients.
- All sending goes through the existing email jobs (`shareDataRoomEmailJob`, `shareUpdateEmailJob`) with `reminder: true`.
- Audit rows: action `dataroom.nudged` / `update.nudged` (already allowed); actor `{ type: "company", id: companyId }` for automatic sends, the user for manual ones.
- Permissions: the company master switch needs `company:update`; room and update switches need `data-rooms:update` / `updates:update`; "Stop reminders" for a recipient needs the same as the manual button.
- `pnpm biome check <files>`, `pnpm tsc --noEmit`, full vitest green; one vitest process; never bare `git stash`. Production steps by the orchestrator with approval; not deployed near the hourly job's start.

## Review Focus
1. **No double send.** Two job runs overlapping, or the job and a manual click at the same moment. Expected: one email. Pinned in Task 2 (reuses the serializable claim).
2. **Quiet hours and timezone.** A company whose local time is 20:00 gets nothing; at 09:00 local it does. Pinned in Task 2.
3. **Stop conditions.** Opened, opted out, expired, expiring within 24 h, `nudgeCount = 2`, room switch off, company switch off. Each pinned in Task 2.
4. **Cross-company.** One company's switch or rows never cause an email about another company's room. Pinned in Task 2.
5. **Unsubscribe.** A forged or expired token does nothing; a valid one sets the flag once and later runs skip the recipient. Pinned in Task 3.
6. **Manual path unchanged.** The existing nudge tests stay green after the extraction. Pinned in Task 1.

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Extract the shared reminder function | `opus` | `general-purpose` | Moves concurrency-sensitive claim logic; must stay behaviour-identical |
| 2. Schema, cadence, hourly job | `opus` | `general-purpose` | Emails external parties automatically; multi-company loop |
| 3. Unsubscribe route and email footer | `opus` | `general-purpose` | Public token route |
| 4. Switches, Stop reminders, log display | `sonnet` | `general-purpose` | UI composition over procedures with role cases |
| Reviews | `opus` for 1, 2, 3; `sonnet` for 4 | `general-purpose` | Per matrix |

---

### Task 1: Extract the shared reminder function

**Files:**
- Create: `src/server/activity/send-reminder.ts`
- Modify: `src/trpc/routers/data-room-router/router.ts` (`nudge`), `src/trpc/routers/update/procedures/nudge-update.ts`
- Test: existing `tests/tenant/nudge.test.ts` (unchanged, must stay green) and a new `tests/tenant/send-reminder.test.ts`

**Interfaces:**
- Produces:

```ts
export type ReminderResult =
  | { sent: true }
  | { sent: false; reason: "expired" | "expiring" | "opened" | "cooldown" | "too-soon" | "not-found" | "opted-out" };

export async function sendReminder(
  db: TPrismaOrTransaction,
  args: {
    companyId: string;
    kind: "DATA_ROOM" | "UPDATE";
    targetId: string;
    recipientId: string;
    sender: { name: string; email: string | null };
    actor: { type: "user" | "company"; id: string };
    auto?: { minWaitDays: number };   // set by the job: waited-since threshold for this step
    context?: { requestIp: string; userAgent: string };
  },
): Promise<ReminderResult>;
```

The function contains exactly the current body of the two mutations after the permission check: look-up scoped by `companyId` (parent relation), expiry / expiring checks, opened check, serializable claim (`runSerializable`), `nudgeCount` increment inside the claim (added in Task 2), link build, `emit`, audit, and the release-on-failure path. Manual mutations map `{ sent: false, reason }` back to the same `TRPCError` codes and messages they throw today.

- [ ] **Step 1: Baseline:** run `pnpm vitest run tests/tenant/nudge.test.ts tests/tenant/roles.test.ts tests/tenant/cross-tenant.test.ts` — Expected PASS (record the count).
- [ ] **Step 2:** Move the logic into `send-reminder.ts`; replace both mutation bodies with: permission-checked input → `sendReminder(...)` → throw the mapped `TRPCError` for each non-sent reason (messages copied verbatim from the current code).
- [ ] **Step 3:** Write `send-reminder.test.ts`: each `reason` is returned for its condition (expired, expiring, opened, cooldown, too-soon, not-found) and `sent: true` emits exactly once.
- [ ] **Step 4:** Re-run Step 1's command plus the new test — Expected PASS with the same count plus the new cases; tsc; biome.
- [ ] **Step 5:** Commit `refactor(nudge): one shared reminder function`.

---

### Task 2: Schema, cadence and the hourly job

**Files:**
- Modify: `prisma/schema.prisma`; create `prisma/migrations/20261020000000_auto_nudges/migration.sql`
- Create: `src/jobs/auto-nudge.ts`, `src/server/activity/cadence.ts`; modify `src/jobs/register.ts`, `src/constants/job.ts`, `src/server/activity/send-reminder.ts`
- Test: `src/server/activity/cadence.test.ts`, `tests/tenant/auto-nudge-job.test.ts`

**Interfaces:**
- Migration:

```sql
ALTER TABLE "Company" ADD COLUMN "autoNudge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DataRoom" ADD COLUMN "autoNudge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Update" ADD COLUMN "autoNudge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DataRoomRecipient" ADD COLUMN "nudgeCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "nudgeOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UpdateRecipient" ADD COLUMN "nudgeCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "nudgeOptOut" BOOLEAN NOT NULL DEFAULT false;
```

- `cadence.ts`:

```ts
export const MAX_AUTO_NUDGES = 2;
export const SECOND_NUDGE_AFTER_DAYS = 4;
export const WORK_HOURS = { from: 9, to: 18 }; // local, [from, to)
export function inWorkHours(now: Date, tz: string): boolean;
// minimum days the recipient must have waited (since updatedAt) before the next automatic reminder, or null when none is due
export function nextStepWaitDays(nudgeCount: number): number | null; // 0 -> 3, 1 -> 4, >=2 -> null
```

- `sendReminder` increments `nudgeCount` inside the same serializable claim and refuses (`reason: "cooldown"`) when `nudgeCount` is already `>= 2` and `auto` is set.
- Job `email.auto-nudge`, schedule `0 * * * *`: for each company with `autoNudge = true` and `inWorkHours(now, company.timezone)`, for each room/update with `autoNudge = true`, list candidates through `findUnopened(db, companyId, { kind, targetId })` filtered by `!nudgeOptOut`, `nudgeCount < 2` and `waitingSince <= now - nextStepWaitDays(nudgeCount)`; send via `sendReminder({ auto, actor: { type: "company", id } })`, capped at 200 per company per run. One company's failure is logged and does not stop the others.

- [ ] **Step 1: Failing tests** (`cadence.test.ts`): `nextStepWaitDays(0) === 3`, `(1) === 4`, `(2) === null`; `inWorkHours` true at 09:00 and 17:59 local, false at 08:59 and 18:00, and uses the zone (`2026-03-10T20:00Z` is 09:00 in Pacific/Auckland next day; 20:00 local in UTC).
- [ ] **Step 2: Failing tests** (`auto-nudge-job.test.ts`, inject the clock as in the digest test): company switch off → nothing; room switch off → nothing; both on and a recipient waiting 4 days → one email and `nudgeCount = 1`; running the job again the same hour → still one (cooldown/claim); 5 days later → second email, `nudgeCount = 2`; a third run → nothing; opened recipient, opted-out recipient, expired link, link expiring in 12 h → nothing; outside work hours → nothing; another company's recipient is never emailed for this company's run; a manual reminder at day 3 prevents an automatic one at day 3 and the next automatic one waits the 4 days.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement migration, models in `schema.prisma`, `cadence.ts`, the job (global `db` with explicit `companyId` filters, as the digest does), register it and add `"auto-nudge"` to `JOB_TYPES.email`.
- [ ] **Step 5:** Run the new tests, `nudge.test.ts`, `send-reminder.test.ts`, `view-digest-job.test.ts`, `architecture.test.ts`; tsc; biome.
- [ ] **Step 6:** Commit `feat(nudge): automatic reminders, at most two, in working hours`.

---

### Task 3: Unsubscribe route and email footer

**Files:** Create `src/app/api/activity/unsubscribe/route.ts` (and a small `src/app/unsubscribed/page.tsx`); modify `src/emails/ShareDataRoomEmail.tsx`, `src/emails/ShareUpdateEmail.tsx`, the two share email jobs (pass `unsubscribeLink` when `reminder` is true), `send-reminder.ts` (build the link); test `tests/tenant/unsubscribe.test.ts`.

**Interfaces:** `POST /api/activity/unsubscribe` body `{ kind, token }` → 204 and sets `nudgeOptOut = true` on that recipient only; a `GET` with `?token=&kind=` renders the confirmation page and performs the same action (email clients open links with GET); both are idempotent. Link in the email: `<company host>/unsubscribed?kind=…&token=…`.

- [ ] **Step 1: Failing tests:** valid token sets only that recipient's flag; repeated call is 204; unknown/expired/revoked → 404 and nothing changes; a token for one recipient never changes another recipient or another room; kind `ESIGN` → 400; after opt-out, `sendReminder` with `auto` returns `{ sent: false, reason: "opted-out" }` and the manual button still works.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement route (zod, `resolveRecipient`, update scoped by `recipientId` and parent company), page, email footer text "Don't want these reminders? Unsubscribe", job payload field `unsubscribeLink` optional in both share email schemas.
- [ ] **Step 4:** Run the new test, `share-requires-recipient.test.ts`, `nudge.test.ts`, public-links tests; tsc; biome. Commit `feat(nudge): one-click unsubscribe from reminders`.

---

### Task 4: Switches, Stop reminders, visible log

**Files:** `src/components/company/preferences-card.tsx` (master switch "Automatic reminders" with the cadence in plain words), `data-room-files.tsx` and the updates editor page (per-item switch), `src/components/activity/unopened-list.tsx` ("Stop reminders" per row; "Reminded {when} · {n} of 2 · stopped by recipient/owner" labels), `src/trpc/routers/*` (`setAutoNudge`, `stopReminders` mutations with audit rows), `company.updatePreferences` (add `autoNudge`), `analytics` unopened rows (add `nudgeCount`, `nudgeOptOut`).

- [ ] **Step 1: Failing tests:** `setAutoNudge` changes only the caller's room/update (cross-tenant case; role cases `data-rooms:update` / `updates:update`); `stopReminders` sets `nudgeOptOut` on the right recipient only and is audited; `activity.unopened` returns `nudgeCount` and `nudgeOptOut`; `company.updatePreferences` accepts `autoNudge` and needs `company:update`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run roles, cross-tenant, architecture, `unopened.test.ts`, `company-preferences.test.ts`; tsc; biome. Commit `feat(nudge): switches, stop reminders and a visible log`.

---

## Self-review
- **Coverage:** opt-in at company and room level (Tasks 2, 4), two-step cadence (Task 2), working hours in the company timezone (Task 2), recipient opt-out (Task 3), owner stop and visible log (Task 4), no duplicates with manual reminders (Tasks 1, 2).
- **Karpathy:** the only refactor (Task 1) has the existing tests as its success criterion; no speculative options (fixed cadence and hours, not configurable); assumptions listed up front.
- **Ponytail:** reuses `findUnopened`, the serializable claim, the Reminder email and the digest job's patterns; skipped: per-company cadence settings, SMS, snooze, reminders for e-sign.
- **Release:** one migration (`20261020000000_auto_nudges`), applied before the image; the job ships switched off everywhere, so deploying it sends nothing until someone turns it on.
