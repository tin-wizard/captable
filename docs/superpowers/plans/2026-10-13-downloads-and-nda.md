# Download Controls and NDA Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company decide whether recipients get a Download button on a data room, record each download, and require recipients to accept a confidentiality notice before they can see a data room or update.

**Architecture:** Three additive switches (`DataRoom.allowDownload`, `DataRoom.requireNda`, `Update.requireNda`), one text field (`Company.ndaText`, with a placeholder default), and two small tables (`NdaAcceptance`, `DownloadEvent`). Two new token-authenticated public routes (`/api/activity/nda`, `/api/activity/download`) reuse `resolveRecipient`. The gate sits in the same server pages that already produce presigned URLs, so a file URL is never created before acceptance.

**Tech Stack:** Next.js 16, Prisma 5.14 (relationMode "prisma"), tRPC v10, S3 presign (`src/server/file-uploads.ts`), vitest, Biome 1.7.3, pnpm.

**Spec:** Chat decisions of 2026-10-13: NDA wording is a placeholder the company can edit; download tracking as researched (Papermark/DocSend style: allow or block downloads per link, record downloads).

## Assumptions and an honest limit (read first)
- **What exists today:** the public document page renders the PDF with pdf.js on canvases and has *no* download button. The only download path is the "Download" link for file types the previewer cannot show. So "download tracking" here means: (a) a per-room switch that adds a tracked Download button, (b) routing the existing fallback link through the same tracked route and the same switch.
- **What this cannot do:** the page receives a 10-minute presigned file URL so the PDF can render. A determined recipient can copy that URL and save the file without clicking anything. This feature records and controls *our* button; it is not copy protection (that needs server-side page rendering, out of scope). The settings screen says so in one line.
- **NDA is not legal advice.** The default text is an obvious placeholder (`[Your company] confidentiality notice. Replace this text.`). The company edits it; we store the exact text each person accepted.
- Defaults: `allowDownload = false`, `requireNda = false`, so nothing changes for existing rooms.
- A recipient who has accepted once is not asked again for the same room or update. Changing the text does not re-prompt (shortcut: no versioning; add `ndaVersion` when asked).

## Global Constraints
- Migration additive; the previously deployed image must keep working against the migrated schema.
- Public routes stay token-authenticated and answer exactly like an unknown link for an expired, revoked or unknown recipient (404, nothing recorded). Body size capped by Caddy (32 KB for `/api/activity/*`) and by zod.
- No file URL may be produced for a gated page before acceptance. The beacon is not mounted on the gate page, so a gate view is not recorded as a visit.
- Stored IPs are truncated (`truncateIp` from `src/server/view-events.ts`).
- `NdaAcceptance` is a consent record: it is **not** removed by the view-event retention purge. `DownloadEvent` is (same retention as `ViewEvent`).
- Permissions: setting `allowDownload` / `requireNda` needs `data-rooms:update` / `updates:update`; editing `ndaText` needs `company:update`; reading downloads and acceptances needs `audits:read` (same gate as viewer analytics).
- `pnpm biome check <files>`, `pnpm tsc --noEmit`, full vitest green; one vitest process; never bare `git stash`. Production steps by the orchestrator with approval.

## Review Focus
1. **Gate bypass.** Opening the bucket page URL directly (skipping the room page), or an update link, before accepting. Expected: gate shown, no presigned URL in the HTML. Pinned in Task 3.
2. **Wrong-room bucket.** `POST /api/activity/download` with a bucket of another room or company. Expected: 404, nothing recorded, no URL. Pinned in Task 2.
3. **Downloads off.** A direct call to the download route when `allowDownload` is false. Expected: 403, nothing recorded. Pinned in Task 2.
4. **Expired link after acceptance.** Accepted yesterday, link expired today. Expected: expired page, no content. Pinned in Task 3.
5. **Double accept.** Two simultaneous accepts. Expected: one row (unique constraint), both calls succeed. Pinned in Task 1.
6. **Another company's recipient** on either route. Expected: 404. Pinned in Tasks 1, 2.

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Schema, NDA accept route, settings | `opus` | `general-purpose` | Public token route plus consent record; security rule 3 |
| 2. Tracked download route and button | `opus` | `general-purpose` | Public route that mints file URLs; security rule 3 |
| 3. The gate in the three public pages | `opus` | `general-purpose` | Access control on file URLs |
| 4. Analytics columns, CSV, settings UI | `sonnet` | `general-purpose` | Composition over existing analytics |
| Reviews | `opus` for 1, 2, 3; `sonnet` for 4 | `general-purpose` | Per matrix |

---

### Task 1: Schema, `ndaText`, NDA accept route

**Files:**
- Modify: `prisma/schema.prisma`; create `prisma/migrations/20261019000000_downloads_and_nda/migration.sql`
- Create: `src/server/activity/nda.ts`, `src/app/api/activity/nda/route.ts`
- Test: `tests/tenant/nda.test.ts`

**Interfaces:**
- Produces: `DataRoom.allowDownload`, `DataRoom.requireNda`, `Update.requireNda` (Boolean default false); `Company.ndaText String?`; model `NdaAcceptance { id, companyId, kind ViewKind, targetId, recipientId, text, ip, userAgent, createdAt, @@unique([kind, targetId, recipientId]) }`; model `DownloadEvent { id, companyId, kind ViewKind, targetId, recipientId, bucketId, ip, userAgent, createdAt, @@index([companyId, createdAt]) }`; `DEFAULT_NDA_TEXT`; `getNdaState(db, { kind, targetId, recipientId, companyId }): Promise<{ required: false } | { required: true; accepted: boolean; text: string }>`; route `POST /api/activity/nda` body `{ kind: "DATA_ROOM" | "UPDATE", token }` → 204.

- [ ] **Step 1: Failing tests** (`tests/tenant/nda.test.ts`): accept with a valid link creates exactly one row with the company's current text and a truncated IP; a second accept is a no-op 204; unknown/expired/revoked token → 404 and no row; kind `ESIGN` → 400; a room with `requireNda = false` → 204 with no row (nothing to accept); another company's recipient token cannot create a row for this company's room (token's company/room/recipient are derived from the token only); `getNdaState` returns `required: false` when the switch is off, `accepted: false` before and `true` after.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Migration**

```sql
ALTER TABLE "DataRoom" ADD COLUMN "allowDownload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requireNda" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Update" ADD COLUMN "requireNda" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "ndaText" TEXT;
CREATE TABLE "NdaAcceptance" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "kind" "ViewKind" NOT NULL,
  "targetId" TEXT NOT NULL, "recipientId" TEXT NOT NULL, "text" TEXT NOT NULL,
  "ip" TEXT NOT NULL, "userAgent" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NdaAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NdaAcceptance_kind_targetId_recipientId_key" ON "NdaAcceptance"("kind","targetId","recipientId");
CREATE INDEX "NdaAcceptance_companyId_idx" ON "NdaAcceptance"("companyId");
CREATE TABLE "DownloadEvent" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "kind" "ViewKind" NOT NULL,
  "targetId" TEXT NOT NULL, "recipientId" TEXT NOT NULL, "bucketId" TEXT NOT NULL,
  "ip" TEXT NOT NULL, "userAgent" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownloadEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DownloadEvent_companyId_createdAt_idx" ON "DownloadEvent"("companyId","createdAt");
```

Add the same models to `schema.prisma` with relations to `Company` (`onDelete: Cascade`), and add both to `TENANT_MODELS` in `src/server/tenant-db.ts`.

- [ ] **Step 4: Implement** `nda.ts` (`DEFAULT_NDA_TEXT = "[Your company] confidentiality notice. Replace this text in Settings → Company."`; `getNdaState` reads `requireNda` from the DataRoom/Update row scoped by `companyId`, the company's `ndaText ?? DEFAULT_NDA_TEXT`, and the existing acceptance) and the route: parse with zod, `resolveRecipient(kind, token)` (it already enforces expiry and revocation), create with `upsert`-style `create` inside `try/catch` on the unique violation (P2002) so concurrent accepts both return 204; `truncateIp(getIp(req.headers))` and `getUserAgent(...).slice(0, 512)`.
- [ ] **Step 5:** Run `nda.test.ts`, `architecture.test.ts` (new tenant models), `tenant-db.test.ts`; tsc; biome.
- [ ] **Step 6:** Commit `feat(nda): acceptance records and the accept route`.

---

### Task 2: Tracked download route and button

**Files:**
- Create: `src/app/api/activity/download/route.ts`; modify `src/server/file-uploads.ts` (optional disposition argument), `src/components/file/preview.tsx`, `src/app/(documents)/data-rooms/[publicId]/[bucketId]/page.tsx`
- Test: `tests/tenant/download-route.test.ts`

**Interfaces:**
- `getPresignedGetUrl(key: string, opts?: { attachmentName?: string })` — default behaviour unchanged (`inline`); with `attachmentName` the response disposition is `attachment; filename="<sanitised>"`.
- `POST /api/activity/download` body `{ token, bucketId }` → `{ url }` (200), 403 downloads off, 403 NDA not accepted, 404 otherwise. Records one `DownloadEvent`.

- [ ] **Step 1: Failing tests:** valid link, `allowDownload` true, bucket in the room → 200 with `url` and one `DownloadEvent` (truncated IP); `allowDownload` false → 403 and no row; bucket of another room or company → 404 and no row; NDA required but not accepted → 403 and no row; accepted → 200; expired/revoked/unknown token → 404 and no row; UPDATE kind or bad body → 400.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement the route (resolve recipient; load the room by `found.targetId` with `companyId`; check the bucket via `dataRoomDocument` → `document.bucketId`; check `getNdaState`; create the event; mint the URL with the attachment disposition; response `Cache-Control: no-store`). Sanitise the filename (strip quotes, control characters and path separators).
- [ ] **Step 4: Client** — in `FilePreview` add an optional `onDownload?: () => void` prop; when provided render a "Download" button above the viewer; for `UnknownPreview` render the button only when the page passes `onDownload` and otherwise show "Downloads are turned off for this data room." The bucket page passes a small client component `DownloadButton` that POSTs `{ token, bucketId }` and navigates to the returned URL. The page passes it only when `dataRoom.allowDownload` is true.
- [ ] **Step 5:** Run download tests, `view-beacon.test.ts`, `architecture.test.ts`; tsc; biome.
- [ ] **Step 6:** Commit `feat(downloads): tracked download route and button`.

---

### Task 3: The gate in the three public pages

**Files:** Modify `src/app/(documents)/data-rooms/[publicId]/page.tsx`, `.../[bucketId]/page.tsx`, `src/app/updates/[publicId]/page.tsx`; create `src/components/share/nda-gate.tsx`; test `tests/tenant/nda-gate.test.ts`.

**Interfaces:** `<NdaGate kind token companyName text />` (client): shows the text, a required checkbox "I have read and accept", an Accept button posting to `/api/activity/nda`, then `router.refresh()`.

- [ ] **Step 1: Failing tests** (server-render the pages through their default export with a stub `searchParams`, as `tests/public-links.test.ts` does): requireNda on and not accepted → the output contains the gate and contains no presigned URL / document names; accepted → the normal page; requireNda off → unchanged; the bucket page with NDA required and not accepted → gate (direct-URL bypass); expired link after acceptance → expired page.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement: after the existing recipient and expiry checks and **before** `getPresignedGetUrl` or the file list, call `getNdaState`; if `required && !accepted` return `<SharePageLayout><NdaGate .../></SharePageLayout>` (no `ViewBeacon`).
- [ ] **Step 4:** Run gate tests, `public-links.test.ts`, `view-beacon.test.ts`; tsc; biome.
- [ ] **Step 5:** Commit `feat(nda): gate rooms and updates until accepted`.

---

### Task 4: Settings, analytics columns, CSV

**Files:** `src/components/company/preferences-card.tsx` (NDA text editor with the placeholder as the field's initial value), `data-room-files.tsx` (two switches: Allow downloads, Require NDA), `updates` editor page (Require NDA), `src/server/analytics/document.ts` (add `downloads` count per viewer and a `kpis.downloads`), `document-analytics.tsx` (column + KPI), CSV, `src/trpc/routers/data-room-router/router.ts` (`setAccess` mutation: `allowDownload`, `requireNda`; audit rows `dataroom.updated`), update router equivalent, `company.updatePreferences` extended with `ndaText`.

- [ ] **Step 1: Failing tests:** `setAccess` changes only the caller's room (cross-tenant case), needs `data-rooms:update` (role case); analytics returns `downloads` per viewer and total for known events and zero otherwise; `ndaText` over 5,000 characters is rejected.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement the three UI pieces and the analytics join (group `DownloadEvent` by `recipientId` for the target and range).
- [ ] **Step 4:** Run `analytics-document.test.ts`, roles, cross-tenant, architecture; tsc; biome. Commit `feat(downloads): settings, analytics and CSV columns`.

---

## Self-review
- **Coverage:** per-room download switch and tracking (Tasks 2, 4), fallback link routed through tracking (Task 2), NDA text editable with placeholder (Tasks 1, 4), acceptance record (Task 1), gate (Task 3), analytics and CSV (Task 4).
- **Karpathy:** the limit of browser-side download control is stated before any build; nothing beyond the three switches; success criteria are the listed tests.
- **Ponytail:** reuses `resolveRecipient`, `truncateIp`, `getPresignedGetUrl`, the existing pages and Caddy cap; skipped: NDA versions, per-recipient NDA, e-signature of the NDA, server-side page rendering.
- **Release:** one migration (`20261019000000_downloads_and_nda`), apply before the image; rollback-safe.
