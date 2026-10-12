# Document Activity, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record when a known recipient opens a shared data room, investor update or e-sign document, and email the sender and company admins on first open and on return visits.

**Architecture:** One tenant-scoped `ViewEvent` table is written by a public, token-authenticated beacon route that a tiny client component calls after the page has really rendered (never on the bare GET). A pg-boss job turns `first` and `return` visits into email alerts. E-sign also writes a `recipient.viewed` row to the existing `EsignAudit`, so it appears in the audit trail.

**Tech Stack:** Next.js 16 App Router, Prisma (relationMode `prisma`), tRPC v10, pg-boss 10, react-email, vitest, Biome.

**Spec:** Approved scope in the "Deal Room Activity" recommendation (this session, 2026-10-12), Phase 1, with the deviations listed under "Deviations from the approved scope". Phases 2 and 3 get their own plans after Phase 1 ships.

## Deviations from the approved scope (need your sign-off)

| Approved | This plan | Why |
|---|---|---|
| Country/region location in Phase 1 | **Deferred to Phase 2** | Needs a data source decision: an offline MaxMind database (account and licence), or enabling Cloudflare's proxy for `CF-IPCountry`. Neither is free of side effects. |
| IP truncated after 90 days | **IP truncated at write** (/24 IPv4, /48 IPv6) | Simpler (no retention job) and more private. The full IP is still kept for signing evidence in `EsignAudit`, as today. |
| Per-user, per-event notification settings | **One per-member switch** (`Member.notifyOnView`) | Smallest thing that lets a person opt out. Per-event settings come with the Phase 3 digest. |
| E-sign `VIEWED` state | **No enum change.** "Viewed" is a `recipient.viewed` audit row plus `ViewEvent` | `EsignRecipientStatus` is filtered on by the signing queries (`status: "SENT"`). Adding a value risks breaking signing. |

## Global Constraints

- Do not change tokens, token encoding, verification links, auth flow, or any membership authorization logic. The beacon only **reads** tokens.
- A bare GET of a shared page must record nothing (link scanners and previews do GETs).
- `.env` on this machine points `DATABASE_URL` at **Neon**. Never run `prisma migrate dev` or tests with it. Use `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test` (the `pnpm test` default).
- Prisma runs with `relationMode = "prisma"`: no database FKs, `onDelete: Cascade` is emulated by the client.
- Every new model with a `companyId` must be listed in `TENANT_MODELS` in `src/server/tenant-db.ts`.
- Branch from `origin/main` in a fresh worktree. The `captable-subdomains` worktree has another session's uncommitted changes (member router, `sign-template.ts`, `esign-fields*`); do not touch or build on them.
- Format with Biome (`npx biome check --apply <files>`, version 1.7.3). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not run the production migration, deploy, or touch production data as part of this plan. See "Deploy gate".

## Review Focus

1. **Link scanner GETs.** A mail scanner or preview that only does a GET must create no `ViewEvent` and send no email. Pinned by Task 3 (only the beacon route writes) and Task 7 Step 3 (a grep proves no page or layout calls `recordView`).
2. **Cross-tenant token.** A token whose `companyId` is B but whose room/template belongs to A must be rejected with 404 and write nothing. Pinned in Task 3.
3. **Invalid, expired or garbage token.** 404, no event, no email, no 500. Pinned in Task 3.
4. **Refresh spam.** Reloading within 30 minutes is `repeat`: stored, never emailed. Two concurrent first beacons produce at most one alert. Pinned in Tasks 2 and 3.
5. **Bots and scanners that run JS.** A flagged user agent is stored with `isBot: true` and never counts as `first`/`return`, never emails, and never resets the return clock. Pinned in Task 2.

## Model routing

Policy: Opus orchestrates, Sonnet builds, Haiku only runs mechanical steps. Tenant isolation and public-token paths start at Opus (security rule 3). Sonnet output on security-adjacent work gets an Opus review. Stale model names must not appear.

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Schema, migration, tenant registry | `opus` | `general-purpose` | Tenant isolation registry (security rule 3) |
| 2. Event core (`view-events.ts`) + tests | `sonnet` | `general-purpose` | Pure logic with edge cases and DB tests; Opus reviews it as part of the branch review |
| 3. Beacon route | `opus` | `general-purpose` | Public unauthenticated endpoint that validates three token types and writes tenant data (rule 3) |
| 4. Alert job, email template, registration | `sonnet` | `general-purpose` | Follows the existing job/email pattern |
| 5. Client beacon, notice, page mounts | `sonnet` | `general-purpose` | Small client component, four page edits |
| 6. Per-member switch (procedure, UI, allowlist) | `sonnet` | `general-purpose` | Copies the `get-profile` pattern; touches the tenancy allowlist so Opus reviews the diff |
| 7. Local verification run | `haiku` | `general-purpose` | Mechanical: run commands and report output |
| Per-task spec review | `sonnet` (`opus` for 1, 3, 6) | `general-purpose` | Per matrix |
| Final review of the whole branch | `opus` | `general-purpose` | Cross-cutting, security-adjacent |
| Deploy and production verification | Orchestrator | n/a | Touches production and needs the user's approval |

Before dispatching each task after the first, the orchestrator writes a short **Previous Phase Context Review** from the actual diff, test results and deviations, and puts the findings in the next subagent's brief.

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `ViewKind`, `ViewEvent`, `Member.notifyOnView`, `Company.viewEvents` |
| `prisma/migrations/20261013000000_view_events/migration.sql` | The matching SQL |
| `src/server/tenant-db.ts` | Register `ViewEvent` as a tenant model |
| `src/server/audit/schema.ts` | Allow the `recipient.viewed` e-sign audit action |
| `src/server/view-events.ts` | `isAtypicalSource`, `truncateIp`, `recordView` |
| `src/app/api/activity/view/route.ts` | Public POST beacon; resolves token to recipient, records, audits, enqueues |
| `src/jobs/view-alert-email.ts` | Worker that emails the right members |
| `src/emails/ViewAlertEmail.tsx` | The alert email |
| `src/constants/job.ts`, `src/jobs/register.ts` | Register the job |
| `src/components/share/view-beacon.tsx` | `ViewBeacon` (client) and `ViewNotice` |
| `src/components/share/page-layout.tsx` | Show the notice on shared pages |
| 4 public pages | Mount `ViewBeacon` |
| `src/trpc/routers/member-router/procedures/view-alerts.ts` + `router.ts` | Get/set the per-member switch |
| `src/components/member/view-alerts-setting.tsx` + profile page | The switch UI |

---

### Task 1: Schema, migration and tenant registry

**Files:**
- Modify: `prisma/schema.prisma` (add enum and model; add field to `Member`; add relation to `Company`)
- Create: `prisma/migrations/20261013000000_view_events/migration.sql`
- Modify: `src/server/tenant-db.ts:28` (add `"ViewEvent"` to `TENANT_MODELS`)
- Modify: `src/server/audit/schema.ts` (`EsignAuditSchema.action` enum)
- Test: `tests/tenant/view-events.test.ts` (created here, extended in Task 2)

**Interfaces:**
- Produces: Prisma `ViewEvent` {id, kind: ViewKind, targetId, recipientId, ip, userAgent, isBot, createdAt, companyId}; `ViewKind` = `DATA_ROOM | UPDATE | ESIGN`; `Member.notifyOnView: boolean`; e-sign audit action `"recipient.viewed"`.

- [ ] **Step 1: Write the failing tenant-isolation test**

Create `tests/tenant/view-events.test.ts`:

```ts
import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});

afterAll(async () => {
  await cleanupTenants(a, b);
});

describe("ViewEvent is a tenant model", () => {
  it("tenant A never sees tenant B's events", async () => {
    const mine = await db.viewEvent.create({
      data: { companyId: a.companyId, kind: "ESIGN", targetId: "t", recipientId: "r", ip: "1.2.3.0", userAgent: "ua" },
    });
    const theirs = await db.viewEvent.create({
      data: { companyId: b.companyId, kind: "ESIGN", targetId: "t", recipientId: "r", ip: "1.2.3.0", userAgent: "ua" },
    });

    const seen = await tenantDb(db, a.companyId).viewEvent.findMany();

    expect(seen.map((e) => e.id)).toContain(mine.id);
    expect(seen.map((e) => e.id)).not.toContain(theirs.id);
  });

  it("a member's alert switch defaults to on", async () => {
    const member = await db.member.findUniqueOrThrow({ where: { id: a.memberId } });
    expect(member.notifyOnView).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/tenant/view-events.test.ts`
Expected: FAIL (`db.viewEvent` is undefined / Prisma type error).

- [ ] **Step 3: Edit the schema**

In `prisma/schema.prisma`, add after the `EsignAudit` model:

```prisma
enum ViewKind {
  DATA_ROOM
  UPDATE
  ESIGN
}

// One confirmed view of a shared page by a known recipient. `isBot` rows are
// kept for transparency but never count as a first or return visit.
model ViewEvent {
  id          String   @id @default(cuid())
  kind        ViewKind
  // DataRoom.id | Update.id | Template.id
  targetId    String
  // DataRoomRecipient.id | UpdateRecipient.id | EsignRecipient.id (three tables, so no FK)
  recipientId String
  // truncated at write: /24 for IPv4, /48 for IPv6
  ip          String
  userAgent   String
  isBot       Boolean  @default(false)
  createdAt   DateTime @default(now())

  companyId String
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId])
  @@index([kind, targetId, recipientId, createdAt])
}
```

In `model Member`, add under `lastAccessed`:

```prisma
  // email alerts when a recipient opens or returns to something shared
  notifyOnView Boolean @default(true)
```

In `model Company`, add with the other relation lists: `viewEvents ViewEvent[]`.

- [ ] **Step 4: Write the migration**

Create `prisma/migrations/20261013000000_view_events/migration.sql` (generate with `DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx prisma migrate dev --create-only --name view_events` and confirm it matches; never use the `.env` URL):

```sql
-- CreateEnum
CREATE TYPE "ViewKind" AS ENUM ('DATA_ROOM', 'UPDATE', 'ESIGN');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN "notifyOnView" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ViewEvent" (
    "id" TEXT NOT NULL,
    "kind" "ViewKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "ViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViewEvent_companyId_idx" ON "ViewEvent"("companyId");

-- CreateIndex
CREATE INDEX "ViewEvent_kind_targetId_recipientId_createdAt_idx" ON "ViewEvent"("kind", "targetId", "recipientId", "createdAt");
```

- [ ] **Step 5: Register the tenant model and the audit action**

`src/server/tenant-db.ts`, in `TENANT_MODELS` after `"CompanyDomain",`:

```ts
  "ViewEvent",
```

`src/server/audit/schema.ts`, in `EsignAuditSchema`:

```ts
  action: z.enum([
    "document.complete",
    "recipient.signed",
    "recipient.viewed",
    "document.email.sent",
  ]),
```

- [ ] **Step 6: Apply to the local test DB, regenerate the client, run the test**

Run:
```bash
export TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
npx prisma generate
npx vitest run tests/tenant/view-events.test.ts tests/tenant/architecture.test.ts tests/tenant/tenant-db.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261013000000_view_events src/server/tenant-db.ts src/server/audit/schema.ts tests/tenant/view-events.test.ts
git commit -m "feat(activity): add ViewEvent model and Member.notifyOnView"
```

---

### Task 2: Event core

**Files:**
- Create: `src/server/view-events.ts`
- Test: `src/server/view-events.test.ts` (pure), `tests/tenant/view-events.test.ts` (DB, extend)

**Interfaces:**
- Consumes: Task 1's `ViewEvent`, `ViewKind`.
- Produces:
  - `isAtypicalSource(userAgent: string): boolean`
  - `truncateIp(ip: string): string`
  - `recordView(db: TPrismaOrTransaction, v: { companyId: string; kind: ViewKind; targetId: string; recipientId: string; ip: string; userAgent: string }): Promise<"first" | "return" | "repeat" | "bot">`

- [ ] **Step 1: Write the failing pure tests**

Create `src/server/view-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAtypicalSource, truncateIp } from "./view-events";

const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

describe("isAtypicalSource", () => {
  it.each([
    "",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Slackbot-LinkExpanding 1.0",
    "curl/8.4.0",
    "Mozilla/5.0 SafeLinks Protection",
  ])("flags %j", (ua) => expect(isAtypicalSource(ua)).toBe(true));

  it.each([SAFARI, CHROME])("passes a real browser", (ua) =>
    expect(isAtypicalSource(ua)).toBe(false),
  );
});

describe("truncateIp", () => {
  it.each([
    ["203.0.113.9", "203.0.113.0"],
    ["127.0.0.1", "127.0.0.0"],
    ["::ffff:198.51.100.7", "198.51.100.0"],
    ["2001:db8:85a3:8d3:1319:8a2e:370:7344", "2001:db8:85a3::"],
    ["2001:db8::1", "2001:db8::"],
    ["::1", "::"],
    ["not-an-ip", ""],
  ])("%s -> %s", (input, expected) => expect(truncateIp(input)).toBe(expected));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/server/view-events.test.ts`
Expected: FAIL (`./view-events` not found).

- [ ] **Step 3: Write the minimal implementation**

Create `src/server/view-events.ts`:

```ts
import type { TPrismaOrTransaction } from "@/server/db";
import type { ViewKind } from "@prisma/client";

// shortcut: a user-agent list catches mail scanners and link previews that run
// JS, not residential-proxy bots; swap for a maintained list if false views show up.
const ATYPICAL_UA =
  /bot|crawl|spider|preview|scan|monitor|headless|curl|wget|python|slackbot|facebookexternalhit|proofpoint|mimecast|barracuda|defender|safelinks/i;

export const isAtypicalSource = (userAgent: string) =>
  !userAgent || ATYPICAL_UA.test(userAgent);

// IPv4 -> /24, IPv6 -> /48; unparseable input is dropped, not stored
export function truncateIp(ip: string) {
  const v4 = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.0`;
  if (ip.includes(":")) {
    const head = ip.split("::")[0] ?? "";
    return `${head.split(":").slice(0, 3).filter(Boolean).join(":")}::`;
  }
  return "";
}

export type Visit = "first" | "return" | "repeat" | "bot";

const RETURN_AFTER_MS = 30 * 60 * 1000;

type NewView = {
  companyId: string;
  kind: ViewKind;
  targetId: string;
  recipientId: string;
  ip: string;
  userAgent: string;
};

// shortcut: read-then-write is not atomic, so two simultaneous first beacons can
// both report "first"; the alert job's singletonKey absorbs the duplicate email.
export async function recordView(
  db: TPrismaOrTransaction,
  v: NewView,
): Promise<Visit> {
  const isBot = isAtypicalSource(v.userAgent);
  const last = await db.viewEvent.findFirst({
    where: {
      kind: v.kind,
      targetId: v.targetId,
      recipientId: v.recipientId,
      isBot: false,
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  await db.viewEvent.create({ data: { ...v, ip: truncateIp(v.ip), isBot } });

  if (isBot) return "bot";
  if (!last) return "first";
  return Date.now() - last.createdAt.getTime() > RETURN_AFTER_MS
    ? "return"
    : "repeat";
}
```

- [ ] **Step 4: Run the pure tests, expect PASS**

Run: `npx vitest run src/server/view-events.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Add the failing DB tests**

Append to `tests/tenant/view-events.test.ts` (add `import { recordView } from "@/server/view-events";` at the top):

```ts
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const view = (over: Partial<Parameters<typeof recordView>[1]> = {}) => ({
  companyId: a.companyId,
  kind: "DATA_ROOM" as const,
  targetId: "room-1",
  recipientId: `rec-${Math.random().toString(36).slice(2)}`,
  ip: "203.0.113.9",
  userAgent: UA,
  ...over,
});

describe("recordView", () => {
  it("first, then repeat inside 30 minutes, then return after", async () => {
    const v = view();
    expect(await recordView(db, v)).toBe("first");
    expect(await recordView(db, v)).toBe("repeat");
    await db.viewEvent.updateMany({
      where: { recipientId: v.recipientId },
      data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    expect(await recordView(db, v)).toBe("return");
  });

  it("stores a bot without letting it count or reset the clock", async () => {
    const v = view({ userAgent: "Slackbot-LinkExpanding 1.0" });
    expect(await recordView(db, v)).toBe("bot");
    expect(await recordView(db, { ...v, userAgent: UA })).toBe("first");
    const rows = await db.viewEvent.findMany({
      where: { recipientId: v.recipientId },
    });
    expect(rows.map((r) => r.isBot).sort()).toEqual([false, true]);
  });

  it("stores only a truncated ip", async () => {
    const v = view();
    await recordView(db, v);
    const row = await db.viewEvent.findFirstOrThrow({
      where: { recipientId: v.recipientId },
    });
    expect(row.ip).toBe("203.0.113.0");
  });
});
```

- [ ] **Step 6: Run, verify PASS**

Run: `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx vitest run tests/tenant/view-events.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx biome check --apply src/server/view-events.ts src/server/view-events.test.ts tests/tenant/view-events.test.ts
git add src/server/view-events.ts src/server/view-events.test.ts tests/tenant/view-events.test.ts
git commit -m "feat(activity): record views with first/return/repeat/bot classification"
```

---

### Task 3: Beacon route

**Files:**
- Create: `src/app/api/activity/view/route.ts`
- Test: `tests/tenant/view-beacon.test.ts`

**Interfaces:**
- Consumes: `recordView` (Task 2); `viewAlertEmailJob.emit(data, options)` (Task 4, mocked here); `decode` from `@/lib/jwt`; `DecodeEmailToken` and `EncodeEmailToken` from `@/trpc/routers/template-field-router/procedures/add-fields`; `EsignAudit.create(data, tx)` from `@/server/audit`; `getIp`, `getUserAgent` from `@/lib/headers`.
- Produces: `POST /api/activity/view` with body `{ kind: "DATA_ROOM" | "UPDATE" | "ESIGN", token: string }`. Responses: `204` recorded, `400` bad body, `404` token invalid or recipient not found. Job payload: `{ companyId, kind, targetId, recipientId, occurrence: "first" | "return" }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/tenant/view-beacon.test.ts`:

```ts
import { encode } from "@/lib/jwt";
import { db } from "@/server/db";
import { EncodeEmailToken } from "@/trpc/routers/template-field-router/procedures/add-fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

const emit = vi.hoisted(() => vi.fn());
vi.mock("@/jobs/view-alert-email", () => ({ viewAlertEmailJob: { emit } }));

import { POST } from "@/app/api/activity/view/route";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const call = (body: unknown, userAgent = UA) =>
  POST(
    new Request("http://localhost/api/activity/view", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.9",
        "user-agent": userAgent,
      },
      body: JSON.stringify(body),
    }),
  );

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let roomRecipientId: string;
let updatePublicId: string;
let updateRecipientId: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  roomRecipientId = (
    await db.dataRoomRecipient.create({
      data: { email: "inv@example.com", dataRoomId: aIds.dataRoomId },
    })
  ).id;
  updatePublicId = (
    await db.update.findUniqueOrThrow({ where: { id: aIds.updateId } })
  ).publicId;
  updateRecipientId = (
    await db.updateRecipient.create({
      data: { email: "inv@example.com", updateId: aIds.updateId },
    })
  ).id;
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

beforeEach(() => emit.mockClear());

const roomToken = (over: Record<string, string> = {}) =>
  encode({
    companyId: a.companyId,
    dataRoomId: aIds.dataRoomId,
    recipientId: roomRecipientId,
    ...over,
  });

const eventsFor = (recipientId: string) =>
  db.viewEvent.findMany({ where: { recipientId } });

describe("POST /api/activity/view", () => {
  it("records a data room view and alerts once", async () => {
    const token = await roomToken();
    expect((await call({ kind: "DATA_ROOM", token })).status).toBe(204);
    expect(await eventsFor(roomRecipientId)).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      companyId: a.companyId,
      kind: "DATA_ROOM",
      recipientId: roomRecipientId,
      occurrence: "first",
    });

    // a reload is stored but never emailed
    expect((await call({ kind: "DATA_ROOM", token })).status).toBe(204);
    expect(await eventsFor(roomRecipientId)).toHaveLength(2);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("rejects a token whose company does not own the room", async () => {
    const token = await roomToken({ companyId: b.companyId });
    const before = (await eventsFor(roomRecipientId)).length;
    expect((await call({ kind: "DATA_ROOM", token })).status).toBe(404);
    expect(await eventsFor(roomRecipientId)).toHaveLength(before);
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects a garbage token and a malformed body without a 500", async () => {
    expect((await call({ kind: "DATA_ROOM", token: "nope" })).status).toBe(404);
    expect((await call({ kind: "ESIGN", token: "nope" })).status).toBe(404);
    expect((await call({ kind: "WAT", token: "x" })).status).toBe(400);
    expect((await call("not an object")).status).toBe(400);
    expect(emit).not.toHaveBeenCalled();
  });

  it("stores a bot but sends no alert", async () => {
    const recipient = await db.dataRoomRecipient.create({
      data: { email: "scan@example.com", dataRoomId: aIds.dataRoomId },
    });
    const token = await roomToken({ recipientId: recipient.id });
    const res = await call(
      { kind: "DATA_ROOM", token },
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
    );
    expect(res.status).toBe(204);
    const [row] = await eventsFor(recipient.id);
    expect(row?.isBot).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it("records an update view", async () => {
    const token = await encode({
      publicId: updatePublicId,
      companyId: a.companyId,
      recipientId: updateRecipientId,
    });
    expect((await call({ kind: "UPDATE", token })).status).toBe(204);
    expect(await eventsFor(updateRecipientId)).toHaveLength(1);
  });

  it("records an e-sign view and writes one recipient.viewed audit row", async () => {
    const recipient = await db.esignRecipient.findUniqueOrThrow({
      where: { id: aIds.recipientId },
    });
    const token = await EncodeEmailToken({
      recipientId: recipient.id,
      templateId: recipient.templateId,
    });
    expect((await call({ kind: "ESIGN", token })).status).toBe(204);
    expect((await call({ kind: "ESIGN", token })).status).toBe(204);
    const audits = await db.esignAudit.findMany({
      where: { recipientId: recipient.id, action: "recipient.viewed" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.ip).toBe("203.0.113.9");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx vitest run tests/tenant/view-beacon.test.ts`
Expected: FAIL (route module not found).

- [ ] **Step 3: Write the route**

Create `src/app/api/activity/view/route.ts`:

```ts
import { viewAlertEmailJob } from "@/jobs/view-alert-email";
import { getIp, getUserAgent } from "@/lib/headers";
import { decode } from "@/lib/jwt";
import { EsignAudit } from "@/server/audit";
import { db } from "@/server/db";
import { recordView } from "@/server/view-events";
import { DecodeEmailToken } from "@/trpc/routers/template-field-router/procedures/add-fields";
import { z } from "zod";

const bodySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]),
  token: z.string().min(1),
});

type Kind = z.infer<typeof bodySchema>["kind"];

type Found = {
  companyId: string;
  targetId: string;
  recipientId: string;
  templateName?: string;
  recipientName?: string | null;
};

// Same tokens the public pages already accept; this only reads them.
// null for anything invalid, expired, or not owned by the company in the token.
export async function resolveRecipient(
  kind: Kind,
  token: string,
): Promise<Found | null> {
  try {
    if (kind === "ESIGN") {
      const { id: templateId, rec } = await DecodeEmailToken(token);
      const r = await db.esignRecipient.findFirst({
        where: { id: rec, templateId },
        select: {
          id: true,
          name: true,
          template: { select: { companyId: true, name: true } },
        },
      });
      return r
        ? {
            companyId: r.template.companyId,
            targetId: templateId,
            recipientId: r.id,
            templateName: r.template.name,
            recipientName: r.name,
          }
        : null;
    }

    const { payload } = await decode(token);
    const p = payload as Record<string, string | undefined>;
    if (!p.companyId || !p.recipientId) return null;

    if (kind === "DATA_ROOM") {
      if (!p.dataRoomId) return null;
      const r = await db.dataRoomRecipient.findFirst({
        where: {
          id: p.recipientId,
          dataRoomId: p.dataRoomId,
          dataRoom: { companyId: p.companyId },
        },
        select: { id: true },
      });
      return r
        ? { companyId: p.companyId, targetId: p.dataRoomId, recipientId: r.id }
        : null;
    }

    if (!p.publicId) return null;
    const update = await db.update.findFirst({
      where: { publicId: p.publicId, companyId: p.companyId },
      select: { id: true },
    });
    if (!update) return null;
    const r = await db.updateRecipient.findFirst({
      where: { id: p.recipientId, updateId: update.id },
      select: { id: true },
    });
    return r
      ? { companyId: p.companyId, targetId: update.id, recipientId: r.id }
      : null;
  } catch {
    return null;
  }
}

export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });

  const { kind, token } = body.data;
  const found = await resolveRecipient(kind, token);
  if (!found) return new Response(null, { status: 404 });

  const ip = getIp(req.headers);
  const userAgent = getUserAgent(req.headers);

  const visit = await recordView(db, {
    companyId: found.companyId,
    kind,
    targetId: found.targetId,
    recipientId: found.recipientId,
    ip,
    userAgent,
  });

  // the e-sign trail keeps the full ip, like recipient.signed does
  if (kind === "ESIGN" && visit === "first") {
    await EsignAudit.create(
      {
        action: "recipient.viewed",
        companyId: found.companyId,
        templateId: found.targetId,
        recipientId: found.recipientId,
        ip,
        userAgent,
        location: "",
        summary: `${found.recipientName ?? "A recipient"} viewed "${found.templateName}"`,
      },
      db,
    );
  }

  if (visit === "first" || visit === "return") {
    await viewAlertEmailJob.emit(
      {
        companyId: found.companyId,
        kind,
        targetId: found.targetId,
        recipientId: found.recipientId,
        occurrence: visit,
      },
      {
        singletonKey: `${kind}:${found.recipientId}:${visit}`,
        singletonSeconds: 1800,
      },
    );
  }

  return new Response(null, { status: 204 });
};
```

- [ ] **Step 4: Run, verify PASS**

Run: `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx vitest run tests/tenant/view-beacon.test.ts`
Expected: PASS (6 tests). (The job module is mocked, so Task 4 is not needed yet; the mock path `@/jobs/view-alert-email` must still resolve for `tsc`, which Task 4 provides.)

- [ ] **Step 5: Commit**

```bash
npx biome check --apply src/app/api/activity tests/tenant/view-beacon.test.ts
git add src/app/api/activity tests/tenant/view-beacon.test.ts
git commit -m "feat(activity): token-authenticated view beacon route"
```

---

### Task 4: Alert job and email

**Files:**
- Create: `src/jobs/view-alert-email.ts`, `src/emails/ViewAlertEmail.tsx`
- Modify: `src/constants/job.ts`, `src/jobs/register.ts`, `src/emails/brand.test.ts`
- Test: `tests/tenant/view-alert-job.test.ts`

**Interfaces:**
- Consumes: `defineJob`, `defineWorker`, `defineWorkerConfig` from `@/lib/queue`; `sendMail` from `@/server/mailer`; `BrandHeader` from `src/emails/components/BrandHeader`.
- Produces: `viewAlertEmailJob` (`.emit`), `viewAlertEmailWorker` (`.handler([job])`), `ViewAlertEmail` props `{ companyName: string; who: string; label: string; occurrence: "first" | "return"; link: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/tenant/view-alert-job.test.ts`:

```ts
import { db } from "@/server/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/server/mailer", () => ({ sendMail }));

import { viewAlertEmailWorker } from "@/jobs/view-alert-email";

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let recipientId: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  recipientId = (
    await db.dataRoomRecipient.create({
      data: { email: "investor@example.com", name: "Ivy", dataRoomId: aIds.dataRoomId },
    })
  ).id;
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

beforeEach(() => sendMail.mockClear());

const run = (occurrence: "first" | "return") =>
  viewAlertEmailWorker.handler([
    {
      data: {
        companyId: a.companyId,
        kind: "DATA_ROOM",
        targetId: aIds.dataRoomId,
        recipientId,
        occurrence,
      },
    } as never,
  ]);

describe("view alert job", () => {
  it("emails each active admin who has alerts on, and names the viewer", async () => {
    await db.member.update({ where: { id: a.memberId }, data: { notifyOnView: true } });
    await run("first");
    const admin = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    const to = sendMail.mock.calls.map((c) => c[0].to);
    expect(to).toContain(admin.email);
    expect(sendMail.mock.calls[0]?.[0].subject).toContain("Ivy");
    expect(sendMail.mock.calls[0]?.[0].subject).toContain("opened");
  });

  it("sends nothing to a member who turned alerts off", async () => {
    await db.member.update({ where: { id: a.memberId }, data: { notifyOnView: false } });
    await run("return");
    const admin = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    expect(sendMail.mock.calls.map((c) => c[0].to)).not.toContain(admin.email);
  });

  it("never emails another company's members", async () => {
    await db.member.update({ where: { id: a.memberId }, data: { notifyOnView: true } });
    await run("first");
    const other = await db.user.findUniqueOrThrow({ where: { id: b.userId } });
    expect(sendMail.mock.calls.map((c) => c[0].to)).not.toContain(other.email);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx vitest run tests/tenant/view-alert-job.test.ts`
Expected: FAIL (module `@/jobs/view-alert-email` not found).

- [ ] **Step 3: Add the job type**

`src/constants/job.ts`, in the `email` array add `"view-alert",` after `"esign-notification",`.

- [ ] **Step 4: Write the email template**

Create `src/emails/ViewAlertEmail.tsx`:

```tsx
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { constants } from "../lib/constants";
import { BrandHeader } from "./components/BrandHeader";

interface ViewAlertEmailProps {
  companyName: string;
  who: string;
  label: string;
  occurrence: "first" | "return";
  link: string;
}

export const ViewAlertEmail = ({
  companyName,
  who,
  label,
  occurrence,
  link,
}: ViewAlertEmailProps) => {
  const verb = occurrence === "first" ? "opened" : "came back to";

  return (
    <Html>
      <Head />
      <Preview>{`${who} ${verb} ${label}`}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-[40px] max-w-[465px] border-separate rounded border border-solid border-neutral-200 p-[20px]">
            <BrandHeader />
            <Heading className="mx-0 my-[30px] p-0 text-center text-[20px] font-normal text-black">
              <strong>{who}</strong> {verb} {label}
            </Heading>
            <Text className="text-[14px] leading-[24px] text-black">
              This was shared from <strong>{companyName}</strong> on{" "}
              {constants.title}. Previews from mail scanners are filtered out.
            </Text>
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-black px-5 py-3 text-center text-[12px] font-semibold text-white no-underline"
                href={link}
              >
                Open in {constants.title}
              </Button>
            </Section>
            <Hr className="mx-0 my-[26px] w-full border border-solid border-neutral-200" />
            <Text className="text-[12px] leading-[20px] text-gray-400">
              You get this because activity alerts are on. Turn them off in
              Settings, Profile.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

ViewAlertEmail.PreviewProps = {
  companyName: "Batmobile",
  who: "Ivy",
  label: 'the data room "Series A"',
  occurrence: "first",
  link: "https://dealroom.tin.info/...",
} as ViewAlertEmailProps;

export default ViewAlertEmail;
```

- [ ] **Step 5: Write the job**

Create `src/jobs/view-alert-email.ts`:

```ts
import ViewAlertEmail from "@/emails/ViewAlertEmail";
import { env } from "@/env";
import { db } from "@/server/db";
import { sendMail } from "@/server/mailer";
import { render } from "@react-email/components";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

const config = defineWorkerConfig({
  name: "email.view-alert",
  schema: z.object({
    companyId: z.string(),
    kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]),
    targetId: z.string(),
    recipientId: z.string(),
    occurrence: z.enum(["first", "return"]),
  }),
});

export const viewAlertEmailJob = defineJob(config);

type Described = {
  label: string;
  path: string;
  who: string;
  // the member who created the thing, notified besides the admins
  ownerMemberId: string | null;
};

type Data = z.infer<(typeof config)["schema"]>;

async function describe(d: Data): Promise<Described> {
  if (d.kind === "DATA_ROOM") {
    const [room, rec] = await Promise.all([
      db.dataRoom.findFirstOrThrow({
        where: { id: d.targetId, companyId: d.companyId },
        select: { name: true, publicId: true },
      }),
      db.dataRoomRecipient.findUniqueOrThrow({
        where: { id: d.recipientId },
        select: { name: true, email: true },
      }),
    ]);
    return {
      label: `the data room "${room.name}"`,
      path: `documents/data-rooms/${room.publicId}`,
      who: rec.name || rec.email,
      ownerMemberId: null,
    };
  }
  if (d.kind === "UPDATE") {
    const [update, rec] = await Promise.all([
      db.update.findFirstOrThrow({
        where: { id: d.targetId, companyId: d.companyId },
        select: { title: true, publicId: true, authorId: true },
      }),
      db.updateRecipient.findUniqueOrThrow({
        where: { id: d.recipientId },
        select: { name: true, email: true },
      }),
    ]);
    return {
      label: `the update "${update.title}"`,
      path: `updates/${update.publicId}`,
      who: rec.name || rec.email,
      ownerMemberId: update.authorId,
    };
  }
  const [template, rec] = await Promise.all([
    db.template.findFirstOrThrow({
      where: { id: d.targetId, companyId: d.companyId },
      select: { name: true, publicId: true, uploaderId: true },
    }),
    db.esignRecipient.findUniqueOrThrow({
      where: { id: d.recipientId },
      select: { name: true, email: true },
    }),
  ]);
  return {
    label: `the document "${template.name}"`,
    path: `documents/esign/v/${template.publicId}`,
    who: rec.name || rec.email,
    ownerMemberId: template.uploaderId,
  };
}

export const viewAlertEmailWorker = defineWorker(config, async (job) => {
  const d = job.data;
  const [company, target] = await Promise.all([
    db.company.findUniqueOrThrow({
      where: { id: d.companyId },
      select: { name: true, publicId: true },
    }),
    describe(d),
  ]);

  const members = await db.member.findMany({
    where: {
      companyId: d.companyId,
      status: "ACTIVE",
      notifyOnView: true,
      OR: [
        { role: "ADMIN" },
        ...(target.ownerMemberId ? [{ id: target.ownerMemberId }] : []),
      ],
    },
    select: { user: { select: { email: true } } },
  });

  const link = `${env.NEXT_PUBLIC_BASE_URL}/${company.publicId}/${target.path}`;
  const verb = d.occurrence === "first" ? "opened" : "came back to";
  const html = await render(
    ViewAlertEmail({
      companyName: company.name,
      who: target.who,
      label: target.label,
      occurrence: d.occurrence,
      link,
    }),
  );

  // one mail per person so addresses are never shown to each other
  await Promise.all(
    members
      .map((m) => m.user.email)
      .filter((email): email is string => Boolean(email))
      .map((to) =>
        sendMail({
          to,
          subject: `${target.who} ${verb} ${target.label}`,
          html,
        }),
      ),
  );
});
```

- [ ] **Step 6: Register the worker and add the template to the brand test**

`src/jobs/register.ts`: add `import { viewAlertEmailWorker } from "./view-alert-email";` and `queueManager.register(viewAlertEmailWorker);` after the `shareUpdateEmailWorker` line.

`src/emails/brand.test.ts`: add `import ViewAlertEmail from "./ViewAlertEmail";` and `ViewAlertEmail,` to the `templates` object.

- [ ] **Step 7: Run, verify PASS**

Run: `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx vitest run tests/tenant/view-alert-job.test.ts src/emails tests/tenant/view-beacon.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
npx biome check --apply src/jobs src/emails src/constants/job.ts tests/tenant/view-alert-job.test.ts
git add src/jobs/view-alert-email.ts src/jobs/register.ts src/constants/job.ts src/emails tests/tenant/view-alert-job.test.ts
git commit -m "feat(activity): email alerts for first and returning views"
```

---

### Task 5: Client beacon, viewer notice and page mounts

**Files:**
- Create: `src/components/share/view-beacon.tsx`
- Modify: `src/components/share/page-layout.tsx` (show the notice)
- Modify: `src/app/(documents)/data-rooms/[publicId]/page.tsx`, `src/app/(documents)/data-rooms/[publicId]/[bucketId]/page.tsx`, `src/app/updates/[publicId]/page.tsx`, `src/app/(documents)/esign/[token]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/activity/view` (Task 3).
- Produces: `ViewBeacon({ kind, token })` (renders nothing) and `ViewNotice()`.

- [ ] **Step 1: Write the component**

Create `src/components/share/view-beacon.tsx`:

```tsx
"use client";

import { useEffect } from "react";

type Kind = "DATA_ROOM" | "UPDATE" | "ESIGN";

const INTERACTIONS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

// Records one view after the page has really rendered: the first interaction,
// or two seconds with the tab visible. A bare GET (scanner, preview) never
// reaches this, so it cannot create a view.
export const ViewBeacon = ({ kind, token }: { kind: Kind; token: string }) => {
  useEffect(() => {
    let sent = false;

    const off = () => {
      clearTimeout(timer);
      for (const e of INTERACTIONS) window.removeEventListener(e, send);
    };

    const send = () => {
      if (sent) return;
      sent = true;
      off();
      fetch("/api/activity/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, token }),
        keepalive: true,
      }).catch(() => undefined);
    };

    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") send();
    }, 2000);

    for (const e of INTERACTIONS) {
      window.addEventListener(e, send, { once: true, passive: true });
    }

    return off;
  }, [kind, token]);

  return null;
};

export const ViewNotice = () => (
  <p className="text-xs text-muted-foreground">
    Views of this page are logged (time, device and a shortened IP address) and
    shown to the sender.
  </p>
);
```

- [ ] **Step 2: Show the notice in the shared layout**

In `src/components/share/page-layout.tsx` add `import { ViewNotice } from "./view-beacon";` and, inside the footer `<div className="my-10 text-center ...">`, add `<ViewNotice />` as the first child before the `<p>Powered by ...`.

Note: `view-beacon.tsx` is a client module and `page-layout.tsx` is a server component; importing a client component from a server one is fine.

- [ ] **Step 3: Mount the beacon on the four pages**

In each file add `import { ViewBeacon } from "@/components/share/view-beacon";` and render it once in the returned JSX:

- `src/app/(documents)/data-rooms/[publicId]/page.tsx`: first child of `<SharePageLayout>`: `<ViewBeacon kind="DATA_ROOM" token={token} />`
- `src/app/(documents)/data-rooms/[publicId]/[bucketId]/page.tsx`: same line, same place.
- `src/app/updates/[publicId]/page.tsx`: `<ViewBeacon kind="UPDATE" token={token} />` as the first child of the returned layout.
- `src/app/(documents)/esign/[token]/page.tsx`: `<ViewBeacon kind="ESIGN" token={token} />` as the first child of `<TemplateSigningFieldProvider>`, and `<ViewNotice />` (import it too) directly under `<SigningFields ... />` in the sidebar column.

`token` already exists in each page's scope and has already passed `decode()` or `getSigningFields`.

- [ ] **Step 4: Type check, lint**

Run: `npx tsc --noEmit && npx biome check src/components/share src/app/updates "src/app/(documents)"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
npx biome check --apply src/components/share
git add src/components/share "src/app/(documents)" src/app/updates
git commit -m "feat(activity): confirm views from the rendered page and tell viewers"
```

---

### Task 6: Per-member alert switch

**Files:**
- Create: `src/trpc/routers/member-router/procedures/view-alerts.ts`, `src/components/member/view-alerts-setting.tsx`
- Modify: `src/trpc/routers/member-router/router.ts`, `src/app/(authenticated)/(dashboard)/[publicId]/settings/profile/page.tsx`, `tests/tenant/architecture.test.ts` (allowlist, only if it names the file)
- Test: `tests/tenant/view-alerts-switch.test.ts`

**Interfaces:**
- Consumes: `withAuth` from `@/trpc/api/trpc`; `callerFor(tenant)` from `tests/helpers/seed.ts`.
- Produces: `member.viewAlerts` (query → `boolean`) and `member.setViewAlerts` (mutation `{ enabled: boolean }` → `boolean`).

- [ ] **Step 1: Write the failing test**

Create `tests/tenant/view-alerts-switch.test.ts`:

```ts
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, callerFor, cleanupTenants, seedTwoTenants } from "../helpers/seed";

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
});

afterAll(async () => {
  await cleanupTenants(a, b);
});

describe("member alert switch", () => {
  it("reads on by default and persists a change for the caller only", async () => {
    const asA = callerFor(a);
    expect(await asA.member.viewAlerts()).toBe(true);

    expect(await asA.member.setViewAlerts({ enabled: false })).toBe(false);
    expect(await asA.member.viewAlerts()).toBe(false);

    const bMember = await db.member.findUniqueOrThrow({ where: { id: b.memberId } });
    expect(bMember.notifyOnView).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx vitest run tests/tenant/view-alerts-switch.test.ts`
Expected: FAIL (`viewAlerts` is not a function).

- [ ] **Step 3: Write the procedures**

Create `src/trpc/routers/member-router/procedures/view-alerts.ts`:

```ts
import { withAuth } from "@/trpc/api/trpc";
import { z } from "zod";

// The caller's own preference, scoped by their member id and company, in the
// same shape as get-profile.
export const getViewAlertsProcedure = withAuth.query(
  async ({
    ctx: {
      db,
      session: { user },
    },
  }) => {
    const member = await db.member.findUniqueOrThrow({
      where: { id: user.memberId, companyId: user.companyId },
      select: { notifyOnView: true },
    });
    return member.notifyOnView;
  },
);

export const setViewAlertsProcedure = withAuth
  .input(z.object({ enabled: z.boolean() }))
  .mutation(
    async ({
      ctx: {
        db,
        session: { user },
      },
      input,
    }) => {
      await db.member.update({
        where: { id: user.memberId, companyId: user.companyId },
        data: { notifyOnView: input.enabled },
      });
      return input.enabled;
    },
  );
```

- [ ] **Step 4: Register them**

`src/trpc/routers/member-router/router.ts`: add
```ts
import {
  getViewAlertsProcedure,
  setViewAlertsProcedure,
} from "./procedures/view-alerts";
```
and in `createTRPCRouter({ ... })` add `viewAlerts: getViewAlertsProcedure,` and `setViewAlerts: setViewAlertsProcedure,`.

- [ ] **Step 5: Run the test and the architecture guard**

Run: `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx vitest run tests/tenant/view-alerts-switch.test.ts tests/tenant/architecture.test.ts`
Expected: PASS. If the architecture test fails naming `view-alerts.ts` (rule a, "uses the global db"), add this entry to `ALLOWLIST_TENANTLESS` in `tests/tenant/architecture.test.ts` and rerun:

```ts
  [`${R}member-router/procedures/view-alerts.ts`]:
    "user's own notification preference, scoped by memberId and companyId",
```

- [ ] **Step 6: Write the UI**

Create `src/components/member/view-alerts-setting.tsx`:

```tsx
"use client";

import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export const ViewAlertsSetting = () => {
  const utils = api.useContext();
  const { data } = api.member.viewAlerts.useQuery();
  const set = api.member.setViewAlerts.useMutation({
    onSuccess: () => utils.member.viewAlerts.invalidate(),
    onError: () => toast.error("Could not save your preference"),
  });

  return (
    <div className="mt-6 flex items-center justify-between rounded border p-4">
      <div>
        <p className="font-medium">Activity alerts</p>
        <p className="text-sm text-muted-foreground">
          Email me when a recipient opens or returns to a shared data room,
          update or document.
        </p>
      </div>
      <Switch
        checked={data ?? true}
        disabled={data === undefined || set.isLoading}
        onCheckedChange={(enabled) => set.mutate({ enabled })}
      />
    </div>
  );
};
```

- [ ] **Step 7: Mount it on the profile page**

`src/app/(authenticated)/(dashboard)/[publicId]/settings/profile/page.tsx`: add `import { ViewAlertsSetting } from "@/components/member/view-alerts-setting";` and change the return to:

```tsx
  return (
    <>
      <ProfileSettings memberProfile={memberProfile} />
      <ViewAlertsSetting />
    </>
  );
```

- [ ] **Step 8: Type check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
npx biome check --apply src/trpc/routers/member-router src/components/member/view-alerts-setting.tsx "src/app/(authenticated)/(dashboard)/[publicId]/settings/profile/page.tsx" tests/tenant
git add src/trpc/routers/member-router src/components/member/view-alerts-setting.tsx "src/app/(authenticated)/(dashboard)/[publicId]/settings/profile/page.tsx" tests/tenant/view-alerts-switch.test.ts tests/tenant/architecture.test.ts
git commit -m "feat(activity): per-member switch for view alerts"
```

---

### Task 7: Whole-branch verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite, types and lint**

Run:
```bash
export TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test
npx tsc --noEmit
npx biome check src tests prisma
npm test
```
Expected: all green except any failure that also fails on `origin/main` (note: `tests/tenant/roles.test.ts` flaked once during the branding work, on different tests per run; rerun it alone before treating a failure as real).

- [ ] **Step 2: Check the migration against the schema**

Run: `DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate status`
Expected: "Database schema is up to date" (no drift).

- [ ] **Step 3: Confirm a bare GET records nothing**

Run: `git grep -n "viewEvent.create\|recordView(" src/app` 
Expected: only `src/app/api/activity/view/route.ts`. No page or layout calls it.

- [ ] **Step 4: Report**

List files changed, test counts, and anything left open for the Opus branch review.

## Deploy gate (not part of this plan's execution)

Done by the orchestrator with the user's approval, in this order, using the production notes:

1. Merge the PR; wait for the image `ghcr.io/tin-wizard/captable:<full sha>` to publish.
2. Create a Neon backup branch, then `prisma migrate deploy` against the `production` branch (migration `20261013000000_view_events`; additive, no data change).
3. Pull the image, back up `.env` and `compose.yml`, update `image:`, `docker compose up -d --force-recreate app`.
4. Verify: share a throwaway data room to a test address, open the link, confirm one `ViewEvent` row, one alert email, and that a second open within 30 minutes sends nothing. Then delete the test data.

## Self-review

- **Spec coverage:** event log (Task 1, 2), human-verified view (Tasks 2, 5), capture points (Tasks 3, 5), e-sign viewed (Task 3 plus Task 1 audit enum), notifications v1 (Task 4), per-user switch (Task 6), viewer notice (Task 5). Deferred and flagged: location, retention job, per-event settings.
- **Placeholders:** none. The one conditional step (architecture allowlist, Task 6 Step 5) gives the exact entry.
- **Type consistency:** `recordView` returns `Visit`; the route emits `occurrence: "first" | "return"` only; the job schema accepts exactly those; `ViewKind` values match the route and component `Kind`.
- **Known limits:** `isAtypicalSource` is a user-agent list (commented); `recordView` is read-then-write, and the job's `singletonKey` absorbs a duplicate first alert (commented).
