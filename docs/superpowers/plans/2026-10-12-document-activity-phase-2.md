# Document Activity, Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show senders where and for how long each recipient looked at a shared data room, update or e-sign document (country, network, active time, time per PDF page), in an Activity view with cap-table context, and close the Phase 1 follow-ups.

**Architecture:** Phase 1's `ViewEvent` row becomes a *visit*. The beacon route stamps it with country/network (from the offline IPinfo Lite database, read in-process) and the browser timezone, and returns the visit id. The client then sends a periodic heartbeat with active seconds and per-page seconds to a second public, token-authenticated route that only ever raises the stored numbers. A tenant-scoped tRPC query joins visits to recipients, stakeholders and (if the caller may read securities) share counts; two UI surfaces render it.

**Tech Stack:** Next.js 16, Prisma (relationMode `prisma`), tRPC v10 + react-query v4, pg-boss 10, `maxmind` (new dependency, MMDB reader), react-pdf, vitest, Biome 1.7.3, Docker BuildKit secrets, GitHub Actions.

**Spec:** the approved "Deal Room Activity" recommendation plus the decisions recorded in the session on 2026-10-12 (location: IPinfo Lite country + network + browser timezone, no city; per-page time; Activity both per item and company-wide; holdings only for roles that can read securities; fold in the Phase 1 follow-ups; no role presets in this phase). Phase 1 plan: `docs/superpowers/plans/2026-10-12-document-activity-phase-1.md` (shipped, PR #26).

## Preconditions (owner actions, not tasks)

1. A free IPinfo account and its access token stored as the GitHub Actions secret **`IPINFO_TOKEN`** (repo Settings, Secrets and variables, Actions). The token never goes in code, the server env, or chat. **Tasks 1, 2 and 4 to 9 do not need it;** only Task 3's production check and the final location verification do. If the secret is absent the build still succeeds and location is simply empty.
2. The profile-fix image (PR #27) deployed, so Phase 2 starts from a known production baseline.

## Decisions made in this plan (flagged so you can overrule)

| Decision | Choice | Why |
|---|---|---|
| Location detail | Country, network name and ASN only. **No city.** | Free databases are unreliable at city level, and a wrong city in an investor view is worse than none |
| Network used to flag scanners | **Display only** in Phase 2 | A name list is easy to get wrong in both directions; the sender judges "Microsoft Corporation" themselves |
| Holdings next to a viewer | **Share count only** (sum of that stakeholder's `ACTIVE` shares), no ownership %, shown only if the caller's role has `securities:read` | A percentage needs a dilution definition the app does not have one place for |
| Per-page time | **PDF files in data rooms only.** E-sign pages, updates and non-PDF files get total active time only | Only `PdfViewer` renders one page per node; the others have no page concept to measure |
| Retention | **24 months**, fixed constant, daily purge job | Matches the default I proposed; per-company settings can come later |
| Own views | A signed-in **active member of the same company** is not recorded and not alerted | Stops an admin previewing a link from "viewing" as the recipient |
| Revoked updates | The beacon **404s** when the update is not public, mirroring the page | Closes the Phase 1 note |
| Stakeholder match for e-sign | By **email** within the company (`EsignRecipient` has no stakeholder link) | Smallest join that works |

## Global Constraints

- Do not change tokens, token encoding, verification links, auth flow, or any membership authorization logic. Public routes only READ tokens.
- A bare GET of a shared page records nothing; only the POST routes write.
- Never run prisma, tests, or migrations against the `.env` `DATABASE_URL` (it is production Neon). Use `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test` and pass `DATABASE_URL=$TEST_DATABASE_URL` to every prisma command.
- Prisma `relationMode = "prisma"`: no DB foreign keys; new FK-like columns need an `@@index`.
- The `IPINFO_TOKEN` is a BuildKit secret only: never an `ARG`/`ENV`, never printed, never in an image layer.
- Do not widen `TENANT_HOST_USER_PROCEDURES` / `TENANT_HOST_PUBLIC_PROCEDURES` in `src/trpc/api/trpc.ts`. Tenant-callable procedures use `withAccessControl`/`withTenant`.
- IPs stay truncated in `ViewEvent` (`truncateIp`); geo lookup uses the full address in memory only.
- Branch from `origin/main` in a fresh worktree (do not use `captable-subdomains`, which may hold another session's uncommitted work). `next-env.d.ts` is git-ignored: copy it from the main checkout if `tsc` reports missing image modules.
- Format with `npx biome check --apply <files>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No production migration, deploy or data change is part of task execution; see "Deploy gate".

## Review Focus

1. **Heartbeat confinement.** A visit id must be writable only with a token that resolves to that same recipient, target and company. A valid token for recipient A must not touch recipient B's visit, another kind's visit, or another company's. Pinned in Task 5.
2. **Heartbeat cannot forge unbounded engagement.** Values never decrease, are capped (24 h, 1 h per page, at most 500 pages), and cannot exceed wall-clock time since the visit began plus a small grace. Pinned in Task 5.
3. **Location can never break recording.** Missing database file, unreadable file, invalid or private IPs all yield "no location" and the view is still recorded. Pinned in Task 2 and Task 4.
4. **Own views and revoked updates.** A signed-in active member of the same company produces no event and no alert; a viewer who has a session only in a *different* company is still recorded; a non-public update returns 404 and writes nothing. Pinned in Task 4.
5. **Cap-table data does not leak.** Share counts appear only for callers whose role has `securities:read`, never across tenants, and never for a stakeholder from another company even if an email matches. Pinned in Task 7.
6. **Retention deletes only what it should.** Rows older than 24 months go; newer rows and every other table are untouched. Pinned in Task 9.

## Model routing

Policy: Opus orchestrates, Sonnet builds, Haiku only runs mechanical steps. Tenant isolation, public token endpoints, authorization and secret handling start at Opus (security rule 3). Sonnet output on security-adjacent work is reviewed by Opus.

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Schema, migration, tenant registry | `opus` | `general-purpose` | Tenant isolation registry (rule 3) |
| 2. Geo lookup module | `sonnet` | `general-purpose` | Small module with a fake-reader test; failure mode reviewed in the branch review |
| 3. Docker and CI: IPinfo database via build secret | `opus` | `general-purpose` | Secret handling and supply chain (rule 3) |
| 4. Beacon: geo, timezone, visit id, own views, revoked update | `opus` | `general-purpose` | Public unauthenticated write path (rule 3) |
| 5. Heartbeat route | `opus` | `general-purpose` | Public unauthenticated write path (rule 3) |
| 6. Client dwell tracking | `sonnet` | `general-purpose` | Client logic with a pure tested core |
| 7. Activity query (tRPC) | `opus` | `general-purpose` | Authorization plus cross-table tenant joins (rule 3) |
| 8. Activity UI | `sonnet` | `general-purpose` | UI over a typed API |
| 9. Follow-ups: data room creator, retention job | `sonnet` | `general-purpose` | Follows existing job patterns; Opus reviews the global-db delete |
| 10. Verification run | `haiku` | `general-purpose` | Mechanical |
| Per-task spec review | `sonnet` (`opus` for 1, 3, 4, 5, 7, 9) | `general-purpose` | Per matrix |
| Final whole-branch review | `opus` | `general-purpose` | Cross-cutting, security-adjacent |
| Deploy and production verification | Orchestrator | n/a | Touches production; needs your approval |

Before dispatching each task after the first, the orchestrator writes a short Previous Phase Context Review from the real diff and test results.

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261014000000_activity_phase_2/migration.sql` | New `ViewEvent` columns, `DataRoom.createdById`, one index |
| `src/server/geo.ts` | `lookupGeo(ip)`, reads the IPinfo Lite MMDB; returns `{}` on any problem |
| `docker/Dockerfile`, `.github/workflows/image.yml` | Fetch the database at image build with a BuildKit secret; tolerant when absent |
| `src/server/activity/resolve-recipient.ts` | `resolveRecipient(kind, token)` shared by both public routes (moved out of the route file) |
| `src/server/view-events.ts` | `recordView` returns `{ visit, id }` and stores geo/timezone |
| `src/app/api/activity/view/route.ts` | Beacon: geo, timezone, own-view skip, revoked-update 404, returns `{ visitId }` |
| `src/app/api/activity/visit/route.ts` | Heartbeat: raises `activeSeconds` / `pageSeconds` |
| `src/components/share/dwell.ts`, `view-beacon.tsx`, `src/components/ui/pdf-viewer.tsx` | Active-time and per-page accumulation, flush, visible-page publishing |
| `src/trpc/routers/activity-router/*`, `src/trpc/api/root.ts` | `activity.list` |
| `src/components/activity/*`, `[publicId]/activity/page.tsx`, sidebar, three detail pages | Activity UI |
| `src/jobs/purge-view-events.ts`, `src/jobs/register.ts`, `src/constants/job.ts`, `src/jobs/view-alert-email.ts`, data room create | Retention and the data room creator |

---

### Task 1: Schema, migration and tenant registry

**Files:**
- Modify: `prisma/schema.prisma` (`ViewEvent`, `DataRoom`)
- Create: `prisma/migrations/20261014000000_activity_phase_2/migration.sql`
- Test: `tests/tenant/view-events.test.ts` (append)

**Interfaces:**
- Produces: `ViewEvent.country?`, `.asn?`, `.network?`, `.timezone?` (String), `.activeSeconds Int @default(0)`, `.pageSeconds Json?`; `DataRoom.createdById String?`.

- [ ] **Step 1: Write the failing tests** (append to `tests/tenant/view-events.test.ts`)

```ts
describe("phase 2 columns", () => {
  it("a new visit has no location and zero active time", async () => {
    const row = await db.viewEvent.create({
      data: { companyId: a.companyId, kind: "ESIGN", targetId: "t", recipientId: "r2", ip: "1.2.3.0", userAgent: "ua" },
    });
    expect(row.country).toBeNull();
    expect(row.timezone).toBeNull();
    expect(row.activeSeconds).toBe(0);
    expect(row.pageSeconds).toBeNull();
  });

  it("stores page seconds as json", async () => {
    const row = await db.viewEvent.create({
      data: {
        companyId: a.companyId, kind: "DATA_ROOM", targetId: "t", recipientId: "r3",
        ip: "1.2.3.0", userAgent: "ua", country: "CA", network: "Example Net", asn: "AS64500",
        timezone: "America/Toronto", activeSeconds: 42, pageSeconds: { "1": 12, "2": 30 },
      },
    });
    expect(row.pageSeconds).toEqual({ "1": 12, "2": 30 });
    expect(row.country).toBe("CA");
  });

  it("a data room records no creator by default", async () => {
    const room = await db.dataRoom.create({
      data: { name: `r-${Date.now()}`, publicId: `p${Date.now()}`, companyId: a.companyId },
    });
    expect(room.createdById).toBeNull();
    await db.dataRoom.delete({ where: { id: room.id } });
  });
});
```

- [ ] **Step 2: Run, verify it fails** with `TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test npx vitest run tests/tenant/view-events.test.ts` (Prisma type errors / unknown fields).

- [ ] **Step 3: Edit the schema.** In `model ViewEvent` add before `companyId`:

```prisma
  // from the IPinfo Lite database (in memory, full IP) and the browser; all optional
  country       String? // ISO 3166-1 alpha-2
  asn           String? // e.g. "AS8075"
  network       String? // organisation behind the ASN
  timezone      String? // IANA name reported by the browser
  activeSeconds Int     @default(0)
  // { "1": 12, "2": 40 } seconds per PDF page; only ever raised by the heartbeat
  pageSeconds   Json?
```

and add `@@index([companyId, createdAt])`. In `model DataRoom` add:

```prisma
  // Member.id of the creator; null for rooms created before this column existed
  createdById String?
```

- [ ] **Step 4: Write the migration** `prisma/migrations/20261014000000_activity_phase_2/migration.sql` (generate with `DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate dev --create-only --name activity_phase_2` and make it match exactly):

```sql
-- AlterTable
ALTER TABLE "ViewEvent" ADD COLUMN     "country" TEXT,
ADD COLUMN     "asn" TEXT,
ADD COLUMN     "network" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "activeSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pageSeconds" JSONB;

-- AlterTable
ALTER TABLE "DataRoom" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "ViewEvent_companyId_createdAt_idx" ON "ViewEvent"("companyId", "createdAt");
```

- [ ] **Step 5: Apply locally, regenerate, run.**

```bash
export TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy && npx prisma generate
npx vitest run tests/tenant/view-events.test.ts tests/tenant/architecture.test.ts tests/tenant/tenant-db.test.ts
```
Expected: PASS. `ViewEvent` is already in `TENANT_MODELS`; no registry change.

- [ ] **Step 6: Commit** `feat(activity): visit location, time and creator columns`.

---

### Task 2: Geo lookup module

**Files:**
- Create: `src/server/geo.ts`, `src/server/geo.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (`pnpm add maxmind`)

**Interfaces:**
- Produces: `type Geo = { country?: string; asn?: string; network?: string }`; `toGeo(rec: IpinfoLite | null): Geo`; `lookupGeo(ip: string): Promise<Geo>` (never throws, `{}` when unavailable).

- [ ] **Step 1: Failing test** `src/server/geo.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { toGeo } from "./geo";

describe("toGeo", () => {
  it("maps an IPinfo Lite record", () => {
    expect(
      toGeo({ country_code: "CA", asn: "AS64500", as_name: "Example Net Inc" }),
    ).toEqual({ country: "CA", asn: "AS64500", network: "Example Net Inc" });
  });

  it("drops empty values and handles a missing record", () => {
    expect(toGeo({ country_code: "", asn: "AS1" })).toEqual({ asn: "AS1" });
    expect(toGeo(null)).toEqual({});
  });
});

describe("lookupGeo", () => {
  it("returns {} when the database file does not exist", async () => {
    vi.resetModules();
    vi.stubEnv("IPINFO_DB_PATH", "/nonexistent/ipinfo_lite.mmdb");
    const { lookupGeo } = await import("./geo");
    expect(await lookupGeo("203.0.113.9")).toEqual({});
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (`./geo` not found): `TEST_DATABASE_URL=... npx vitest run src/server/geo.test.ts`.

- [ ] **Step 3: Install and implement.** `pnpm add maxmind`, then create `src/server/geo.ts`:

```ts
import { existsSync } from "node:fs";
import { type Reader, open } from "maxmind";

export type Geo = { country?: string; asn?: string; network?: string };

// IPinfo Lite MMDB record (country and ASN only)
export type IpinfoLite = {
  country_code?: string;
  asn?: string;
  as_name?: string;
};

// The Docker build puts the database here when IPINFO_TOKEN was available.
const DB_PATH = process.env.IPINFO_DB_PATH ?? "/app/data/ipinfo_lite.mmdb";

let reader: Promise<Reader<IpinfoLite> | null> | undefined;
const load = () => {
  reader ??= existsSync(DB_PATH)
    ? open<IpinfoLite>(DB_PATH).catch(() => null)
    : Promise.resolve(null);
  return reader;
};

export function toGeo(rec: IpinfoLite | null): Geo {
  const geo: Geo = {};
  if (rec?.country_code) geo.country = rec.country_code;
  if (rec?.asn) geo.asn = rec.asn;
  if (rec?.as_name) geo.network = rec.as_name;
  return geo;
}

// Never throws: a missing or unreadable database, or a private/invalid address,
// means "no location", never a failed view.
export async function lookupGeo(ip: string): Promise<Geo> {
  try {
    const r = await load();
    return r ? toGeo(r.get(ip)) : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run, verify PASS**, then `npx tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(activity): offline IP geolocation lookup` (include `package.json` and `pnpm-lock.yaml`).

Note for the reviewer: the IPinfo field names above (`country_code`, `asn`, `as_name`) must be confirmed against the real downloaded file during the production verification (Deploy gate step 5); `toGeo` is the only place to change.

---

### Task 3: Docker and CI: fetch the IPinfo database with a build secret

**Files:**
- Modify: `docker/Dockerfile`, `.github/workflows/image.yml`

- [ ] **Step 1: Add a `geo` stage and copy it into the runner.** In `docker/Dockerfile`, after the `deps` stage add:

```dockerfile
FROM base AS geo
RUN apk add --no-cache curl && mkdir -p /geo
# IPINFO_TOKEN is a BuildKit secret (never an ARG/ENV, so it cannot reach a layer).
# Missing token, failed download or a suspiciously small file all end the same
# way: no database, and the app simply records no location.
RUN --mount=type=secret,id=ipinfo_token \
    if [ -s /run/secrets/ipinfo_token ]; then \
      curl -fsSL -o /geo/ipinfo_lite.mmdb \
        "https://ipinfo.io/data/ipinfo_lite.mmdb?token=$(cat /run/secrets/ipinfo_token)" \
      && [ "$(wc -c < /geo/ipinfo_lite.mmdb)" -gt 1000000 ] \
      || { echo "ipinfo database not available; continuing without location"; rm -f /geo/ipinfo_lite.mmdb; }; \
    else echo "no ipinfo token; continuing without location"; fi
```

and in the `runner` stage, after the `COPY ... .next/static` line:

```dockerfile
COPY --from=geo --chown=nextjs:nodejs /geo /app/data
```

- [ ] **Step 2: Pass the secret in CI.** In `.github/workflows/image.yml`, under the `docker/build-push-action@v5` `with:` block add:

```yaml
          secrets: |
            ipinfo_token=${{ secrets.IPINFO_TOKEN }}
```

- [ ] **Step 3: Verify the tolerant paths locally** (skip with a note if Docker is not installed; the first post-merge image run then is the check):

```bash
docker build --target geo -f docker/Dockerfile -t geo-test . && docker run --rm geo-test ls -la /geo
echo "bogus" > /tmp/tok && docker build --secret id=ipinfo_token,src=/tmp/tok --target geo -f docker/Dockerfile -t geo-test2 . && docker run --rm geo-test2 ls -la /geo
```
Expected: both builds succeed (exit 0) and `/geo` is empty (no token; then 401 from a bogus token). A real database appears only in the CI build with the real secret.

- [ ] **Step 4: Confirm no secret exposure:** `grep -n "ipinfo" docker/Dockerfile .github/workflows/image.yml` shows the token only as the `id=ipinfo_token` secret mount and the workflow `secrets:` entry, never as `ARG`, `ENV` or `echo`.

- [ ] **Step 5: Commit** `build: fetch the IPinfo Lite database at image build with a secret`.

---

### Task 4: Beacon extension: location, timezone, visit id, own views, revoked updates

**Files:**
- Create: `src/server/activity/resolve-recipient.ts`
- Modify: `src/server/view-events.ts`, `src/app/api/activity/view/route.ts`
- Test: `src/server/view-events.test.ts`, `tests/tenant/view-events.test.ts`, `tests/tenant/view-beacon.test.ts`

**Interfaces:**
- Consumes: `lookupGeo` (Task 2); `getServerAuthSession` from `@/server/auth` (returns `Session | null`).
- Produces: `resolveRecipient(kind, token): Promise<Found | null>` exported from `src/server/activity/resolve-recipient.ts`; `recordView(db, v): Promise<{ visit: Visit; id: string }>` where `v` may carry `country?`, `asn?`, `network?`, `timezone?`; route response `200 { visitId: string | null }`.

- [ ] **Step 1: Move `resolveRecipient` into `src/server/activity/resolve-recipient.ts`** (cut it, and the `Found` type, from the route; export both; Next route modules may export only handlers). In its UPDATE branch, require the update to be public exactly like the page does:

```ts
    const update = await db.update.findFirst({
      where: { publicId: p.publicId, companyId: p.companyId },
      select: { id: true, status: true, public: true },
    });
    // a revoked or draft update is not viewable, so it records nothing
    if (!update || update.status !== "PUBLIC" || !update.public) return null;
```

- [ ] **Step 2: Failing tests.** In `tests/tenant/view-beacon.test.ts` add (using the file's existing fixtures `a`, `b`, `aIds`, `roomToken`, `call`, `eventsFor`, `emit`):

```ts
  it("returns a visit id and stores location and timezone", async () => {
    const rec = await db.dataRoomRecipient.create({
      data: { email: "geo@example.com", dataRoomId: aIds.dataRoomId },
    });
    const token = await roomToken({ recipientId: rec.id });
    const res = await call({ kind: "DATA_ROOM", token, timezone: "America/Toronto" });
    expect(res.status).toBe(200);
    const { visitId } = await res.json();
    const row = await db.viewEvent.findUniqueOrThrow({ where: { id: visitId } });
    expect(row.timezone).toBe("America/Toronto");
  });

  it("records nothing for a signed-in active member of the same company", async () => {
    getSession.mockResolvedValueOnce({ user: { id: a.userId } });
    const rec = await db.dataRoomRecipient.create({
      data: { email: "self@example.com", dataRoomId: aIds.dataRoomId },
    });
    const res = await call({ kind: "DATA_ROOM", token: await roomToken({ recipientId: rec.id }) });
    expect((await res.json()).visitId).toBeNull();
    expect(await eventsFor(rec.id)).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("still records a viewer who has a session only in another company", async () => {
    getSession.mockResolvedValueOnce({ user: { id: b.userId } });
    const rec = await db.dataRoomRecipient.create({
      data: { email: "other@example.com", dataRoomId: aIds.dataRoomId },
    });
    const res = await call({ kind: "DATA_ROOM", token: await roomToken({ recipientId: rec.id }) });
    expect((await res.json()).visitId).not.toBeNull();
  });

  it("rejects an update that is not public", async () => {
    await db.update.update({ where: { id: aIds.updateId }, data: { public: false } });
    const token = await encode({ publicId: updatePublicId, companyId: a.companyId, recipientId: updateRecipientId });
    const before = (await eventsFor(updateRecipientId)).length;
    expect((await call({ kind: "UPDATE", token })).status).toBe(404);
    expect(await eventsFor(updateRecipientId)).toHaveLength(before);
    await db.update.update({ where: { id: aIds.updateId }, data: { public: true, status: "PUBLIC" } });
  });
```

and at the top of the file, next to the `emit` mock, add `const getSession = vi.hoisted(() => vi.fn().mockResolvedValue(null)); vi.mock("@/server/auth", async (orig) => ({ ...(await orig<typeof import("@/server/auth")>()), getServerAuthSession: getSession }));`. Update the existing Phase 1 assertions that expect `204` to `200`, and in `src/server/view-events.test.ts` / `tests/tenant/view-events.test.ts` change every `await recordView(...)` expectation to read `(...).visit` and add:

```ts
  it("returns the id of the row it stored, or of the row that throttled it", async () => {
    const v = view();
    const first = await recordView(db, v);
    const again = await recordView(db, v);
    expect(first.visit).toBe("first");
    expect(again).toEqual({ visit: "repeat", id: first.id });
  });
```

- [ ] **Step 3: Run, verify the new tests FAIL.**

- [ ] **Step 4: Change `recordView`** in `src/server/view-events.ts`:

```ts
type NewView = {
  companyId: string;
  kind: ViewKind;
  targetId: string;
  recipientId: string;
  ip: string;
  userAgent: string;
  country?: string;
  asn?: string;
  network?: string;
  timezone?: string;
};

export type Recorded = { visit: Visit; id: string };

export async function recordView(db: TPrismaOrTransaction, v: NewView): Promise<Recorded> {
  const isBot = isAtypicalSource(v.userAgent);
  const last = await db.viewEvent.findFirst({
    where: { kind: v.kind, targetId: v.targetId, recipientId: v.recipientId, isBot },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  const age = last ? Date.now() - last.createdAt.getTime() : Number.POSITIVE_INFINITY;

  if (last && age < MIN_GAP_MS) {
    return { visit: isBot ? "bot" : "repeat", id: last.id };
  }

  const row = await db.viewEvent.create({
    data: { ...v, ip: truncateIp(v.ip), isBot },
    select: { id: true },
  });

  if (isBot) return { visit: "bot", id: row.id };
  if (!last) return { visit: "first", id: row.id };
  return { visit: age > RETURN_AFTER_MS ? "return" : "repeat", id: row.id };
}
```

- [ ] **Step 5: Change the route** `src/app/api/activity/view/route.ts`: import `resolveRecipient` from the new module; extend `bodySchema` with `timezone: z.string().max(64).optional()`; after `found` is resolved and before recording, add the own-view skip; compute geo from the full IP; return JSON:

```ts
  const session = await getServerAuthSession();
  if (session?.user.id) {
    const isOwnMember = await db.member.findFirst({
      where: { userId: session.user.id, companyId: found.companyId, status: "ACTIVE" },
      select: { id: true },
    });
    if (isOwnMember) return Response.json({ visitId: null });
  }

  const geo = await lookupGeo(ip);
  const { visit, id } = await recordView(db, {
    companyId: found.companyId, kind, targetId: found.targetId, recipientId: found.recipientId,
    ip, userAgent, timezone: body.data.timezone, ...geo,
  });
```

and replace every `visit` comparison with the destructured `visit`, ending with `return Response.json({ visitId: visit === "bot" ? null : id });`.

- [ ] **Step 6: Run** `npx vitest run tests/tenant/view-beacon.test.ts tests/tenant/view-events.test.ts src/server/view-events.test.ts` then `npx tsc --noEmit`. Expected PASS.

- [ ] **Step 7: Commit** `feat(activity): stamp visits with location and timezone, skip own views, honour revoked updates`.

---

### Task 5: Heartbeat route

**Files:**
- Create: `src/app/api/activity/visit/route.ts`
- Test: `tests/tenant/view-heartbeat.test.ts`

**Interfaces:**
- Consumes: `resolveRecipient` (Task 4).
- Produces: `POST /api/activity/visit` body `{ kind, token, visitId, activeSeconds, pageSeconds }`; `204` stored, `400` bad body, `404` token invalid or visit not that recipient's.

- [ ] **Step 1: Failing tests** `tests/tenant/view-heartbeat.test.ts`

```ts
import { encode } from "@/lib/jwt";
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";
import { type AIds, type BIds, cleanupFixtures, seedTenantA, seedTenantB } from "../helpers/tenant-fixtures";
import { POST } from "@/app/api/activity/visit/route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/activity/visit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

let a: Tenant, b: Tenant, aIds: AIds, bIds: BIds;
let recA: string, recB: string, visitA: string;

const tokenFor = (recipientId: string, companyId = a.companyId) =>
  encode({ companyId, dataRoomId: aIds.dataRoomId, recipientId });

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  recA = (await db.dataRoomRecipient.create({ data: { email: "a@example.com", dataRoomId: aIds.dataRoomId } })).id;
  recB = (await db.dataRoomRecipient.create({ data: { email: "b@example.com", dataRoomId: aIds.dataRoomId } })).id;
  visitA = (await db.viewEvent.create({
    data: { companyId: a.companyId, kind: "DATA_ROOM", targetId: aIds.dataRoomId, recipientId: recA, ip: "1.2.3.0", userAgent: "ua" },
  })).id;
});
afterAll(async () => { await cleanupFixtures(aIds, bIds, [a, b]); });

const stored = () => db.viewEvent.findUniqueOrThrow({ where: { id: visitA } });

describe("POST /api/activity/visit", () => {
  it("stores active and per-page seconds and never lowers them", async () => {
    const token = await tokenFor(recA);
    expect((await post({ kind: "DATA_ROOM", token, visitId: visitA, activeSeconds: 20, pageSeconds: { "1": 12, "2": 8 } })).status).toBe(204);
    expect((await stored()).activeSeconds).toBe(20);
    await post({ kind: "DATA_ROOM", token, visitId: visitA, activeSeconds: 5, pageSeconds: { "1": 3, "3": 4 } });
    const row = await stored();
    expect(row.activeSeconds).toBe(20);
    expect(row.pageSeconds).toEqual({ "1": 12, "2": 8, "3": 4 });
  });

  it("cannot write another recipient's visit", async () => {
    const token = await tokenFor(recB);
    expect((await post({ kind: "DATA_ROOM", token, visitId: visitA, activeSeconds: 9999, pageSeconds: {} })).status).toBe(404);
    expect((await stored()).activeSeconds).toBe(20);
  });

  it("cannot write with another company's token or another kind", async () => {
    expect((await post({ kind: "DATA_ROOM", token: await tokenFor(recA, b.companyId), visitId: visitA, activeSeconds: 99, pageSeconds: {} })).status).toBe(404);
    expect((await post({ kind: "ESIGN", token: await tokenFor(recA), visitId: visitA, activeSeconds: 99, pageSeconds: {} })).status).toBe(404);
  });

  it("clamps to the time the visit could have lasted", async () => {
    const token = await tokenFor(recA);
    await post({ kind: "DATA_ROOM", token, visitId: visitA, activeSeconds: 86_000, pageSeconds: { "1": 3_600 } });
    // the visit began seconds ago: grace of 60s over wall-clock, never 86000
    expect((await stored()).activeSeconds).toBeLessThanOrEqual(120);
  });

  it("rejects malformed bodies without a 500", async () => {
    const token = await tokenFor(recA);
    expect((await post({ kind: "DATA_ROOM", token, visitId: visitA, activeSeconds: -1, pageSeconds: {} })).status).toBe(400);
    expect((await post({ kind: "DATA_ROOM", token, visitId: visitA, activeSeconds: 1, pageSeconds: { x: 1 } })).status).toBe(400);
    expect((await post("nope")).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (route missing).

- [ ] **Step 3: Implement** `src/app/api/activity/visit/route.ts`:

```ts
import { db } from "@/server/db";
import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { z } from "zod";

const MAX_ACTIVE = 24 * 3600;
const MAX_PAGE = 3600;
const GRACE_SECONDS = 60;

const bodySchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]),
  token: z.string().min(1).max(4096),
  visitId: z.string().min(1).max(64),
  activeSeconds: z.number().int().min(0).max(MAX_ACTIVE),
  pageSeconds: z
    .record(z.string().regex(/^[1-9]\d{0,3}$/), z.number().int().min(0).max(MAX_PAGE))
    .refine((r) => Object.keys(r).length <= 500),
});

export const POST = async (req: Request) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const { kind, token, visitId, activeSeconds, pageSeconds } = body.data;

  const found = await resolveRecipient(kind, token);
  if (!found) return new Response(null, { status: 404 });

  // the visit must be this recipient's, on this target, in this company
  const row = await db.viewEvent.findFirst({
    where: {
      id: visitId, kind, targetId: found.targetId,
      recipientId: found.recipientId, companyId: found.companyId,
    },
    select: { id: true, createdAt: true, activeSeconds: true, pageSeconds: true },
  });
  if (!row) return new Response(null, { status: 404 });

  // nothing can have lasted longer than the visit has existed (plus a grace)
  const ceiling = Math.floor((Date.now() - row.createdAt.getTime()) / 1000) + GRACE_SECONDS;
  const stored = (row.pageSeconds ?? {}) as Record<string, number>;
  const merged: Record<string, number> = { ...stored };
  for (const [page, secs] of Object.entries(pageSeconds)) {
    merged[page] = Math.max(stored[page] ?? 0, Math.min(secs, ceiling));
  }

  await db.viewEvent.update({
    where: { id: row.id },
    data: {
      activeSeconds: Math.max(row.activeSeconds, Math.min(activeSeconds, ceiling)),
      pageSeconds: merged,
    },
  });
  return new Response(null, { status: 204 });
};
```

- [ ] **Step 4: Run, verify PASS;** `npx tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(activity): token-authenticated visit heartbeat`.

---

### Task 6: Client dwell tracking

**Files:**
- Create: `src/components/share/dwell.ts`, `src/components/share/dwell.test.ts`
- Modify: `src/components/share/view-beacon.tsx`, `src/components/ui/pdf-viewer.tsx`

**Interfaces:**
- Produces: `createDwell(): { tick(pages: number[]): void; snapshot(): { activeSeconds: number; pageSeconds: Record<string, number> } }`; `setVisiblePages(pages: Iterable<number>): void`; `getVisiblePages(): number[]`.

- [ ] **Step 1: Failing test** `src/components/share/dwell.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createDwell, getVisiblePages, setVisiblePages } from "./dwell";

describe("createDwell", () => {
  it("counts a second of active time and a second on each visible page", () => {
    const d = createDwell();
    d.tick([1, 2]);
    d.tick([2]);
    expect(d.snapshot()).toEqual({ activeSeconds: 2, pageSeconds: { "1": 1, "2": 2 } });
  });

  it("starts empty and snapshots are copies", () => {
    const d = createDwell();
    const s = d.snapshot();
    d.tick([1]);
    expect(s).toEqual({ activeSeconds: 0, pageSeconds: {} });
  });
});

describe("visible pages store", () => {
  it("publishes the set of pages currently on screen", () => {
    setVisiblePages([3, 4]);
    expect(getVisiblePages().sort()).toEqual([3, 4]);
    setVisiblePages([]);
    expect(getVisiblePages()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `TEST_DATABASE_URL=... npx vitest run src/components/share/dwell.test.ts`

- [ ] **Step 3: Implement** `src/components/share/dwell.ts`:

```ts
export type Dwell = { activeSeconds: number; pageSeconds: Record<string, number> };

export function createDwell() {
  let active = 0;
  const pages: Record<string, number> = {};
  return {
    // called once per second while the tab is visible and the viewer was recently active
    tick(visiblePages: number[]) {
      active += 1;
      for (const p of visiblePages) pages[String(p)] = (pages[String(p)] ?? 0) + 1;
    },
    snapshot: (): Dwell => ({ activeSeconds: active, pageSeconds: { ...pages } }),
  };
}

// PdfViewer publishes which pages are on screen; the beacon reads it each second.
let visible = new Set<number>();
export const setVisiblePages = (pages: Iterable<number>) => {
  visible = new Set(pages);
};
export const getVisiblePages = () => [...visible];
```

- [ ] **Step 4: Extend the beacon** `src/components/share/view-beacon.tsx`. Keep the Phase 1 behaviour (single send after first interaction or 2 s visible, listeners cleaned up). Change the send to also include `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone`, read the JSON response, and when `visitId` is a string start tracking:

```ts
const ACTIVE_WINDOW_MS = 30_000;
const FLUSH_EVERY_S = 15;

// inside the effect, after a successful send with a visitId:
const dwell = createDwell();
let lastActivity = Date.now();
const touch = () => { lastActivity = Date.now(); };
const events = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"] as const;
for (const e of events) window.addEventListener(e, touch, { passive: true });

const flush = () => {
  const { activeSeconds, pageSeconds } = dwell.snapshot();
  if (activeSeconds === 0) return;
  fetch("/api/activity/visit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, token, visitId, activeSeconds, pageSeconds }),
    keepalive: true,
  }).catch(() => undefined);
};

let secs = 0;
const timer = setInterval(() => {
  if (document.visibilityState === "visible" && Date.now() - lastActivity < ACTIVE_WINDOW_MS) {
    dwell.tick(getVisiblePages());
  }
  if (++secs % FLUSH_EVERY_S === 0) flush();
}, 1000);

const onHide = () => { if (document.visibilityState === "hidden") flush(); };
document.addEventListener("visibilitychange", onHide);
window.addEventListener("pagehide", flush);
// the effect cleanup clears the interval, removes every listener above and calls flush()
```

Imports: `createDwell`, `getVisiblePages` from `./dwell`. Update `ViewNotice` text to: "Views of this page are logged (time, device, approximate location and a shortened IP address) and shown to the sender. Location data by IPinfo.io." with "IPinfo.io" as a link to `https://ipinfo.io` (`target="_blank" rel="noopener noreferrer"`).

- [ ] **Step 5: Publish visible pages from `PdfViewer`** (`src/components/ui/pdf-viewer.tsx`, the `PdfViewer` component only): wrap each `<Page>` in `<div data-page={index + 1} key=...>`; add:

```tsx
useEffect(() => {
  if (!containerRef || !numPages) return;
  const seen = new Set<number>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const n = Number((e.target as HTMLElement).dataset.page);
        if (e.isIntersecting) seen.add(n); else seen.delete(n);
      }
      setVisiblePages(seen);
    },
    { threshold: 0.5 },
  );
  for (const el of containerRef.querySelectorAll("[data-page]")) io.observe(el);
  return () => { io.disconnect(); setVisiblePages([]); };
}, [containerRef, numPages]);
```
(import `useEffect` and `setVisiblePages`).

- [ ] **Step 6: Verify:** `npx vitest run src/components/share/dwell.test.ts && npx tsc --noEmit && npx biome check src/components/share src/components/ui/pdf-viewer.tsx`. There is no component test harness; the manual check is in the Deploy gate.

- [ ] **Step 7: Commit** `feat(activity): measure active time and time per PDF page`.

---

### Task 7: Activity query

**Files:**
- Create: `src/trpc/routers/activity-router/router.ts`, `schema.ts`, `procedures/list.ts`
- Modify: `src/trpc/api/root.ts` (register `activity`)
- Test: `tests/tenant/activity-list.test.ts`

**Interfaces:**
- Produces: `activity.list({ kind?, targetPublicId?, cursor?, limit? })` returning `{ items: ActivityItem[]; nextCursor: string | null; canSeeHoldings: boolean }` where `ActivityItem = { id; kind; targetName; viewer: { label; email; stakeholder: { id; name; shares: number | null } | null }; country: string | null; network: string | null; timezone: string | null; createdAt: Date; activeSeconds: number; pageSeconds: Record<string, number>; isBot: boolean }`.

- [ ] **Step 1: Schema** `schema.ts`:

```ts
import { z } from "zod";

export const ZodActivityListSchema = z.object({
  kind: z.enum(["DATA_ROOM", "UPDATE", "ESIGN"]).optional(),
  targetPublicId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(25),
});
```

- [ ] **Step 2: Failing tests** `tests/tenant/activity-list.test.ts`, using the fixtures and caller helpers of `tests/tenant/roles.test.ts` and `tests/helpers/seed.ts`. Cases (each with a real assertion):
  1. an admin of tenant A lists A's events (a data room visit with a recipient that has `stakeholderId`) and sees the viewer label, `country`, `activeSeconds`;
  2. tenant B's events never appear for A (create one for B and assert absent);
  3. a member whose custom role has `audits:read` but not `securities:read` gets `canSeeHoldings: false` and `stakeholder.shares: null`; an admin gets `canSeeHoldings: true` and `shares` equal to the sum of that stakeholder's `ACTIVE` shares only (create one `ACTIVE` and one `DRAFT` share, assert only the ACTIVE quantity counts);
  4. a stakeholder in tenant B with the same email as an e-sign recipient in A is never attached to A's items;
  5. `limit: 2` over 3 events returns 2 items and a `nextCursor`, and the cursor returns the third;
  6. the existing "every policy is enforced" guard in `tests/tenant/roles.test.ts` (no-role caller gets UNAUTHORIZED) passes for `activity.list`.

- [ ] **Step 3: Run, verify FAIL.**

- [ ] **Step 4: Implement** `procedures/list.ts` with `withAccessControl.meta({ policies: { audits: { allow: ["read"] } } })`:

```ts
import { withAccessControl } from "@/trpc/api/trpc";
import type { ViewKind } from "@prisma/client";
import { ZodActivityListSchema } from "../schema";

const canRead = (perms: { subject: string; actions: string[] }[], subject: string) =>
  perms.some((p) => p.subject === subject && (p.actions.includes("read") || p.actions.includes("*")));

export const listActivityProcedure = withAccessControl
  .meta({ policies: { audits: { allow: ["read"] } } })
  .input(ZodActivityListSchema)
  .query(async ({ ctx, input }) => {
    const { db } = ctx.tenant;
    const canSeeHoldings = canRead(ctx.permissions, "securities");

    // resolve an optional target filter inside the tenant
    let targetId: string | undefined;
    if (input.kind && input.targetPublicId) {
      const found =
        input.kind === "DATA_ROOM"
          ? await db.dataRoom.findFirst({ where: { publicId: input.targetPublicId }, select: { id: true } })
          : input.kind === "UPDATE"
            ? await db.update.findFirst({ where: { publicId: input.targetPublicId }, select: { id: true } })
            : await db.template.findFirst({ where: { publicId: input.targetPublicId }, select: { id: true } });
      if (!found) return { items: [], nextCursor: null, canSeeHoldings };
      targetId = found.id;
    }

    const rows = await db.viewEvent.findMany({
      where: { ...(input.kind && { kind: input.kind }), ...(targetId && { targetId }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, input.limit);
    const nextCursor = rows.length > input.limit ? (rows[input.limit]?.id ?? null) : null;

    const ids = (kind: ViewKind, key: "recipientId" | "targetId") =>
      [...new Set(page.filter((r) => r.kind === kind).map((r) => r[key]))];

    const [rooms, updates, templates, roomRecips, updRecips, signRecips] = await Promise.all([
      db.dataRoom.findMany({ where: { id: { in: ids("DATA_ROOM", "targetId") } }, select: { id: true, name: true } }),
      db.update.findMany({ where: { id: { in: ids("UPDATE", "targetId") } }, select: { id: true, title: true } }),
      db.template.findMany({ where: { id: { in: ids("ESIGN", "targetId") } }, select: { id: true, name: true } }),
      db.dataRoomRecipient.findMany({ where: { id: { in: ids("DATA_ROOM", "recipientId") } }, select: { id: true, name: true, email: true, stakeholderId: true } }),
      db.updateRecipient.findMany({ where: { id: { in: ids("UPDATE", "recipientId") } }, select: { id: true, name: true, email: true, stakeholderId: true } }),
      db.esignRecipient.findMany({ where: { id: { in: ids("ESIGN", "recipientId") } }, select: { id: true, name: true, email: true } }),
    ]);

    const targetName = new Map<string, string>([
      ...rooms.map((r) => [r.id, r.name] as const),
      ...updates.map((r) => [r.id, r.title] as const),
      ...templates.map((r) => [r.id, r.name] as const),
    ]);
    const recipient = new Map<string, { name: string | null; email: string; stakeholderId: string | null }>([
      ...roomRecips.map((r) => [r.id, r] as const),
      ...updRecips.map((r) => [r.id, r] as const),
      ...signRecips.map((r) => [r.id, { ...r, stakeholderId: null }] as const),
    ]);

    // stakeholders: by id for rooms/updates, by email (this company only) for e-sign
    const emails = [...new Set(signRecips.map((r) => r.email.toLowerCase()))];
    const stakeholderIds = [...new Set([...roomRecips, ...updRecips].map((r) => r.stakeholderId).filter((x): x is string => !!x))];
    const stakeholders = await db.stakeholder.findMany({
      where: { OR: [{ id: { in: stakeholderIds } }, { email: { in: emails, mode: "insensitive" } }] },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(stakeholders.map((s) => [s.id, s]));
    const byEmail = new Map(stakeholders.map((s) => [s.email.toLowerCase(), s]));

    const holdings = new Map<string, number>();
    if (canSeeHoldings && stakeholders.length) {
      const sums = await db.share.groupBy({
        by: ["stakeholderId"],
        where: { stakeholderId: { in: stakeholders.map((s) => s.id) }, status: "ACTIVE" },
        _sum: { quantity: true },
      });
      for (const s of sums) holdings.set(s.stakeholderId, s._sum.quantity ?? 0);
    }

    const items = page.map((r) => {
      const rec = recipient.get(r.recipientId);
      const st = rec?.stakeholderId ? byId.get(rec.stakeholderId) : rec ? byEmail.get(rec.email.toLowerCase()) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        targetName: targetName.get(r.targetId) ?? "(deleted)",
        viewer: {
          label: rec?.name || rec?.email || "Unknown recipient",
          email: rec?.email ?? "",
          stakeholder: st ? { id: st.id, name: st.name, shares: canSeeHoldings ? (holdings.get(st.id) ?? 0) : null } : null,
        },
        country: r.country, network: r.network, timezone: r.timezone,
        createdAt: r.createdAt, activeSeconds: r.activeSeconds,
        pageSeconds: (r.pageSeconds ?? {}) as Record<string, number>,
        isBot: r.isBot,
      };
    });

    return { items, nextCursor, canSeeHoldings };
  });
```

- [ ] **Step 5: Register.** `router.ts`: `export const activityRouter = createTRPCRouter({ list: listActivityProcedure });` and add `activity: activityRouter` to the app router in `src/trpc/api/root.ts` (read the file and follow its import pattern).

- [ ] **Step 6: Run** `npx vitest run tests/tenant/activity-list.test.ts tests/tenant/roles.test.ts tests/tenant/architecture.test.ts` and `npx tsc --noEmit`. Expected PASS. If the architecture guard names `activity-router`, it must be because a procedure used the global db; use `ctx.tenant.db` only.

- [ ] **Step 7: Commit** `feat(activity): tenant-scoped activity list with cap-table context`.

---

### Task 8: Activity UI

**Files:**
- Create: `src/components/activity/activity-table.tsx`, `src/app/(authenticated)/(dashboard)/[publicId]/activity/page.tsx`
- Modify: `src/components/dashboard/sidebar/index.tsx` (add "Activity" link), the data room detail page (`.../documents/data-rooms/[dataRoomPublicId]/page.tsx`), the e-sign detail page (`.../documents/esign/v/[templatePublicId]/page.tsx`), the update detail page (`.../updates/[updatePublicId]/page.tsx`)

**Interfaces:**
- Consumes: `activity.list` (Task 7). Produces: `<ActivityTable kind? targetPublicId? />` (client).

- [ ] **Step 1: Component.** `activity-table.tsx` (client) uses `api.activity.list.useInfiniteQuery({ kind, targetPublicId, limit: 25 }, { getNextPageParam: (p) => p.nextCursor ?? undefined })` (react-query v4 / tRPC v10). Render with `@/components/ui/table`: columns **When** (relative with the ISO time as `title`), **Viewer** (label; under it, if `stakeholder`, the stakeholder name and, when `shares !== null`, `N shares`), **Where** (country via `new Intl.DisplayNames(["en"], { type: "region" }).of(country)`, then network in muted text, then timezone), **Time spent** (`mm:ss` from `activeSeconds`), **Pages** (for PDFs, a compact list of the top 3 pages by seconds, `p.3 · 1:12`), and an **Atypical source** badge when `isBot`. Empty state: "No views yet." A "Load more" button when `hasNextPage`. A one-line footer: "Location by IPinfo.io".

- [ ] **Step 2: Company page.** `[publicId]/activity/page.tsx`: gate exactly like the Audits page (`const { allow } = await serverAccessControl(); if (!allow(true, ["audits", "read"])) return <UnAuthorizedState />;`), title "Activity", render `<ActivityTable />` inside a `Card`.

- [ ] **Step 3: Sidebar.** Add `{ name: "Activity", href: "/activity", icon: <an existing Remix icon already imported in that file or one added to its import list> }` next to "Reports". Keep the existing structure.

- [ ] **Step 4: Item panels.** On each of the three detail pages add `<ActivityTable kind="DATA_ROOM" targetPublicId={dataRoomPublicId} />` (or `UPDATE` / `ESIGN` with that page's public id) in a `Card` titled "Activity", below the existing content. If the page's role lacks `audits:read` the query returns UNAUTHORIZED: render nothing in that case (check `serverAccessControl` on the page, as the e-sign view page already does for its audit panel).

- [ ] **Step 5: Verify:** `npx tsc --noEmit && npx biome check <changed files>`. Add no jsdom harness; the manual check is in the Deploy gate.

- [ ] **Step 6: Commit** `feat(activity): activity views per item and company-wide`.

---

### Task 9: Follow-ups: data room creator and retention

**Files:**
- Modify: `src/trpc/routers/data-room-router/router.ts` (record `createdById`), `src/jobs/view-alert-email.ts` (notify the creator), `src/constants/job.ts`, `src/jobs/register.ts`
- Create: `src/jobs/purge-view-events.ts`
- Test: `tests/tenant/view-alert-job.test.ts` (append), `tests/tenant/purge-view-events.test.ts`

**Interfaces:**
- Produces: `purgeViewEventsWorker` (`.handler([job])`), constant `RETENTION_MONTHS = 24`.

- [ ] **Step 1: Failing tests.**

Append to `tests/tenant/view-alert-job.test.ts`: a non-admin ACTIVE member who created the room (`db.dataRoom.update({ where: { id: aIds.dataRoomId }, data: { createdById: <that member id> } })`) receives the alert; with `notifyOnView: false` they do not.

Create `tests/tenant/purge-view-events.test.ts`:

```ts
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, cleanupTenants, seedTwoTenants } from "../helpers/seed";
import { purgeViewEventsWorker } from "@/jobs/purge-view-events";

let a: Tenant, b: Tenant;
beforeAll(async () => { ({ a, b } = await seedTwoTenants()); });
afterAll(async () => { await cleanupTenants(a, b); });

const months = (n: number) => new Date(Date.now() - n * 31 * 24 * 3600 * 1000);
const mk = (companyId: string, createdAt: Date, recipientId: string) =>
  db.viewEvent.create({ data: { companyId, kind: "ESIGN", targetId: "t", recipientId, ip: "1.2.3.0", userAgent: "ua", createdAt } });

describe("purge view events", () => {
  it("removes only rows older than 24 months, across companies, and nothing else", async () => {
    const oldA = await mk(a.companyId, months(25), "old-a");
    const oldB = await mk(b.companyId, months(30), "old-b");
    const newA = await mk(a.companyId, months(23), "new-a");
    const members = await db.member.count();

    await purgeViewEventsWorker.handler([{ data: {} } as never]);

    expect(await db.viewEvent.findUnique({ where: { id: oldA.id } })).toBeNull();
    expect(await db.viewEvent.findUnique({ where: { id: oldB.id } })).toBeNull();
    expect(await db.viewEvent.findUnique({ where: { id: newA.id } })).not.toBeNull();
    expect(await db.member.count()).toBe(members);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement the creator.** In `src/trpc/routers/data-room-router/router.ts`, in the `tx.dataRoom.create({ data: { ... } })` (around line 123) add `createdById: ctx.tenant.memberId,`. In `src/jobs/view-alert-email.ts`, `describe()` DATA_ROOM branch: select `createdById: true` in the `dataRoom.findFirstOrThrow` and return `ownerMemberId: room.createdById` instead of `null`.

- [ ] **Step 4: Implement the purge job.** In `src/constants/job.ts` add `maintenance: ["purge-view-events"],`. Create `src/jobs/purge-view-events.ts`:

```ts
import { db } from "@/server/db";
import { z } from "zod";
import { defineJob, defineWorker, defineWorkerConfig } from "../lib/queue";

export const RETENTION_MONTHS = 24;

const config = defineWorkerConfig({
  name: "maintenance.purge-view-events",
  schema: z.object({}),
});

export const purgeViewEventsJob = defineJob(config);

// Global db on purpose: retention is a platform rule, not a per-tenant action.
export const purgeViewEventsWorker = defineWorker(config, async () => {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  await db.viewEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
});
```

In `src/jobs/register.ts`: import it, `queueManager.register(purgeViewEventsWorker);`, and after `await queueManager.start();` add `await queue.schedule("maintenance.purge-view-events", "17 3 * * *", {});` (import `queue` from `../lib/queue`; pg-boss 10 `schedule(name, cron, data, options)`).

- [ ] **Step 5: Run** `npx vitest run tests/tenant/purge-view-events.test.ts tests/tenant/view-alert-job.test.ts` and `npx tsc --noEmit`. Expected PASS.

- [ ] **Step 6: Commit** `feat(activity): data room creator alerts and 24-month retention`.

---

### Task 10: Whole-branch verification

**Files:** none.

- [ ] **Step 1:** `export TEST_DATABASE_URL=postgres://captable:password@localhost:54331/captable_test`; run `npx tsc --noEmit`, `npx biome check <files changed on the branch>`, `npm test`.
- [ ] **Step 2:** `DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate status` expects "up to date".
- [ ] **Step 3:** `git grep -n "viewEvent.create\|viewEvent.update" -- src` shows only `src/server/view-events.ts` (create) and `src/app/api/activity/visit/route.ts` (update).
- [ ] **Step 4:** `grep -rn "IPINFO" docker .github src` shows the token only as the build secret, and `IPINFO_DB_PATH` only in `src/server/geo.ts`.
- [ ] **Step 5:** report counts and any failure, rerunning a failing file once to separate a flake from a real failure.

## Deploy gate (needs the owner's approval; not part of task execution)

1. Confirm `IPINFO_TOKEN` exists as a GitHub secret before merging, so the merge-built image contains the database.
2. Merge; wait for the `Image` workflow; the image tag is the full merge SHA.
3. Neon backup branch `pre-activity-phase-2-<date>`, then apply migration `20261014000000_activity_phase_2` (additive: nullable columns, one default, one index) and record it in `_prisma_migrations` with its sha256 checksum, exactly as Phase 1.
4. Back up `compose.yml`, set `image:`, `docker compose up -d --force-recreate app`.
5. Verify: `docker run --rm --entrypoint ls <image> -la /app/data` lists `ipinfo_lite.mmdb` (about 40 MB). Then open a throwaway data room link with a PDF, scroll two pages, and confirm in the database: one `ViewEvent` with `country` and `network` set, `timezone` set, `activeSeconds > 0`, `pageSeconds` with the pages you read. Confirm the real field names in the MMDB (`country_code`, `asn`, `as_name`); if they differ, change `toGeo` only.
6. In the app: the Activity page shows the visit; a role without `securities:read` sees no share counts.
7. Delete the test rows and the throwaway data room.

## Self-review

- **Coverage:** location (T2, T3, T4), time spent and per-page (T4, T5, T6), Activity views per item and company-wide with cap-table context (T7, T8), own views and revoked updates (T4), data room creator and retention (T9), viewer notice attribution (T6), verification (T10).
- **Placeholders:** none; Task 8 names the exact files and calls, and defers only the icon choice to an import already present in that file.
- **Type consistency:** `recordView` returns `Recorded = { visit, id }` in Task 4 and every later consumer (route, tests) uses `.visit` / `.id`; `Found` and `resolveRecipient` live in one module used by both routes; `pageSeconds` is `Record<string, number>` everywhere; `canSeeHoldings` comes from `ctx.permissions` entries `{ subject, actions }` as defined in `src/lib/rbac/constants.ts`.
- **Known limits (commented in code or listed):** page time only for PDFs; the read-then-write race in `recordView`; no city; IPinfo field names to confirm against the real file; the Docker change is first exercised by the post-merge image run unless Docker is available locally.
