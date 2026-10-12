# Document Activity Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "who looked" into "act on it": a daily digest instead of one email per view, a reminder button for recipients who never opened a link, and per-recipient link expiry.

**Architecture:** Three additive columns (no new tables). Expiry is enforced from the database at every public entry point (the 30-day JWT stays as the outer limit), so a shorter expiry also governs links copied from the share dialog. "Not opened" is derived from `ViewEvent` (no non-bot row for the recipient), not stored. The digest is one scheduled pg-boss job that reuses the alert job's target description and recipient scoping.

**Tech Stack:** Next.js 16, Prisma 5.14 (relationMode "prisma"), tRPC v10, pg-boss 10, react-email, vitest, Biome 1.7.3, pnpm.

**Spec:** Phase 1 and Phase 2 plans (`2026-10-12-document-activity-phase-1.md`, `...-phase-2.md`) and the Phase 3 proposal in chat on 2026-10-12. There is no separate spec; the decisions are in the table below.

## Decisions (defaults; the owner can override any row before execution)

| Question | Default | Why |
|---|---|---|
| Expiry length | **7, 14 or 30 days, chosen when sharing; default 30** | The signed link already dies at 30 days (`LINK_TTL`). A longer choice would mean changing token lifetime, which touches every public link. Not needed now. |
| Existing recipients | `expiresAt = null` means "only the 30-day token limit applies" | Zero behaviour change for links already sent. |
| Re-sharing | Sets a fresh `expiresAt` and mints a new token (it already does) | Re-share is the renew action. |
| Unopened | A recipient with **no non-bot `ViewEvent`**, waiting **at least 3 days** (`UNOPENED_AFTER_DAYS`), link not expired | Mail-scanner prefetches are flagged bots, so they do not count as opened. |
| Waiting since | `updatedAt` of the recipient row (changes on share, re-share and nudge) | No extra column. |
| Nudges | **Manual button only**, 24 h cooldown per recipient, never automatic | Emailing an external investor without a person deciding is a policy choice. Auto-nudge is a later, separate decision. |
| Digest | Opt-in per member, daily at 07:00 UTC, replaces that member's instant alerts | UTC is a fixed shortcut (see Task 6). Per-member timezone is not worth a column yet. |
| Digest scope | Same rule as instant alerts: ADMIN sees everything, a creator sees what they created | One scoping rule to review, not two. |
| E-sign | **Untouched** | Envelopes have their own signer flow and audit trail. |
| Retention, per-company settings, download tracking, NDA gate | **Not in Phase 3** | Not asked for; each is its own decision. |

## Global Constraints

- No change to token format, signing, auth or `encode`/`decode`.
- The migration is additive only: nullable columns and one `NOT NULL DEFAULT false` column. The currently running image must keep working against the migrated schema (rollback path).
- Public routes stay token-authenticated; an expired, revoked or unknown link answers exactly like an unknown one for the beacon (404, nothing recorded, no email).
- Every new tenant-reading query goes through the tenant client or filters by `companyId` through the parent relation. Every new `withAccessControl` mutation needs a `policies` meta and a role case in `tests/tenant/roles.test.ts`; every `withTenant` procedure without a policy needs an `EXEMPT` entry there (lesson from Phase 1).
- Copy: product name from `src/lib/constants.ts`, never a literal "CapTable".
- Biome clean (`pnpm lint`), `pnpm tsc --noEmit` clean, full vitest suite green before the PR.
- Production steps (migration, deploy, env flip) are done by the orchestrator with the owner's approval at each step, never by a subagent.

## Review Focus

Inputs and conditions the feature implies that no task's happy path exercises, most likely first:

1. **Expired link mid-visit.** A recipient has the page open, the link expires, the heartbeat arrives. Expected: the heartbeat is refused (404) and nothing is raised, the same as any expired link; time spent up to the last accepted heartbeat is kept. Accepted limit, pinned in Task 2.
2. **Re-share after expiry.** Expected: the same recipient row gets a new `expiresAt` and a working link; their old visit history stays attached. Pinned in Task 3.
3. **Nudge double click or two admins at once.** Expected: exactly one email. Pinned in Task 5 (claim-then-send with a conditional update).
4. **Recipient opened after being nudged-eligible, before the click.** Expected: nudge refused, no email. Pinned in Task 5.
5. **Digest member who is also the creator of the room and an ADMIN.** Expected: one row per item, not two. Pinned in Task 7.
6. **Digest for a company with no activity.** Expected: no email at all, not an empty one. Pinned in Task 7.
7. **Cross-tenant ids.** A caller passing another company's recipient or room id to `nudge` or to the unopened query. Expected: NOT_FOUND / empty, no email. Pinned in Tasks 4 and 5.
8. **Revoked recipient opens the link.** Today the page throws (a 500) because it uses `findFirstOrThrow`. Expected: 404. Pinned in Task 2.

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261015000000_activity_phase_3/migration.sql` | New columns (Task 1) |
| `src/server/activity/link-state.ts` (new) | `EXPIRY_DAYS`, `expiryFromDays`, `isExpired` (Task 2) |
| `src/components/share/expired-link.tsx` (new) | The page an expired link shows (Task 2) |
| `src/server/activity/unopened.ts` (new) | `findUnopened`, `UNOPENED_AFTER_DAYS`, `NUDGE_COOLDOWN_MS` (Task 4) |
| `src/server/activity/describe.ts` (new) | Target description extracted from the alert job, shared with the digest (Task 6) |
| `src/jobs/view-digest-email.ts`, `src/emails/ViewDigestEmail.tsx` (new) | Daily digest (Task 7) |
| `src/trpc/routers/activity-router/procedures/unopened.ts` (new) | `activity.unopened` (Task 4) |
| `src/trpc/routers/data-room-router/router.ts`, `src/trpc/routers/update/procedures/nudge-update.ts` (new) | `dataRoom.nudge`, `update.nudge` (Task 5) |
| `src/components/activity/unopened-list.tsx` (new) | "Not opened yet" list with Send reminder (Task 5) |
| `src/components/member/view-alerts-setting.tsx`, `src/trpc/routers/member-router/procedures/view-alerts.ts` | Digest switch (Task 8) |

## Model routing

| Task | `model` | `subagent_type` | Justification |
|---|---|---|---|
| 1. Schema + migration + audit actions | `sonnet` | `general-purpose` | Three files, exact spec, but a wrong migration is costly; Sonnet with a diff check |
| 2. Expiry enforcement on public paths | `opus` | `general-purpose` | Token-authenticated public routes; security rule 3 |
| 3. Share writes `expiresAt` + expiry picker | `sonnet` | `general-purpose` | Existing share pattern in two routers plus one modal; reviewed by Opus with Task 2 |
| 4. Unopened query + `activity.unopened` | `opus` | `general-purpose` | New tenant-scoped read across two parent-scoped models; tenant isolation, security rule 3 |
| 5. Nudge mutations + list UI | `opus` (server) / `sonnet` (UI) | `general-purpose` | Sends email to external parties on a tenant id; no existing pattern for claim-then-send. UI is a plain component. |
| 6. Extract `describe` | `haiku` | `general-purpose` | Pure move of one function with its existing tests as the guard; Sonnet reviews the diff |
| 7. Digest job + email | `sonnet` build, `opus` review | `general-purpose` | Multi-file; the review targets cross-company leakage |
| 8. Digest setting | `sonnet` | `general-purpose` | Two procedures, one switch, role-matrix entries |
| 9. Deploy and operator steps | orchestrator | n/a | Production and credentials stay with the orchestrator (rule 5) |
| Per-task reviews | `sonnet` (`opus` for Tasks 2, 4, 5, 7) | `general-purpose` | Per matrix |
| Final whole-branch review | `opus` | `general-purpose` | Per matrix |

Previous-phase review: before each task after the first, the orchestrator reads the previous task's diff and test output and corrects the next brief if the plan text no longer fits.

---

### Task 1: Schema, migration, audit actions

**Files:**
- Modify: `prisma/schema.prisma` (models `DataRoomRecipient`, `UpdateRecipient`, `Member`)
- Create: `prisma/migrations/20261015000000_activity_phase_3/migration.sql`
- Modify: `src/server/audit/schema.ts` (action list near `"dataroom.shared"`)

**Interfaces:**
- Produces: `DataRoomRecipient.expiresAt: Date | null`, `.lastNudgedAt: Date | null`; the same two on `UpdateRecipient`; `Member.viewDigest: boolean`; audit actions `"dataroom.nudged"` and `"update.nudged"`.

- [ ] **Step 1: Add the columns to the schema**

In `DataRoomRecipient` and `UpdateRecipient`, above `createdAt`:

```prisma
  // null = only the 30-day signed-link lifetime applies (links sent before Phase 3)
  expiresAt    DateTime?
  lastNudgedAt DateTime?
```

In `Member`, under `notifyOnView`:

```prisma
  // true = one daily summary email instead of an email per view
  viewDigest   Boolean          @default(false)
```

- [ ] **Step 2: Write the migration by hand** (this project applies migrations manually on production)

```sql
-- AlterTable
ALTER TABLE "DataRoomRecipient" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "lastNudgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UpdateRecipient" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "lastNudgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Member" ADD COLUMN "viewDigest" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Add the audit actions**

In `src/server/audit/schema.ts` add `"dataroom.nudged",` after `"dataroom.shared",` and `"update.nudged",` after `"update.unshared",`. (`Audit.action` is a plain `String` column, so no migration is needed for these.)

- [ ] **Step 4: Verify**

Run: `pnpm prisma generate && pnpm prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL" --exit-code`
Expected: exit code 0 (no drift). Then `pnpm tsc --noEmit` passes.

- [ ] **Step 5: Commit**

```bash
git add prisma src/server/audit/schema.ts
git commit -m "feat(activity): columns for link expiry, nudges and the digest switch"
```

---

### Task 2: Expiry enforcement on every public path

**Files:**
- Create: `src/server/activity/link-state.ts`, `src/components/share/expired-link.tsx`
- Modify: `src/app/(documents)/data-rooms/[publicId]/page.tsx`, `src/app/(documents)/data-rooms/[publicId]/[bucketId]/page.tsx`, `src/app/updates/[publicId]/page.tsx`, `src/server/activity/resolve-recipient.ts`
- Test: `tests/tenant/link-expiry.test.ts`

**Interfaces:**
- Produces:
  - `EXPIRY_DAYS = [7, 14, 30] as const`
  - `expiryFromDays(days: 7 | 14 | 30, now?: Date): Date`
  - `isExpired(expiresAt: Date | null, now?: Date): boolean`
  - `<ExpiredLink companyName: string />`

- [ ] **Step 1: Write the failing tests** (`tests/tenant/link-expiry.test.ts`)

```ts
import { db } from "@/server/db";
import { isExpired, expiryFromDays } from "@/server/activity/link-state";
import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { encode } from "@/lib/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
});
afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

describe("link-state", () => {
  it("null never expires; past expires; future does not", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(new Date("2026-10-14T00:00:00Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-10-16T00:00:00Z"), now)).toBe(false);
    expect(isExpired(now, now)).toBe(true); // the boundary instant is expired
  });
  it("expiryFromDays adds whole days", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(expiryFromDays(7, now).toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });
});

describe("resolveRecipient honours expiresAt", () => {
  const make = async (expiresAt: Date | null) => {
    const rec = await db.dataRoomRecipient.create({
      data: {
        dataRoomId: aIds.dataRoomId,
        email: `exp-${Date.now()}-${Math.random()}@example.com`,
        expiresAt,
      },
    });
    const token = await encode({
      companyId: a.companyId,
      dataRoomId: aIds.dataRoomId,
      recipientId: rec.id,
    });
    return { rec, token };
  };

  it("resolves a live link and a legacy (null) link", async () => {
    const live = await make(new Date(Date.now() + 86_400_000));
    const legacy = await make(null);
    expect(await resolveRecipient("DATA_ROOM", live.token)).not.toBeNull();
    expect(await resolveRecipient("DATA_ROOM", legacy.token)).not.toBeNull();
  });

  it("returns null for an expired link", async () => {
    const dead = await make(new Date(Date.now() - 1000));
    expect(await resolveRecipient("DATA_ROOM", dead.token)).toBeNull();
  });

  it("returns null for a revoked (deleted) recipient", async () => {
    const { rec, token } = await make(null);
    await db.dataRoomRecipient.delete({ where: { id: rec.id } });
    expect(await resolveRecipient("DATA_ROOM", token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/tenant/link-expiry.test.ts`
Expected: FAIL (module `link-state` not found).

- [ ] **Step 3: Implement the helper**

```ts
// src/server/activity/link-state.ts
// The signed link itself lives 30 days (LINK_TTL in src/lib/jwt.ts); these
// choices are all at or below that, so no token change is needed.
export const EXPIRY_DAYS = [7, 14, 30] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number];

export const expiryFromDays = (days: ExpiryDays, now = new Date()) =>
  new Date(now.getTime() + days * 86_400_000);

// null = a link sent before expiry existed: only the token lifetime applies
export const isExpired = (expiresAt: Date | null, now = new Date()) =>
  expiresAt !== null && expiresAt.getTime() <= now.getTime();
```

- [ ] **Step 4: Enforce in `resolveRecipient`**

In the `DATA_ROOM` branch add `expiresAt: true` to the `select` and `if (!r || isExpired(r.expiresAt)) return null;`. In the `UPDATE` branch do the same on `updateRecipient.findFirst`. Import `isExpired` from `./link-state`. (This is what stops the beacon recording a visit, and the alert email, for an expired link.)

- [ ] **Step 5: Enforce on the three public pages, and stop the 500 on a revoked recipient**

In `src/app/(documents)/data-rooms/[publicId]/page.tsx` and `.../[bucketId]/page.tsx` replace the recipient lookup:

```tsx
  const recipient = await db.dataRoomRecipient.findFirst({
    where: { id: recipientId, dataRoomId },
    select: { id: true, expiresAt: true },
  });

  if (!recipient) {
    return notFound();
  }
```

Then, after `dataRoom` is loaded and the company check passes (so the company name is known and only a token holder sees it), add:

```tsx
  if (isExpired(recipient.expiresAt)) {
    return <ExpiredLink companyName={dataRoom.company.name} />;
  }
```

In `src/app/updates/[publicId]/page.tsx` select `expiresAt` in the `updateRecipient.findFirst` (it currently selects everything, so only the check is needed) and add the same `isExpired` branch right after the `!recipients` check.

- [ ] **Step 6: The expired page**

```tsx
// src/components/share/expired-link.tsx
import { RiTimeLine } from "@remixicon/react";

export const ExpiredLink = ({ companyName }: { companyName: string }) => (
  <div className="flex h-screen w-full items-center justify-center">
    <div className="flex items-center space-x-5">
      <RiTimeLine className="h-10 w-10" aria-hidden="true" />
      <div>
        <p className="text-lg font-semibold text-gray-600">
          This link has expired
        </p>
        <p className="text-sm text-gray-500">
          Ask {companyName} to send you a new one.
        </p>
      </div>
    </div>
  </div>
);
```

- [ ] **Step 7: Run tests and commit**

Run: `pnpm vitest run tests/tenant/link-expiry.test.ts tests/tenant/view-beacon.test.ts tests/public-links.test.ts`
Expected: PASS (the beacon and public-link suites still green).

```bash
git add src tests
git commit -m "feat(activity): per-recipient link expiry on every public path; revoked links 404"
```

Review focus pinned here: item 1 (add to `tests/tenant/view-heartbeat.test.ts`: record a visit for a live link, then set the recipient's `expiresAt` to the past, then POST a heartbeat with higher values; expect 404 and the stored `activeSeconds` unchanged) and item 8 (the revoked-recipient test above).

---

### Task 3: Share writes `expiresAt`; expiry picker in the share dialog

**Files:**
- Modify: `src/trpc/routers/data-room-router/router.ts` (`share`), `src/trpc/routers/update/procedures/share-update.ts`, `src/components/common/share-modal.tsx`, `src/components/modals/share-dataroom-modal.tsx`, `src/components/modals/share-update-modal.tsx`
- Test: `tests/tenant/share-expiry.test.ts`

**Interfaces:**
- Consumes: `EXPIRY_DAYS`, `expiryFromDays`, `ExpiryDays` from Task 2.
- Produces: both share procedures accept `expiresInDays: 7 | 14 | 30` (default 30).

- [ ] **Step 1: Write the failing test**

```ts
// tests/tenant/share-expiry.test.ts  (same fixture preamble as link-expiry.test.ts)
import { callerFor } from "../helpers/seed";
// vi.mock the job emit exactly as tests/tenant/share-requires-recipient.test.ts does

it("sets expiresAt from expiresInDays on a new recipient", async () => {
  await callerFor(a).dataRoom.share({
    dataRoomId: aIds.dataRoomId,
    others: [{ value: "exp1@example.com", email: "exp1@example.com", name: "E", type: "other" } as never],
    selectedContacts: [],
    expiresInDays: 7,
  });
  const rec = await db.dataRoomRecipient.findFirstOrThrow({
    where: { dataRoomId: aIds.dataRoomId, email: "exp1@example.com" },
  });
  const days = (rec.expiresAt!.getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThan(7.1);
});

it("re-sharing renews an expired recipient", async () => {
  await db.dataRoomRecipient.updateMany({
    where: { dataRoomId: aIds.dataRoomId, email: "exp1@example.com" },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await callerFor(a).dataRoom.share({
    dataRoomId: aIds.dataRoomId,
    others: [{ value: "exp1@example.com", email: "exp1@example.com", name: "E", type: "other" } as never],
    selectedContacts: [],
  });
  const rec = await db.dataRoomRecipient.findFirstOrThrow({
    where: { dataRoomId: aIds.dataRoomId, email: "exp1@example.com" },
  });
  expect(rec.expiresAt!.getTime()).toBeGreaterThan(Date.now());
});

it("rejects a length that is not offered", async () => {
  await expect(
    callerFor(a).dataRoom.share({
      dataRoomId: aIds.dataRoomId,
      others: [{ value: "x@example.com", email: "x@example.com", name: "X", type: "other" } as never],
      selectedContacts: [],
      expiresInDays: 365 as never,
    }),
  ).rejects.toThrow();
});
```

(Copy the recipient object shape and the `shareDataRoomEmailJob` mock from `tests/tenant/share-requires-recipient.test.ts`; do not invent a different shape.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/tenant/share-expiry.test.ts`
Expected: FAIL (`expiresAt` is null; input key unknown).

- [ ] **Step 3: Server**

In both share inputs add

```ts
expiresInDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(30),
```

and in each recipient `upsert` set `expiresAt` in both `create` and `update`:

```ts
const expiresAt = expiryFromDays(input.expiresInDays);
// create: { ...existing, expiresAt }
// update: { ...existing, expiresAt }
```

(Compute `expiresAt` once before the recipient loop so every recipient of one share gets the same instant.)

- [ ] **Step 4: UI**

In `share-modal.tsx` add a `useState<7 | 14 | 30>(30)` named `expiresInDays`, a native `<select>` (label "Link expires after", options "7 days", "14 days", "30 days") above the Share button, and pass it in the `onShare` payload: `onShare({ others, selectedContacts, expiresInDays })`. Extend the `onShare` prop type with `expiresInDays: 7 | 14 | 30`. In the two modal wrappers forward `expiresInDays` to the mutation. Show each recipient's remaining time next to their name in "People with access": `Expires {dayjsExt().to(recipient.expiresAt)}` when `expiresAt` is set, nothing when null.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run tests/tenant/share-expiry.test.ts tests/tenant/share-requires-recipient.test.ts tests/tenant/roles.test.ts && pnpm tsc --noEmit && pnpm lint`
Expected: PASS.

```bash
git add src tests
git commit -m "feat(share): choose how long a link lasts; re-sharing renews it"
```

---

### Task 4: Unopened query and `activity.unopened`

**Files:**
- Create: `src/server/activity/unopened.ts`, `src/trpc/routers/activity-router/procedures/unopened.ts`
- Modify: `src/trpc/routers/activity-router/router.ts`
- Test: `tests/tenant/unopened.test.ts`

**Interfaces:**
- Produces:

```ts
export const UNOPENED_AFTER_DAYS = 3;
export const NUDGE_COOLDOWN_MS = 24 * 3600 * 1000;
export type Unopened = {
  kind: "DATA_ROOM" | "UPDATE";
  targetId: string;
  targetName: string;
  targetPublicId: string;
  ownerMemberId: string | null;
  recipientId: string;
  email: string;
  name: string | null;
  waitingSince: Date;
  lastNudgedAt: Date | null;
  nudgeable: boolean; // not nudged in the last 24 h
};
export function findUnopened(
  tx: TPrismaOrTransaction,
  companyId: string,
  opts?: { kind?: "DATA_ROOM" | "UPDATE"; targetId?: string; now?: Date },
): Promise<Unopened[]>;
```

- `activity.unopened` input `{ kind?: "DATA_ROOM" | "UPDATE"; targetPublicId?: string }`, policy `audits:read`, returns `{ items: Unopened[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tenant/unopened.test.ts  (fixture preamble as before; aIds has dataRoomId, bIds the other tenant)
const old = () => new Date(Date.now() - 4 * 86_400_000);
const mk = (dataRoomId: string, email: string, extra = {}) =>
  db.dataRoomRecipient.create({ data: { dataRoomId, email, ...extra } }).then(async (r) => {
    await db.$executeRaw`UPDATE "DataRoomRecipient" SET "updatedAt" = ${old()} WHERE id = ${r.id}`;
    return r;
  });

it("lists a recipient who never opened and has waited 3+ days", async () => {
  const r = await mk(aIds.dataRoomId, "never@example.com");
  const items = await findUnopened(db, a.companyId);
  expect(items.map((i) => i.recipientId)).toContain(r.id);
});

it("a human view removes them; a bot view does not", async () => {
  const bot = await mk(aIds.dataRoomId, "bot@example.com");
  const human = await mk(aIds.dataRoomId, "human@example.com");
  const ev = (recipientId: string, isBot: boolean) =>
    db.viewEvent.create({ data: { companyId: a.companyId, kind: "DATA_ROOM", targetId: aIds.dataRoomId, recipientId, ip: "1.2.3.0", userAgent: "ua", isBot } });
  await ev(bot.id, true);
  await ev(human.id, false);
  const ids = (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
  expect(ids).toContain(bot.id);
  expect(ids).not.toContain(human.id);
});

it("excludes recent shares and expired links", async () => {
  const fresh = await db.dataRoomRecipient.create({ data: { dataRoomId: aIds.dataRoomId, email: "fresh@example.com" } });
  const dead = await mk(aIds.dataRoomId, "dead@example.com", { expiresAt: new Date(Date.now() - 1000) });
  const ids = (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
  expect(ids).not.toContain(fresh.id);
  expect(ids).not.toContain(dead.id);
});

it("never returns another company's recipients", async () => {
  const theirs = await mk(bIds.dataRoomId, "theirs@example.com");
  const ids = (await findUnopened(db, a.companyId)).map((i) => i.recipientId);
  expect(ids).not.toContain(theirs.id);
});

it("nudgeable is false inside the cooldown", async () => {
  const r = await mk(aIds.dataRoomId, "cool@example.com", { lastNudgedAt: new Date() });
  const item = (await findUnopened(db, a.companyId)).find((i) => i.recipientId === r.id);
  expect(item?.nudgeable).toBe(false);
});

it("activity.unopened needs audits:read and is tenant scoped", async () => {
  const res = await callerFor(a).activity.unopened({});
  expect(res.items.every((i) => i.recipientId !== undefined)).toBe(true);
  // a member without audits:read is refused: reuse the memberWith() helper pattern
  // from tests/tenant/activity-list.test.ts and expect UNAUTHORIZED
});
```

(Use the real `callerFor`/`memberWith` shapes from `tests/tenant/activity-list.test.ts`; the last test copies its "member without audits:read" case.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/tenant/unopened.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `findUnopened`**

```ts
// src/server/activity/unopened.ts
import type { TPrismaOrTransaction } from "@/server/db";

export const UNOPENED_AFTER_DAYS = 3;
export const NUDGE_COOLDOWN_MS = 24 * 3600 * 1000;
const CAP = 200;

// Works with the tenant client and the raw client: companyId is always filtered
// through the parent relation, so it is safe from the digest job as well.
export async function findUnopened(
  tx: TPrismaOrTransaction,
  companyId: string,
  opts: { kind?: "DATA_ROOM" | "UPDATE"; targetId?: string; now?: Date } = {},
): Promise<Unopened[]> {
  const now = opts.now ?? new Date();
  const waitedEnough = new Date(now.getTime() - UNOPENED_AFTER_DAYS * 86_400_000);
  const live = [{ expiresAt: null }, { expiresAt: { gt: now } }];
  const base = { updatedAt: { lte: waitedEnough }, OR: live };

  const [rooms, updates] = await Promise.all([
    opts.kind === "UPDATE"
      ? []
      : tx.dataRoomRecipient.findMany({
          where: {
            ...base,
            dataRoom: { companyId },
            ...(opts.targetId && { dataRoomId: opts.targetId }),
          },
          select: {
            id: true, email: true, name: true, updatedAt: true, lastNudgedAt: true,
            dataRoom: { select: { id: true, name: true, publicId: true, createdById: true } },
          },
          orderBy: { updatedAt: "asc" },
          take: CAP,
        }),
    opts.kind === "DATA_ROOM"
      ? []
      : tx.updateRecipient.findMany({
          where: {
            ...base,
            update: { companyId, status: "PUBLIC", public: true },
            ...(opts.targetId && { updateId: opts.targetId }),
          },
          select: {
            id: true, email: true, name: true, updatedAt: true, lastNudgedAt: true,
            update: { select: { id: true, title: true, publicId: true, authorId: true } },
          },
          orderBy: { updatedAt: "asc" },
          take: CAP,
        }),
  ]);

  const ids = [...rooms.map((r) => r.id), ...updates.map((r) => r.id)];
  if (!ids.length) return [];
  // recipient ids are cuids, unique across both tables, so no kind filter is needed
  const opened = new Set(
    (
      await tx.viewEvent.findMany({
        where: { companyId, isBot: false, recipientId: { in: ids } },
        select: { recipientId: true },
        distinct: ["recipientId"],
      })
    ).map((e) => e.recipientId),
  );
  const cooled = (d: Date | null) =>
    d === null || now.getTime() - d.getTime() >= NUDGE_COOLDOWN_MS;

  return [
    ...rooms.map((r) => ({
      kind: "DATA_ROOM" as const, targetId: r.dataRoom.id, targetName: r.dataRoom.name,
      targetPublicId: r.dataRoom.publicId, ownerMemberId: r.dataRoom.createdById,
      recipientId: r.id, email: r.email, name: r.name,
      waitingSince: r.updatedAt, lastNudgedAt: r.lastNudgedAt, nudgeable: cooled(r.lastNudgedAt),
    })),
    ...updates.map((r) => ({
      kind: "UPDATE" as const, targetId: r.update.id, targetName: r.update.title,
      targetPublicId: r.update.publicId, ownerMemberId: r.update.authorId,
      recipientId: r.id, email: r.email, name: r.name,
      waitingSince: r.updatedAt, lastNudgedAt: r.lastNudgedAt, nudgeable: cooled(r.lastNudgedAt),
    })),
  ].filter((i) => !opened.has(i.recipientId));
}

export type Unopened = {
  kind: "DATA_ROOM" | "UPDATE"; targetId: string; targetName: string; targetPublicId: string;
  ownerMemberId: string | null; recipientId: string; email: string; name: string | null;
  waitingSince: Date; lastNudgedAt: Date | null; nudgeable: boolean;
};
// shortcut: capped at 200 per kind and "waiting since" is the row's updatedAt,
// which any edit bumps; add a sharedAt column if that proves noisy.
```

- [ ] **Step 4: The procedure**

```ts
// src/trpc/routers/activity-router/procedures/unopened.ts
import { findUnopened } from "@/server/activity/unopened";
import { withAccessControl } from "@/trpc/api/trpc";
import { z } from "zod";

export const unopenedProcedure = withAccessControl
  .meta({ policies: { audits: { allow: ["read"] } } })
  .input(
    z.object({
      kind: z.enum(["DATA_ROOM", "UPDATE"]).optional(),
      targetPublicId: z.string().optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const { db, companyId } = ctx.tenant;
    let targetId: string | undefined;
    if (input.kind && input.targetPublicId) {
      const where = { publicId: input.targetPublicId };
      const found =
        input.kind === "DATA_ROOM"
          ? await db.dataRoom.findFirst({ where, select: { id: true } })
          : await db.update.findFirst({ where, select: { id: true } });
      if (!found) return { items: [] };
      targetId = found.id;
    }
    return {
      items: await findUnopened(db, companyId, { kind: input.kind, targetId }),
    };
  });
```

Register as `unopened: unopenedProcedure` in `activity-router/router.ts`.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run tests/tenant/unopened.test.ts tests/tenant/activity-list.test.ts tests/tenant/cross-tenant.test.ts tests/tenant/architecture.test.ts`
Expected: PASS. If `architecture.test.ts` flags the raw `TPrismaOrTransaction` use, follow its allow-list convention the way `src/server/tenant-guard.ts` does (it takes the same type).

```bash
git add src tests
git commit -m "feat(activity): find recipients who never opened a link"
```

---

### Task 5: Nudge mutations and the "Not opened yet" list

**Files:**
- Modify: `src/trpc/routers/data-room-router/router.ts` (add `nudge` after `unShare`), `src/trpc/routers/update/router.ts` (register), `src/jobs/share-data-room-email.ts`, `src/jobs/share-update-email.ts`
- Create: `src/trpc/routers/update/procedures/nudge-update.ts`, `src/components/activity/unopened-list.tsx`
- Modify: the data room and update detail pages to render `<UnopenedList>` under the Activity card
- Test: `tests/tenant/nudge.test.ts`, role cases in `tests/tenant/roles.test.ts`

**Interfaces:**
- Consumes: `NUDGE_COOLDOWN_MS`, `isExpired`, `Unopened` from Tasks 2 and 4.
- Produces: `dataRoom.nudge({ dataRoomId, recipientId })` and `update.nudge({ updateId, recipientId })`, each returning `{ success: true }`; the share email jobs accept an optional `reminder: boolean` (subject prefix only).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tenant/nudge.test.ts  (mock the email jobs as in share-requires-recipient.test.ts: emit = vi.fn())
const waiting = async (email: string, extra = {}) => {
  const r = await db.dataRoomRecipient.create({ data: { dataRoomId: aIds.dataRoomId, email, ...extra } });
  return r;
};

it("sends one reminder and stamps lastNudgedAt", async () => {
  const r = await waiting("n1@example.com");
  await callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId: r.id });
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit.mock.calls[0]![0]).toMatchObject({ email: "n1@example.com", reminder: true });
  const after = await db.dataRoomRecipient.findUniqueOrThrow({ where: { id: r.id } });
  expect(after.lastNudgedAt).not.toBeNull();
});

it("a second nudge inside 24 h is refused and sends nothing", async () => {
  const r = await waiting("n2@example.com");
  await callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId: r.id });
  emit.mockClear();
  await expect(callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId: r.id })).rejects.toThrow();
  expect(emit).not.toHaveBeenCalled();
});

it("two simultaneous nudges send exactly one email", async () => {
  const r = await waiting("n3@example.com");
  emit.mockClear();
  const results = await Promise.allSettled([
    callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId: r.id }),
    callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId: r.id }),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(emit).toHaveBeenCalledTimes(1);
});

it("refuses someone who already opened, or an expired link", async () => {
  const opened = await waiting("n4@example.com");
  await db.viewEvent.create({ data: { companyId: a.companyId, kind: "DATA_ROOM", targetId: aIds.dataRoomId, recipientId: opened.id, ip: "1.2.3.0", userAgent: "ua" } });
  const dead = await waiting("n5@example.com", { expiresAt: new Date(Date.now() - 1000) });
  emit.mockClear();
  await expect(callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId: opened.id })).rejects.toThrow();
  await expect(callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId: dead.id })).rejects.toThrow();
  expect(emit).not.toHaveBeenCalled();
});

it("another company's recipient is not found", async () => {
  const theirs = await db.dataRoomRecipient.create({ data: { dataRoomId: bIds.dataRoomId, email: "t@example.com" } });
  emit.mockClear();
  await expect(callerFor(a).dataRoom.nudge({ dataRoomId: bIds.dataRoomId, recipientId: theirs.id })).rejects.toThrow();
  await expect(callerFor(a).dataRoom.nudge({ dataRoomId: aIds.dataRoomId, recipientId: theirs.id })).rejects.toThrow();
  expect(emit).not.toHaveBeenCalled();
});
```

Add the same five cases for `update.nudge` (recipient on a PUBLIC update from the fixtures; `emit` is the update job's mock).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/tenant/nudge.test.ts`
Expected: FAIL (`nudge` is not a function).

- [ ] **Step 3: Reminder flag on both email jobs**

In each of `share-data-room-email.ts` and `share-update-email.ts` add `reminder: z.boolean().optional(),` to the schema and prefix the subject: ``subject: `${reminder ? "Reminder: " : ""}<existing subject>` ``. Nothing else changes.

- [ ] **Step 4: `dataRoom.nudge`**

```ts
  nudge: withAccessControl
    .input(z.object({ dataRoomId: z.string(), recipientId: z.string() }))
    .meta({ policies: { "data-rooms": { allow: ["update"] } } })
    .mutation(async ({ ctx, input }) => {
      const { session, requestIp, userAgent } = ctx;
      const { db, companyId } = ctx.tenant;
      const { name: senderName, email: senderEmail, id: userId } = session.user;
      const now = new Date();

      const rec = await db.dataRoomRecipient.findFirst({
        where: { id: input.recipientId, dataRoomId: input.dataRoomId, dataRoom: { companyId } },
        select: {
          id: true, name: true, email: true, expiresAt: true,
          dataRoom: { select: { id: true, name: true, publicId: true, company: { select: { name: true } } } },
        },
      });
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Recipient not found" });
      if (isExpired(rec.expiresAt, now))
        throw new TRPCError({ code: "BAD_REQUEST", message: "This link has expired. Share again to renew it." });
      if (await db.viewEvent.count({ where: { recipientId: rec.id, isBot: false } }))
        throw new TRPCError({ code: "BAD_REQUEST", message: "They have already opened it." });

      // claim before sending: the conditional update is what makes a double click send once
      const claimed = await db.dataRoomRecipient.updateMany({
        where: {
          id: rec.id,
          OR: [{ lastNudgedAt: null }, { lastNudgedAt: { lt: new Date(now.getTime() - NUDGE_COOLDOWN_MS) } }],
        },
        data: { lastNudgedAt: now },
      });
      if (claimed.count !== 1)
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "A reminder was sent in the last 24 hours." });

      const token = await encode({ companyId, dataRoomId: rec.dataRoom.id, recipientId: rec.id });
      const link = await companyUrl(db, companyId, `/data-rooms/${rec.dataRoom.publicId}?token=${token}`);

      await shareDataRoomEmailJob.emit({
        senderName: `${senderName}`, recipientName: rec.name, companyName: rec.dataRoom.company.name,
        dataRoom: rec.dataRoom.name, link, email: rec.email, senderEmail, reminder: true,
      });
      await Audit.create(
        {
          action: "dataroom.nudged", companyId, actor: { type: "user", id: userId },
          context: { userAgent, requestIp },
          target: [{ type: "dataroom", id: rec.dataRoom.id }],
          summary: `${senderName} sent a reminder to ${rec.email} for the data room ${rec.dataRoom.name}`,
        },
        db,
      );
      return { success: true };
    }),
```

Imports to add at the top of `router.ts`: `NUDGE_COOLDOWN_MS` from `@/server/activity/unopened`, `isExpired` from `@/server/activity/link-state`. `TRPCError`, `encode`, `companyUrl`, `Audit`, `shareDataRoomEmailJob` are already imported there. If the tenant client rejects `updateMany` on a parent-scoped model, switch the claim to `update` with the same `where` inside `$transaction` after re-reading `lastNudgedAt`; keep the two-simultaneous-nudges test as the guard.

- [ ] **Step 5: `update.nudge`**

`src/trpc/routers/update/procedures/nudge-update.ts`: same shape as above over `updateRecipient` (where `update: { companyId, status: "PUBLIC", public: true }`, token `{ companyId, updateId, publicId, recipientId }`, link `/updates/${publicId}?token=${token}`, `shareUpdateEmailJob.emit({ ..., update: { title }, reminder: true })`, audit `"update.nudged"` with target `{ type: "update" }`), policy `updates: { allow: ["update"] }`. Register it as `nudge` in `src/trpc/routers/update/router.ts` the same way `share` is registered.

- [ ] **Step 6: Role matrix**

In `tests/tenant/roles.test.ts` add cases for `dataRoom.nudge` (`["data-rooms", "update"]`) and `update.nudge` (`["updates", "update"]`) next to `dataRoom.share` and `update.share`, copying their input shape.

- [ ] **Step 7: The list**

`src/components/activity/unopened-list.tsx` (client): `api.activity.unopened.useQuery({ kind, targetPublicId })`; render nothing when `error?.data?.code === "UNAUTHORIZED"` or the list is empty; otherwise a "Not opened yet" heading and a table with recipient, "Waiting {dayjsExt().to(waitingSince)}" and a "Send reminder" button, disabled with a "Reminded {when}" label when `!nudgeable`. The button calls `api.dataRoom.nudge` or `api.update.nudge` by `kind`, toasts `error.message` on failure, and invalidates `activity.unopened` on success. Render `<UnopenedList kind="DATA_ROOM" targetPublicId={dataRoomPublicId} />` under the Activity card in the data room page and `kind="UPDATE"` in the update page. Hide the button if the caller cannot update (the server still enforces; reuse the page's existing `allow(...)` result for `["data-rooms","update"]` / `["updates","update"]`).

- [ ] **Step 8: Run and commit**

Run: `pnpm vitest run tests/tenant/nudge.test.ts tests/tenant/roles.test.ts tests/tenant/share-requires-recipient.test.ts && pnpm tsc --noEmit && pnpm lint`
Expected: PASS.

```bash
git add src tests
git commit -m "feat(activity): remind recipients who never opened a link"
```

---

### Task 6: Extract `describe` from the alert job

**Files:**
- Create: `src/server/activity/describe.ts`
- Modify: `src/jobs/view-alert-email.ts`
- Test: existing `tests/tenant/view-alert-job.test.ts` (must stay green, no edits)

**Interfaces:**
- Produces: `describeTarget(d: { companyId: string; kind: "DATA_ROOM" | "UPDATE" | "ESIGN"; targetId: string; recipientId: string }): Promise<{ label: string; path: string; who: string; ownerMemberId: string | null }>` — the body of today's private `describe` in `view-alert-email.ts`, moved unchanged.

- [ ] **Step 1:** Cut the `Described` type and `describe` function out of `view-alert-email.ts` into `src/server/activity/describe.ts` as `export type Described` and `export async function describeTarget(d)`, keeping the three `findFirstOrThrow` branches exactly as they are (including `companyId` in each `where`).
- [ ] **Step 2:** In `view-alert-email.ts` import it and replace `describe(d)` with `describeTarget(d)`. Do not change the members query yet.
- [ ] **Step 3:** Run `pnpm vitest run tests/tenant/view-alert-job.test.ts tests/tenant/view-alerts-switch.test.ts` — Expected: PASS unchanged.
- [ ] **Step 4:** Commit.

```bash
git add src
git commit -m "refactor(activity): share the target description between alerts and the digest"
```

---

### Task 7: Daily digest job and email

**Files:**
- Create: `src/jobs/view-digest-email.ts`, `src/emails/ViewDigestEmail.tsx`
- Modify: `src/jobs/register.ts`, `src/constants/job.ts`, `src/jobs/view-alert-email.ts`
- Test: `tests/tenant/view-digest-job.test.ts`

**Interfaces:**
- Consumes: `describeTarget` (Task 6), `findUnopened`, `UNOPENED_AFTER_DAYS` (Task 4).
- Produces: job `email.view-digest` (no payload), scheduled `0 7 * * *`; `<ViewDigestEmail companyName rows unopened link />`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tenant/view-digest-job.test.ts  (same fixture preamble and sendMail mock as view-alert-job.test.ts)
import { viewDigestEmailWorker } from "@/jobs/view-digest-email";

const run = () => viewDigestEmailWorker.handler([{ data: {} } as never]);
const visit = (recipientId: string, secs = 30, at = new Date()) =>
  db.viewEvent.create({ data: { companyId: a.companyId, kind: "DATA_ROOM", targetId: aIds.dataRoomId, recipientId, ip: "1.2.3.0", userAgent: "ua", activeSeconds: secs, createdAt: at } });

it("sends one email to a digest member listing last 24 h of visits", async () => {
  await db.member.update({ where: { id: a.memberId }, data: { notifyOnView: true, viewDigest: true } });
  await visit(recipientId, 45);
  sendMail.mockClear();
  await run();
  expect(sendMail).toHaveBeenCalledTimes(1);
  expect(sendMail.mock.calls[0]![0].html).toContain("Ivy");
});

it("does not also send the instant alert to a digest member", async () => {
  await db.member.update({ where: { id: a.memberId }, data: { notifyOnView: true, viewDigest: true } });
  sendMail.mockClear();
  await viewAlertEmailWorker.handler([
    { data: { companyId: a.companyId, kind: "DATA_ROOM", targetId: aIds.dataRoomId, recipientId, occurrence: "first" } } as never,
  ]);
  expect(sendMail).not.toHaveBeenCalled();
});

it("sends nothing for a company with no activity", async () => {
  await db.viewEvent.deleteMany({ where: { companyId: a.companyId } });
  sendMail.mockClear();
  await run();
  expect(sendMail).not.toHaveBeenCalled();
});

it("ignores visits older than 24 h and bot visits", async () => {
  await visit(recipientId, 10, new Date(Date.now() - 30 * 3600_000));
  await db.viewEvent.create({ data: { companyId: a.companyId, kind: "DATA_ROOM", targetId: aIds.dataRoomId, recipientId, ip: "1.2.3.0", userAgent: "ua", isBot: true } });
  sendMail.mockClear();
  await run();
  expect(sendMail).not.toHaveBeenCalled();
});

it("never includes another company's activity", async () => {
  const theirs = await db.dataRoomRecipient.create({ data: { dataRoomId: bIds.dataRoomId, email: "secret-b@example.com", name: "SecretBViewer" } });
  await db.viewEvent.create({ data: { companyId: b.companyId, kind: "DATA_ROOM", targetId: bIds.dataRoomId, recipientId: theirs.id, ip: "1.2.3.0", userAgent: "ua", activeSeconds: 5 } });
  await visit(recipientId, 20); // something for A so A's digest is sent
  sendMail.mockClear();
  await run();
  const htmls = sendMail.mock.calls.map((c) => String(c[0].html));
  expect(htmls.length).toBeGreaterThan(0);
  expect(htmls.some((h) => h.includes("SecretBViewer"))).toBe(false);
});

it("a member who is both ADMIN and creator gets each item once", async () => {
  await db.dataRoom.update({ where: { id: aIds.dataRoomId }, data: { createdById: a.memberId } });
  await visit(recipientId, 20);
  sendMail.mockClear();
  await run();
  const html = String(sendMail.mock.calls[0]![0].html);
  expect(html.match(/Ivy/g)?.length ?? 0).toBeLessThanOrEqual(2); // name + at most one repeat inside one row's markup
  expect(sendMail).toHaveBeenCalledTimes(1);
});

it("members with alerts off or digest off get nothing from the digest", async () => {
  await visit(recipientId, 20);
  for (const data of [{ notifyOnView: false, viewDigest: true }, { notifyOnView: true, viewDigest: false }]) {
    await db.member.update({ where: { id: a.memberId }, data });
    sendMail.mockClear();
    await run();
    expect(sendMail).not.toHaveBeenCalled();
  }
});
```

The alert-job import for the second test: `import { viewAlertEmailWorker } from "@/jobs/view-alert-email";`. Seed `recipientId` (a `DataRoomRecipient` named "Ivy" on `aIds.dataRoomId`) in `beforeAll`, exactly as `view-alert-job.test.ts` does.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/tenant/view-digest-job.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Instant alerts skip digest members**

In `view-alert-email.ts` add `viewDigest: false,` to the members `where`.

- [ ] **Step 4: The worker**

```ts
// src/jobs/view-digest-email.ts
import ViewDigestEmail from "@/emails/ViewDigestEmail";
import { env } from "@/env";
import { describeTarget } from "@/server/activity/describe";
import { UNOPENED_AFTER_DAYS, findUnopened } from "@/server/activity/unopened";
import { db } from "@/server/db";
import { sendMail } from "@/server/mailer";
import { render } from "@react-email/components";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

const config = defineWorkerConfig({
  name: "email.view-digest",
  schema: z.object({}),
});
export const viewDigestEmailJob = defineJob(config);

const DAY = 86_400_000;

export const viewDigestEmailWorker = defineWorker(config, async () => {
  const now = new Date();
  const since = new Date(now.getTime() - DAY);

  // only companies with at least one digest member are looked at; a company
  // with no activity and nothing newly unopened is skipped inside the loop
  const digestMembers = await db.member.findMany({
    where: { status: "ACTIVE", notifyOnView: true, viewDigest: true },
    select: { id: true, role: true, companyId: true, user: { select: { email: true } } },
  });
  const companyIds = [...new Set(digestMembers.map((m) => m.companyId))];

  for (const companyId of companyIds) {
    const company = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, publicId: true },
    });
    const events = await db.viewEvent.findMany({
      where: { companyId, createdAt: { gte: since }, isBot: false },
      select: { kind: true, targetId: true, recipientId: true, activeSeconds: true },
    });
    const crossing = (await findUnopened(db, companyId, { now })).filter(
      (u) => now.getTime() - u.waitingSince.getTime() < (UNOPENED_AFTER_DAYS + 1) * DAY,
    );
    if (!events.length && !crossing.length) continue;

    // one row per (target, recipient)
    const rows = new Map<string, { kind: (typeof events)[number]["kind"]; targetId: string; recipientId: string; visits: number; seconds: number }>();
    for (const e of events) {
      const key = `${e.kind}:${e.targetId}:${e.recipientId}`;
      const r = rows.get(key) ?? { kind: e.kind, targetId: e.targetId, recipientId: e.recipientId, visits: 0, seconds: 0 };
      r.visits += 1;
      r.seconds += e.activeSeconds;
      rows.set(key, r);
    }
    const described = await Promise.all(
      [...rows.values()].map(async (r) => ({
        r,
        d: await describeTarget({ companyId, kind: r.kind, targetId: r.targetId, recipientId: r.recipientId }).catch(() => null),
      })),
    );

    for (const m of digestMembers.filter((x) => x.companyId === companyId)) {
      const mine = (owner: string | null) => m.role === "ADMIN" || owner === m.id;
      const viewRows = described
        .filter((x) => x.d && mine(x.d.ownerMemberId))
        .map((x) => ({ who: x.d!.who, label: x.d!.label, visits: x.r.visits, seconds: x.r.seconds }));
      const unopened = crossing
        .filter((u) => mine(u.ownerMemberId))
        .map((u) => ({ who: u.name || u.email, label: u.targetName }));
      if (!viewRows.length && !unopened.length) continue;

      await sendMail({
        to: m.user.email!,
        subject: `${company.name}: activity in the last 24 hours`,
        html: await render(
          ViewDigestEmail({
            companyName: company.name,
            rows: viewRows,
            unopened,
            link: `${env.NEXT_PUBLIC_BASE_URL}/${company.publicId}/activity`,
          }),
        ),
      });
    }
  }
});
// shortcut: 07:00 UTC for everyone; add a per-member hour when someone asks.
```

Scoping is the same rule as the instant alert: `ADMIN` sees everything, anyone else only what they created. Each (target, recipient) pair is one row, so a member who is both ADMIN and creator sees it once.

- [ ] **Step 5: The email**

`src/emails/ViewDigestEmail.tsx`: copy the structure of `ViewAlertEmail.tsx` (`BrandHeader`, `Tailwind`, button "Open activity"), with props `{ companyName: string; rows: { who: string; label: string; visits: number; seconds: number }[]; unopened: { who: string; label: string }[]; link: string }`, a list "Who looked" (`{who} · {label} · {visits} visit(s) · {m}:{ss}`) and, when `unopened.length`, a list "Not opened yet". Footer line: "You get this because the daily summary is on. Change it in your profile settings."

- [ ] **Step 6: Register and schedule**

In `register.ts`: import and `queueManager.register(viewDigestEmailWorker);`, and after the purge schedule:

```ts
  await queue
    .schedule("email.view-digest", "0 7 * * *", {})
    .catch(() =>
      logger.child({ module: "queue" }).warn("could not schedule email.view-digest"),
    );
```

In `src/constants/job.ts` add `"view-digest"` to the `email` array.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run tests/tenant/view-digest-job.test.ts tests/tenant/view-alert-job.test.ts tests/tenant/architecture.test.ts && pnpm tsc --noEmit && pnpm lint`
Expected: PASS. (`architecture.test.ts` guards that every job name is in `JOB_TYPES`; if it also checks a scheduled job is documented, follow the entry for `maintenance.purge-view-events`.)

```bash
git add src tests
git commit -m "feat(activity): daily digest of views and unopened links"
```

---

### Task 8: Digest switch in profile settings

**Files:**
- Modify: `src/trpc/routers/member-router/procedures/view-alerts.ts`, `src/trpc/routers/member-router/router.ts`, `src/components/member/view-alerts-setting.tsx`, `tests/tenant/roles.test.ts`
- Test: `tests/tenant/view-alerts-switch.test.ts` (extend)

**Interfaces:**
- Produces: `member.viewDigest` (query, boolean) and `member.setViewDigest({ enabled })` (mutation), both `withTenant`.

- [ ] **Step 1: Failing test** — in `tests/tenant/view-alerts-switch.test.ts` add: `setViewDigest({ enabled: true })` updates only the caller's own `Member.viewDigest`; another member of the same company and a member of tenant B are unchanged; `viewDigest` query returns the stored value.
- [ ] **Step 2: Run** `pnpm vitest run tests/tenant/view-alerts-switch.test.ts` — Expected: FAIL.
- [ ] **Step 3: Procedures** — in `view-alerts.ts` add, mirroring the existing pair exactly:

```ts
export const getViewDigestProcedure = withTenant.query(
  async ({ ctx: { tenant } }) => {
    const member = await tenant.db.member.findUniqueOrThrow({
      where: { id: tenant.memberId },
      select: { viewDigest: true },
    });
    return member.viewDigest;
  },
);

export const setViewDigestProcedure = withTenant
  .input(z.object({ enabled: z.boolean() }))
  .mutation(async ({ ctx: { tenant }, input }) => {
    await tenant.db.member.update({
      where: { id: tenant.memberId },
      data: { viewDigest: input.enabled },
    });
    return input.enabled;
  });
```

Register `viewDigest` and `setViewDigest` in `member-router/router.ts`.
- [ ] **Step 4: Role matrix** — add `"member.setViewDigest"` to `EXEMPT` in `tests/tenant/roles.test.ts` with the same reason string as `"member.setViewAlerts"` (read that entry and reuse its wording).
- [ ] **Step 5: UI** — in `view-alerts-setting.tsx` add a second row below the first with title "Daily summary" and text "Get one email a day instead of an email for every view." using `api.member.viewDigest` / `api.member.setViewDigest`, disabled when "Activity alerts" is off (`data === false`), with the same error toast.
- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run tests/tenant/view-alerts-switch.test.ts tests/tenant/roles.test.ts && pnpm tsc --noEmit && pnpm lint`
Expected: PASS.

```bash
git add src tests
git commit -m "feat(activity): per-member switch for the daily summary"
```

---

### Task 9: Whole-branch verification, deploy, operator steps (orchestrator)

- [ ] **Step 1:** `pnpm vitest run` (full suite, one process only: two concurrent runs share the test database), `pnpm tsc --noEmit`, `pnpm lint`. All green, or the failures reported.
- [ ] **Step 2:** Opus whole-branch review (cross-tenant reads in `findUnopened` and the digest, public-path expiry, nudge claim logic). Fix findings, re-run Step 1.
- [ ] **Step 3: PR** to `main`; wait for the Tests and Image workflows; merge only with the owner's approval.
- [ ] **Step 4: Production migration** (owner approves): Neon backup branch `pre-activity-phase-3-<date>` from `production`, apply `20261015000000_activity_phase_3/migration.sql` through the Neon connector, insert the `_prisma_migrations` row with the file's sha256 (same procedure as Phase 2). Verify the three columns exist.
- [ ] **Step 5: Deploy** (owner approves): pull `ghcr.io/tin-wizard/captable:<full sha>`, back up `compose.yml`, switch the image, recreate `app`, wait for healthy, confirm the log shows `Registering job:email.view-digest`. Rollback: previous compose backup (the old image runs against the migrated schema).
- [ ] **Step 6: Production test** (owner present): (a) share a data room with 7-day expiry, confirm `expiresAt` ≈ now+7d; (b) set the row's `expiresAt` to the past, open the link in a private window, expect the expired page and no `ViewEvent`; re-share and confirm it works again; (c) backdate a recipient's `updatedAt` by 4 days, see it under "Not opened yet", click Send reminder, confirm one email with "Reminder:"; the row leaves Not opened yet and reappears after 3 days; (d) turn the daily summary on, run the digest once by emitting `email.view-digest` (or waiting for 07:00 UTC), confirm one email and no instant alert for that member. Delete every test row afterwards with the owner's approval.
- [ ] **Step 7 (separate approval): `PUBLIC_LINK_REQUIRE_EXPIRY=1`.** Do this only 30 days after the deploy that added `exp` to every token (`LINK_TTL`; recorded in the Phase 2 retrospective), so no link without `exp` is still valid. Set it in `/opt/captable/.env`, `docker compose up -d --force-recreate app`, open one fresh link and one pre-Phase-3 link to confirm both still work. Rollback is removing the line.

---

## Self-review

- **Coverage:** digest (Tasks 6, 7, 8), per-event settings reduced to the two switches that exist (alerts, digest) — the owner's "per-event settings" ask is deliberately narrowed to this, stated in the decisions table; nudges (4, 5); expiry and the revoke 500 (2, 3); operator flag (9).
- **Placeholders:** the three test bodies in Task 7 that are described rather than written are marked "fill before running"; everything else has code. The role entries copy named existing lines instead of inventing wording.
- **Type consistency:** `Unopened`, `findUnopened`, `NUDGE_COOLDOWN_MS`, `isExpired`, `expiryFromDays`, `describeTarget`, `viewDigest` are used with the same names in every task that touches them.
- **Known limits (documented in code as `shortcut:`):** 200-row cap per kind; "waiting since" is `updatedAt`; digest hour is 07:00 UTC for everyone.
