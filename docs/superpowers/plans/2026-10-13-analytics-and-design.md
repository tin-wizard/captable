# Analytics and Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stubbed Overview with real numbers, and give documents, data rooms, updates and e-sign real analytics: graphs, filters, server-side pagination and CSV export, hosted on the Reports page too.

**Architecture:** One small analytics layer on the server (pure helpers plus tenant-scoped aggregation procedures) and one small UI kit (stat card, chart card, range tabs, filter chips, CSV button) on Tremor v3, which is already installed. Pages compose the kit. Per-document page time is the only new data we must start capturing (one nullable JSON column); everything else is derived from `ViewEvent`, `EsignAudit`, `EsignRecipient`, `Share`, `Option`, `Investment`, `Safe`, `ConvertibleNote`.

**Tech Stack:** Next.js 16, Prisma 5.14 (relationMode "prisma"), tRPC v10, `@tremor/react` ^3.17 (AreaChart, BarChart, DonutChart, CategoryBar, Tracker, SparkAreaChart, DateRangePicker), `@tanstack/react-table` ^8 with the existing `DataTable` parts (faceted filter, pagination, view options), dayjs, vitest, Biome 1.7.3, pnpm.

**Spec:** Chat decisions of 2026-10-13 (table below) and the Phase 1–3 plans in this directory (`2026-10-12-document-activity-phase-{1,2,3}.md`). There is no separate spec document.

## Decisions (from the owner, 2026-10-13)

| Question | Decision |
|---|---|
| Scope | All four areas: Overview, documents/data rooms/updates, e-sign, Reports page |
| Amount raised | **Show both**: "Investments recorded" (sum of `Investment.amount`) and "Issued value" (sum of share contributions), side by side, each with a tooltip saying how it is computed |
| Engagement labels | **Yes**: hot / warm / cold, with the raw numbers always shown beside the label |
| CSV export | **Yes**, for anyone who may read the company's data and the documents in question (rules in Global Constraints) |
| Reports page | **Hosts the analytics** (company-wide view with date range and export) |
| Release | **Deploy together with PR #31** (the Phase 3 loose ends, already merged to `main`): one migration, one image |

## Global Constraints

- **Permissions, exact rules** (all enforced on the server; the UI only hides what the server would refuse):
  - Viewer-level analytics (who looked, where, how long): `audits:read`, the same gate as `activity.list`.
  - Money and holdings (Overview ownership, issued value, investments, share counts next to a viewer): `securities:read`; without it those fields are `null` and the cards are not rendered.
  - Document-specific analytics additionally need the read permission of the source: `data-rooms:read`, `updates:read`, `templates:read`.
  - CSV export of a table requires exactly the permissions needed to see that table.
- **Tenant isolation:** every new query is made through the tenant client or filters by `companyId` (through the parent relation for recipients). A new `withAccessControl` procedure needs a `policies` meta and a role case in `tests/tenant/roles.test.ts`; id-like inputs need a case in `tests/tenant/cross-tenant.test.ts` (its coverage guard enforces this).
- **Bots:** analytics exclude `isBot = true` rows by default; the "hide bots" filter is on by default and the count of hidden bot visits is shown.
- **No change** to token format, signing, auth, `encode`/`decode`, or what the public beacon accepts beyond the optional fields in Task 1.
- **Public endpoints** (`/api/activity/view`, `/visit`) stay token-authenticated; extra input is validated, size-capped (32 KB at Caddy, schema caps in code) and ignored when it does not belong to the visit's data room.
- **Time:** all day buckets and ranges are UTC (`shortcut: UTC day buckets, add the company timezone when asked`). Ranges: 7, 30, 90 days or a custom from/to, default 30, max 400 days. KPI deltas compare to the previous period of the same length.
- **Pagination:** every list is server-side; page size default 25, max 50; cursor pagination in the style of `activity.list` (keyset on `createdAt desc, id desc`, cursor validated inside the tenant).
- **CSV:** at most 5,000 rows per export; cells beginning with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` (spreadsheet formula injection); UTF-8 with BOM; file name `<company>-<report>-<from>-<to>.csv`.
- **Accessibility:** every chart has a text alternative (a visually-hidden table or `aria-label` with the headline numbers) and works without colour alone (labels, patterns or direct values); focusable controls; keyboard-operable range tabs and chips; contrast at least AA against the card background.
- **Responsive:** layouts work at 375 px; charts shrink, tables scroll horizontally inside their card, never the page.
- **Copy:** product name from `src/lib/constants.ts`; no literal "CapTable".
- **Quality gates:** `pnpm biome check <changed files>` (not `pnpm lint`, which autofixes unrelated files), `pnpm tsc --noEmit` (4 known errors about missing `@/assets/tin-*.png` in worktrees), full vitest suite green before the PR. One vitest process at a time (shared test DB). Never bare `git stash`.
- **Production steps** (migration, deploy) are done by the orchestrator with the owner's approval at each step.

## Review Focus

Inputs and conditions no task's happy path exercises, most likely first:

1. **Empty and tiny data.** A company with zero views, one view, one page, one viewer. Expected: every chart renders an explicit empty state with a one-line next step, no `NaN%`, no division by zero, no negative deltas from `0 → 0`. Pinned in Tasks 2, 3.
2. **Legacy visits without per-document data.** Visits recorded before Task 1 have only the old `pageSeconds`. Expected: room-level numbers still work; per-document charts show "Per-document detail starts {date}" instead of wrong numbers. Pinned in Tasks 1, 5.
3. **Permission asymmetry.** A member with `audits:read` but not `securities:read` sees viewers but no holdings; the reverse sees Overview money but no viewer names. Expected: nulls, not errors, and no leaked totals via CSV. Pinned in Tasks 4, 5, 10.
4. **Cross-tenant ids.** Passing another company's room, update, template or cursor id to any new procedure. Expected: empty result or NOT_FOUND, never another company's numbers. Pinned in Tasks 4, 5, 8.
5. **CSV formula injection.** A recipient named `=HYPERLINK(...)`. Expected: cell is neutralised. Pinned in Task 2.
6. **Huge ranges and big companies.** 400-day range, 10,000 visits. Expected: aggregation is a single grouped query per chart (not per row), response under a second on the test data size, caps respected. Pinned in Task 5.
7. **A bot-heavy room** (scanner prefetches). Expected: hidden by default; the "N bot visits hidden" note appears; unique viewers exclude them. Pinned in Task 5.
8. **Deleted targets and recipients** (room deleted, recipient revoked). Expected: rows show "(deleted)" / "Unknown recipient" like `activity.list`, no 500. Pinned in Tasks 5, 8.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261016000000_view_doc_seconds/migration.sql` | `ViewEvent.docSeconds Json?` (Task 1) |
| `src/components/share/view-beacon.tsx`, `src/components/ui/pdf-viewer.tsx`, `src/app/api/activity/visit/route.ts`, `src/server/activity/doc-seconds.ts` (new) | Per-document page time capture (Task 1) |
| `src/server/analytics/range.ts`, `csv.ts`, `engagement.ts` (new) | Pure helpers: range parsing and buckets, CSV escaping, engagement score and label (Task 2) |
| `src/components/analytics/*` (new) | UI kit: `StatCard`, `ChartCard`, `RangeTabs`, `FilterChips`, `CsvButton`, `chart-theme.ts` (Task 3) |
| `scripts/seed-analytics-demo.ts` (new) | Local-only demo data for visual checks (Task 3) |
| `src/trpc/routers/overview-router/*` (new) | `overview.summary` (Task 4) |
| `src/trpc/routers/analytics-router/*` (new) | `analytics.document`, `analytics.documentsSummary` (Task 5), `analytics.esign`, `analytics.esignEnvelope` (Task 8), `analytics.company` (Task 10) |
| `src/components/dashboard/overview/*` | Real overview (Task 4) |
| data room / update / documents / e-sign pages and components | Compose the kit (Tasks 6, 7, 9) |
| `src/app/(authenticated)/(dashboard)/[publicId]/reports/page.tsx` | Company-wide analytics (Task 10) |

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Per-document page time capture | `opus` | `general-purpose` | Changes a public token-authenticated endpoint and a migration; security rule 3 |
| 2. Pure helpers (range, csv, engagement) | `sonnet` | `general-purpose` | Isolated, fully specified, edge-case tests |
| 3. UI kit + demo seed | `sonnet` | `general-purpose` | Multi-file UI with a11y requirements |
| 4. Overview summary + page | `opus` | `general-purpose` | Money and holdings behind permissions; replaces stubs |
| 5. Document analytics server | `opus` | `general-purpose` | New tenant-scoped aggregation, raw SQL risk; security rule 3 |
| 6. Data room detail UI | `sonnet` | `general-purpose` | Composition of Task 3 kit over Task 5 API |
| 7. Lists, documents landing, updates UI | `sonnet` | `general-purpose` | Same, three pages |
| 8. E-sign analytics server | `opus` | `general-purpose` | Audit-derived timing, tenant scoping, no existing pattern |
| 9. E-sign UI | `sonnet` | `general-purpose` | Composition |
| 10. Reports page + company analytics + export | `sonnet` build, `opus` review | `general-purpose` | Aggregates everything; export is a data-egress path |
| Per-task reviews | `sonnet` (`opus` for 1, 4, 5, 8, 10) | `general-purpose` | Per matrix |
| 11. Whole-branch verification and final review | `opus` | `general-purpose` | Per matrix |
| 12. Release (migration, deploy with PR #31) | orchestrator | n/a | Production and credentials stay with the orchestrator |

Previous-phase review: before each task after the first, the orchestrator reads the previous task's diff and test output and corrects the next brief if the plan text no longer fits.

---

### Task 1: Per-document page time capture

**Why:** today a visit's `pageSeconds` is one map `{page: seconds}` for the whole visit. A data room has several documents, so page 3 of document A and page 3 of document B collide and "which page loses people" cannot be answered. The data-room document page already renders `<ViewBeacon>` with the same token; it only needs to say which document and how many pages.

**Files:**
- Modify: `prisma/schema.prisma` (`ViewEvent`), create `prisma/migrations/20261016000000_view_doc_seconds/migration.sql`
- Create: `src/server/activity/doc-seconds.ts`
- Modify: `src/components/share/view-beacon.tsx`, `src/components/ui/pdf-viewer.tsx`, `src/app/(documents)/data-rooms/[publicId]/[bucketId]/page.tsx`, `src/app/api/activity/visit/route.ts`
- Test: `tests/tenant/view-heartbeat.test.ts` (extend), `src/server/activity/doc-seconds.test.ts`

**Interfaces:**
- Produces: `ViewEvent.docSeconds: Prisma.JsonValue | null` shaped `{ [bucketId: string]: { n: number; p: { [page: string]: number } } }` (`n` = page count of the document, `p` = seconds per page); `mergeDocSeconds(stored: DocSeconds, incoming: DocSeconds, ceiling: number): DocSeconds` (per page `max(stored, min(incoming, ceiling))`, `n` = max seen, caps below).
- The heartbeat body gains an optional `docs: { bucketId: string; n: number; p: Record<string, number> }[]` (max 20 entries; `n` int 1..5000; page keys `^[1-9]\d{0,3}$`; seconds int 0..3600; at most 500 pages per entry). The old `pageSeconds` field keeps working unchanged.

- [ ] **Step 1: Failing unit tests** (`src/server/activity/doc-seconds.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { mergeDocSeconds } from "./doc-seconds";

describe("mergeDocSeconds", () => {
  it("only ever raises values and clamps to the ceiling", () => {
    const a = { b1: { n: 10, p: { "1": 5, "2": 3 } } };
    const out = mergeDocSeconds(a, { b1: { n: 10, p: { "1": 2, "2": 900, "3": 4 } } }, 60);
    expect(out.b1.p).toEqual({ "1": 5, "2": 60, "3": 4 });
  });
  it("keeps the largest page count seen and ignores a page beyond n", () => {
    const out = mergeDocSeconds({ b1: { n: 3, p: {} } }, { b1: { n: 5, p: { "9": 4, "5": 1 } } }, 60);
    expect(out.b1.n).toBe(5);
    expect(out.b1.p).toEqual({ "5": 1 });
  });
  it("caps documents per visit at 20", () => {
    const inc = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`b${i}`, { n: 2, p: { "1": 1 } }]));
    expect(Object.keys(mergeDocSeconds({}, inc, 60))).toHaveLength(20);
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run src/server/activity/doc-seconds.test.ts` — Expected FAIL (module missing).
- [ ] **Step 3: Implement** `doc-seconds.ts` exporting `DocSeconds`, `mergeDocSeconds` (pure; ignores non-matching page keys; ignores page > n; caps 20 documents; caps 500 pages per document).
- [ ] **Step 4: Migration** (additive): `ALTER TABLE "ViewEvent" ADD COLUMN "docSeconds" JSONB;` and the schema line `docSeconds Json?` with a comment of the shape. Hand-written SQL, applied by hand in production (Task 12).
- [ ] **Step 5: Heartbeat** — extend the zod schema with the optional `docs` array; after the existing ownership check on the visit row, keep only entries whose `bucketId` is a document of this data room (`db.dataRoomDocument.findMany({ where: { dataRoomId: found.targetId, document: { bucketId: { in: ids } } } })`, kind DATA_ROOM only; ignore `docs` for other kinds), merge with `mergeDocSeconds` using the same wall-clock ceiling as `pageSeconds`, and write `docSeconds` in the same update. Failing tests first in `view-heartbeat.test.ts`: (a) docs for a bucket of this room are stored; (b) a bucket of another room or company is silently dropped; (c) values only rise; (d) `docs` on an UPDATE visit is ignored; (e) oversize payload is a 400.
- [ ] **Step 6: Client** — `PdfViewer` exposes its page count as `data-total-pages` on its root; `ViewBeacon` takes optional `bucketId`; on each flush it reads `document.querySelector("[data-total-pages]")`, and sends `docs: [{ bucketId, n, p: pageSeconds }]` in addition to the unchanged `pageSeconds`. The bucket page passes `bucketId`. The room-level page passes nothing.
- [ ] **Step 7: Run** `pnpm vitest run tests/tenant/view-heartbeat.test.ts tests/tenant/view-beacon.test.ts src/server/activity tests/tenant/architecture.test.ts` — Expected PASS; `pnpm tsc --noEmit`; `pnpm biome check` on changed files.
- [ ] **Step 8: Commit** `feat(activity): record page time per document` .

Review focus pinned here: item 2 (legacy rows keep `docSeconds` null) and the public-endpoint guard (b, d, e).

---

### Task 2: Pure helpers (range, CSV, engagement)

**Files:**
- Create: `src/server/analytics/range.ts`, `src/server/analytics/csv.ts`, `src/server/analytics/engagement.ts`
- Test: `src/server/analytics/range.test.ts`, `csv.test.ts`, `engagement.test.ts`

**Interfaces:**
- `parseRange(input: { range?: "7d" | "30d" | "90d" | "custom"; from?: string; to?: string }, now?: Date): { from: Date; to: Date; previousFrom: Date; previousTo: Date; days: number }` (default 30d; custom clamped to 400 days; `from > to` swapped; ISO dates only; invalid → default).
- `dayBuckets(from: Date, to: Date): string[]` (UTC `YYYY-MM-DD`, inclusive, zero-fill source).
- `delta(current: number, previous: number): { pct: number | null; direction: "up" | "down" | "flat" }` (previous 0 and current 0 → flat/null; previous 0 and current > 0 → `pct: null`, up).
- `toCsv(rows: Record<string, string | number | null | Date>[], columns: { key: string; label: string }[]): string` (BOM, CRLF, quotes, formula-neutralising).
- `engagement(input: { activeSeconds: number; visits: number; pagesReached: number; pagesTotal: number | null }): { score: number; label: "hot" | "warm" | "cold" }`.

- [ ] **Step 1: Failing tests** — range: default 30d; custom swapped; clamp to 400; invalid dates fall back; previous period has equal length and ends where the current one starts. `dayBuckets`: inclusive, length = days. `delta`: `0→0` flat, `0→5` up with null pct, `10→5` down −50. `toCsv`: quotes commas and newlines, doubles quotes, neutralises `=cmd`, `+1`, `-1`, `@x`, `\tx` (prefix `'`) but leaves a plain negative number value (type number) untouched, starts with BOM, ends with CRLF. engagement: documented formula below with table-driven cases (0 s → cold 0; 300 s + all pages + 3 visits → hot 100; unknown `pagesTotal` uses time and returns only).

Engagement formula (write it as a comment above the function): `score = round(100 * (0.4 * min(1, activeSeconds/300) + 0.3 * coverage + 0.3 * min(1, (visits - 1)/2)))` where `coverage = pagesTotal ? min(1, pagesReached/pagesTotal) : min(1, activeSeconds/300)`; labels `hot ≥ 70`, `warm ≥ 35`, else `cold`.

- [ ] **Step 2:** Run the three test files — Expected FAIL.
- [ ] **Step 3:** Implement the three modules (pure, no I/O).
- [ ] **Step 4:** Run — Expected PASS; `pnpm biome check src/server/analytics`.
- [ ] **Step 5:** Commit `feat(analytics): range, csv and engagement helpers`.

---

### Task 3: UI kit and local demo seed

**Files:**
- Create: `src/components/analytics/stat-card.tsx`, `chart-card.tsx`, `range-tabs.tsx`, `filter-chips.tsx`, `csv-button.tsx`, `chart-theme.ts`, `use-url-state.ts`, `index.ts`
- Create: `scripts/seed-analytics-demo.ts`
- Test: `src/components/analytics/use-url-state.test.ts` (pure parts), `scripts/seed-analytics-demo.test.ts` (guard only)

**Interfaces:**
- `<StatCard label value hint? delta? spark? href? loading? />` — `delta` is the output of `delta()`; `spark` is `{ index: string; value: number }[]` rendered with `SparkAreaChart`; `value` is a preformatted string; `loading` renders a skeleton; `href` makes the whole card a link.
- `<ChartCard title description? range? actions? state="ready"|"loading"|"empty"|"error" emptyHint? tableAlt?>` — `tableAlt` is `{ columns: string[]; rows: (string|number)[][] }` rendered as a visually-hidden table; `empty` renders an icon and `emptyHint`; `error` renders a retry button.
- `<RangeTabs value onChange />` — 7d / 30d / 90d / Custom (Tremor `DateRangePicker` for custom); state lives in the URL query (`?range=30d` or `?range=custom&from=…&to=…`) through `useUrlState`.
- `<FilterChips groups={[{ key, label, options: { value, label, count? }[], multi? }]} />` — URL-backed, resets page cursor when changed.
- `<CsvButton onExport: () => Promise<{ filename: string; csv: string }> />` — builds a Blob download client-side; disabled with a tooltip when the caller lacks permission; toasts on error.
- `chartTheme` — a palette from the existing navy/brand Tailwind tokens (read `tailwind.config.ts` for the real token names): primary, secondary, and three status colours (success, warning, danger) that stay distinguishable in greyscale, plus `valueFormatter` helpers (`formatDuration`, `formatCompact`, `formatPercent`). Reuse `formatDuration` from `src/components/activity/format.ts`.

- [ ] **Step 1:** Write the pure-logic test for `useUrlState` helpers (serialise/parse range and chip state, unknown keys preserved, cursor removed on filter change). Run — FAIL.
- [ ] **Step 2:** Implement the components and the helpers; no data fetching in the kit.
- [ ] **Step 3: Demo seed** — `scripts/seed-analytics-demo.ts` creates, for one company chosen by `--company <publicId>`, ~12 recipients, ~200 view events over 60 days (mixed countries, a few bots, per-document `docSeconds`), and 6 e-sign envelopes in different states with audit rows. It refuses to run unless `DATABASE_URL` host is `localhost` or `127.0.0.1` (test: the guard rejects a `neon.tech` URL). Never referenced by app code.
- [ ] **Step 4:** Run the two test files; `pnpm tsc --noEmit`; biome check.
- [ ] **Step 5:** Commit `feat(analytics): chart and filter UI kit`.

Visual acceptance (done by the reviewer in the browser pane, screenshots saved in the SDD directory): cards render in light theme at 1280 px and 375 px; empty, loading and error states; keyboard order of the range tabs and chips.

---

### Task 4: Real Overview

**Files:**
- Create: `src/trpc/routers/overview-router/router.ts`, `procedures/summary.ts`, register in `src/trpc/api/root.ts`
- Modify: `src/app/(authenticated)/(dashboard)/[publicId]/page.tsx`, `src/components/dashboard/overview/{donut-card,summary-table,top-card}.tsx`, delete the stub arrays
- Test: `tests/tenant/overview-summary.test.ts`

**Interfaces:**
- `overview.summary` (policy: `securities: { allow: ["read"] }` for the money block; the viewer/e-sign blocks check `audits:read` / `templates:read` inside the procedure and return `null` when not allowed — use `ctx.permissions` the way `activity.list` does):

```ts
type OverviewSummary = {
  holdings: null | {
    issuedShares: number;            // Σ Share.quantity where status ACTIVE
    optionsOutstanding: number;      // Σ Option.quantity where status ACTIVE
    planReserveUnallocated: number;  // Σ max(0, EquityPlan.initialSharesReserved − granted options of the plan)
    fullyDiluted: number;            // issued + optionsOutstanding + planReserveUnallocated
    issuedValue: number;             // Σ Share.capitalContribution ?? quantity × pricePerShare ?? 0 (ACTIVE)
    investmentsRecorded: number;     // Σ Investment.amount
    convertibleCapital: number;      // Σ capital of SAFEs and notes with status ACTIVE
    byClass: { shareClassId: string; name: string; shares: number; pct: number; authorized: number; issuedValue: number }[];
    byStakeholder: { stakeholderId: string; name: string; shares: number; pct: number }[]; // top 8 + "Others"
  };
  stakeholders: number | null;       // count; needs stakeholders:read
  engagement: null | { views7d: number; viewsPrev7d: number; unopenedShares: number; series: { day: string; views: number }[] };
  esign: null | { pending: number; awaitingYou: number; completed30d: number };
};
```

- Percentages are of issued shares for `byClass`/`byStakeholder` ("Ownership by …" as the donut says today); `fullyDiluted` is shown as its own card with its formula in a tooltip.

- [ ] **Step 1: Failing tests** — a fixture company with 2 classes, 3 stakeholders, ACTIVE and DRAFT shares, ACTIVE and EXPIRED options, one plan with a reserve, 2 investments, one ACTIVE SAFE: assert every figure above by hand-computed expectations; a DRAFT share and an EXPIRED option are excluded; a role with `securities:read` but not `audits:read` gets `engagement: null`; a role with `audits:read` only gets `holdings: null`; tenant B's data never appears; an empty company returns zeros and empty arrays (no NaN).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement** with grouped queries (`groupBy` on `Share`, `Option`, `EquityPlan`, aggregates on `Investment`, `Safe`, `ConvertibleNote`, one `ViewEvent` day series for 7 days). Use `bigint` → `Number` conversion with a guard for values above `Number.MAX_SAFE_INTEGER` (cap and flag).
- [ ] **Step 4: Page** — server component calls `api.overview.summary.query()`; renders: KPI row ("Issued shares", "Fully diluted", "Issued value", "Investments recorded", "Stakeholders", each `StatCard` with tooltip; convertible capital as a sub-line of Investments), ownership donut with a toggle "By class / By stakeholder" (real data, top 8 + Others), summary table (real classes with authorized, issued, ownership, value; footer totals), the existing Activities card, a "This week" card (views with sparkline, link to `/activity`), "Needs attention" list (unopened shares with count, pending signatures with count, each linking to its page), and an empty state per block for a brand-new company with a "Add your first share class" style link. Remove the `/* EmptyOverview */` dead comment.
- [ ] **Step 5:** Run `pnpm vitest run tests/tenant/overview-summary.test.ts tests/tenant/roles.test.ts tests/tenant/cross-tenant.test.ts tests/tenant/architecture.test.ts`; tsc; biome.
- [ ] **Step 6:** Commit `feat(overview): real numbers from shares, options, investments and activity`.

Review focus pinned here: items 1, 3, 4. Note for the reviewer: the Cap table page itself is still "Work in progress" and is out of scope.

---

### Task 5: Document analytics server

**Files:**
- Create: `src/trpc/routers/analytics-router/{router.ts,schema.ts,procedures/document.ts,procedures/documents-summary.ts}`, register in `root.ts`
- Test: `tests/tenant/analytics-document.test.ts`, role cases in `tests/tenant/roles.test.ts`, cross-tenant case

**Interfaces:**
- `analytics.document` input `{ kind: "DATA_ROOM" | "UPDATE"; targetPublicId: string; range?; from?; to?; includeBots?: boolean; viewerStatus?: "all" | "opened" | "returned" | "unopened"; country?: string[]; search?: string; cursor?: string; limit?: number }`; policy `audits:read` plus the source read permission checked inside (`data-rooms:read` / `updates:read`).
- Output:

```ts
type DocumentAnalytics = {
  range: { from: string; to: string };
  kpis: {
    visits: number; viewers: number; avgActiveSeconds: number; completionRate: number | null; returnRate: number;
    previous: { visits: number; viewers: number; avgActiveSeconds: number };
    botsHidden: number;
  };
  series: { day: string; visits: number; viewers: number }[];            // zero-filled, UTC
  documents: null | { bucketId: string; name: string; pages: number | null; viewers: number; avgSeconds: number;
                      completion: number | null; byPage: { page: number; seconds: number; viewers: number }[] }[]; // DATA_ROOM only; null when no docSeconds data in range
  countries: { country: string; visits: number }[];                       // top 8
  engagementMix: { hot: number; warm: number; cold: number; unopened: number };
  viewers: { items: ViewerRow[]; nextCursor: string | null };             // paginated
  legacyDetailFrom: string | null;                                       // date docSeconds starts, when range includes older visits
};
type ViewerRow = { recipientId: string; label: string; email: string; stakeholder: { id: string; name: string; shares: number | null } | null;
                   visits: number; firstSeen: string; lastSeen: string; activeSeconds: number; pagesReached: number | null;
                   score: number; label: "hot" | "warm" | "cold"; countries: string[]; isBot: boolean };
```

- `analytics.documentsSummary` input `{ kind: "DATA_ROOM" | "UPDATE"; range?: ... }` → `{ items: { targetId: string; publicId: string; name: string; viewers: number; visits: number; avgActiveSeconds: number; lastViewedAt: string | null; unopened: number; spark: { day: string; visits: number }[] }[] }` (all rooms or updates of the company in one grouped pass, no N+1).

- [ ] **Step 1: Failing tests** with a fixture of known events (hand-computed): KPIs, zero-filled series length equals `days`, previous period, bots hidden vs included, `completionRate` uses `docSeconds` (a visit reached the last page when `p[n]` exists), returns `null` when no `docSeconds`, `viewerStatus` filters, country filter, search matches name and email case-insensitively, cursor pagination across two pages has no gaps or duplicates (including equal `createdAt` ties), foreign cursor returns empty, foreign `targetPublicId` returns empty, a member without `audits:read` is refused, a member with `audits:read` but without `securities:read` gets `stakeholder.shares = null`, deleted target returns "(deleted)" style labels, a 400-day range works, `limit: 51` is rejected.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** Aggregate in SQL where it is cheaper than JS: day series and counts with `groupBy` or one `$queryRaw` with parameters and an explicit `"companyId" = ${companyId}` (the tenant client does not scope raw SQL, so every raw statement must carry the company filter and be covered by a cross-tenant test). Viewer rows come from a grouped query by `recipientId` ordered by `lastSeen desc, recipientId desc` for the keyset cursor. Reuse `engagement()`, `parseRange()`, `dayBuckets()` from Task 2.
- [ ] **Step 4: Performance check** in the test: seed 10,000 events across 200 recipients, assert one `analytics.document` call completes in under 1500 ms on the test DB (`it.skipIf(process.env.CI_FAST)`), and that the number of queries issued is below 12 (spy on `db.$on("query")` or count via a wrapper) — a per-row query loop fails this.
- [ ] **Step 5:** Run `pnpm vitest run tests/tenant/analytics-document.test.ts tests/tenant/roles.test.ts tests/tenant/cross-tenant.test.ts tests/tenant/architecture.test.ts`; tsc; biome.
- [ ] **Step 6:** Commit `feat(analytics): document and data room analytics API`.

---

### Task 6: Data room detail page

**Files:**
- Modify: `src/app/(authenticated)/(dashboard)/[publicId]/documents/data-rooms/[dataRoomPublicId]/page.tsx`
- Create: `src/components/analytics/document/{document-analytics.tsx,kpi-strip.tsx,views-chart.tsx,page-engagement.tsx,documents-table.tsx,viewer-table.tsx,countries-card.tsx,engagement-mix.tsx}`
- Keep: the existing `ActivityTable` below as "Visit log", and `UnopenedList`

**Behaviour:**
- Header strip (`StatCard` ×4 with deltas and sparkline): Unique viewers, Visits, Avg time per visit, Completion rate (tooltip: "share of viewers who reached the last page of a document", "—" with the legacy hint when unknown); the "N bot visits hidden" note under the strip with a toggle.
- `RangeTabs` and `FilterChips` (status: All / Opened / Returned / Not opened; country multi-select; "Show bots").
- Views over time: `AreaChart` (visits and unique viewers), `ChartCard` with `tableAlt`.
- Document engagement: for a room, a table of documents with viewers, avg time, completion and a mini bar of `byPage`; selecting a row expands the per-page `BarChart` (seconds per page) with the drop-off page called out ("most viewers stop at page 7").
- Viewers: `DataTable` (existing parts) with columns Viewer (name + email + stakeholder badge with shares when permitted), Engagement (label chip + score), Visits, Active time, Pages reached, Last seen, Countries; server pagination via cursor; column visibility menu; row click opens a side sheet with that viewer's visit strip (`Tracker`, one block per day in range, colour by active seconds) and their visits list.
- `EngagementMix`: `CategoryBar` hot / warm / cold / not opened with counts.
- `CsvButton`: exports the viewer table for the current filters (up to 5,000 rows) via `analytics.document` paging in the client, using `toCsv`.
- Empty state for a room nobody opened: the Not opened yet list is promoted to the top with the Send reminder button.

- [ ] **Step 1:** Component-level pure tests where logic exists (drop-off page picker, label→chip mapping) in `src/components/analytics/document/*.test.ts`; run — FAIL; implement; run — PASS.
- [ ] **Step 2:** Compose the page; gate each block with the permissions in Global Constraints; server-render the first page of data through `api.analytics.document.query` and hydrate the client with it.
- [ ] **Step 3: Visual check** with the demo seed (Task 3): screenshots at 1280 px and 375 px, empty / loading / error states, keyboard walk-through; attach to the SDD report.
- [ ] **Step 4:** `pnpm tsc --noEmit`, biome check, `pnpm vitest run tests/tenant/architecture.test.ts`.
- [ ] **Step 5:** Commit `feat(documents): data room analytics page`.

---

### Task 7: Data rooms list, Documents landing, Updates detail

**Files:**
- Modify: `…/documents/data-rooms/page.tsx` and `components/dataroom-folders.tsx`, `…/documents/page.tsx`, `…/updates/[updatePublicId]/page.tsx`
- Create: `src/components/analytics/document/room-card.tsx`, `update-analytics.tsx`

**Behaviour:**
- Data rooms list: each folder card gains viewers, avg time, last viewed, a sparkline, and a "N not opened" badge from `analytics.documentsSummary` (single call); search box and sort (last viewed, most viewers, name); the empty state is unchanged.
- Documents landing: a KPI strip above the table (Documents, Shared, Views this period, Not opened) and a views-over-time chart from `analytics.company` (Task 10 provides the procedure; until then use `analytics.documentsSummary` series aggregated client-side — this task only consumes `documentsSummary`); the document table keeps its columns and gains a server-paginated page size selector (25/50).
- Update detail: the same KPI strip, views chart, viewer table and not-opened lane via `analytics.document` with `kind: "UPDATE"` (no per-page section; "Documents" block hidden).

- [ ] **Step 1:** Implement; **Step 2:** visual check with seed at 1280/375; **Step 3:** tsc, biome, architecture test; **Step 4:** commit `feat(documents): analytics on rooms list, documents and updates`.

---

### Task 8: E-sign analytics server

**Files:**
- Create: `src/trpc/routers/analytics-router/procedures/esign.ts`, `esign-envelope.ts`; modify `src/trpc/routers/template-router/procedures/get-all-template.ts` or add `list` (new, filter + cursor) without breaking the existing `template.all` consumers
- Test: `tests/tenant/analytics-esign.test.ts`, role and cross-tenant cases

**Definitions (derived from existing rows; write them as comments in the code):**
- *Sent at* per recipient: the `document.email.sent` audit row for that recipient (fallback: envelope `createdAt` when none). *Viewed at*: first `ViewEvent` with `kind = ESIGN` for the recipient (fallback: `recipient.viewed` audit). *Signed at*: `recipient.signed` audit. *Completed at*: `Template.completedOn`.
- *Time to sign* = signed − sent, per recipient and per envelope (last signer). *Waiting* = now − sent for recipients not signed. *Stuck* = waiting ≥ 3 days.

**Interfaces:**
- `analytics.esign` input `{ range?; from?; to?; status?: TemplateStatus[]; uploaderId?: string; signer?: string; stuck?: boolean; search?: string; cursor?: string; limit?: number }`; policy `templates:read`, viewer-level details need `audits:read` (otherwise `viewedAt` is `null`).

```ts
type EsignAnalytics = {
  kpis: { sent: number; completed: number; completionRate: number | null; medianHoursToSign: number | null;
          avgHoursToSign: number | null; pendingSigners: number; stuckSigners: number;
          previous: { sent: number; completed: number; medianHoursToSign: number | null } };
  funnel: { sent: number; viewed: number; signed: number; completed: number };   // counts of recipients, completed = envelopes
  series: { day: string; sent: number; completed: number }[];
  statusMix: { DRAFT: number; PENDING: number; COMPLETE: number; CANCELLED: number };
  slowest: { recipientId: string; name: string; email: string; envelopes: number; medianHours: number }[]; // top 5 signers
  envelopes: { items: EnvelopeRow[]; nextCursor: string | null };
};
type EnvelopeRow = { templateId: string; publicId: string; name: string; status: TemplateStatus; createdAt: string; sentAt: string | null;
                     completedAt: string | null; signers: { signed: number; total: number }; hoursToComplete: number | null;
                     waitingOn: { name: string; email: string; waitingDays: number }[]; stuck: boolean };
```

- `analytics.esignEnvelope` input `{ templatePublicId }` → per-signer steps `{ recipient, status, sentAt, viewedAt, signedAt, hoursToSign, waitingDays | null, order }` and a timeline of audit rows.

- [ ] **Step 1: Failing tests** with a fixture (3 envelopes, 5 recipients, known timestamps): funnel counts, median and average hours, stuck flag at the 3-day boundary, `waitingOn` lists only unsigned recipients, cancelled/draft envelopes excluded from time stats, status/uploader/signer/search filters, cursor pagination without gaps, foreign `templatePublicId` → NOT_FOUND, member without `templates:read` refused, `audits:read` absent → `viewedAt: null`, empty company → zeros without NaN.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement with grouped queries on `EsignAudit` (filter by `action in (...)` and `companyId`), no per-envelope loops. **Step 4:** Run the suite incl. roles, cross-tenant, architecture, `tests/tenant/esign-resend.test.ts`. **Step 5:** Commit `feat(analytics): e-sign analytics API`.

Review focus pinned here: items 3, 4, 8.

---

### Task 9: E-sign UI

**Files:**
- Modify: `…/documents/esign/page.tsx`, `components/table.tsx`, `…/documents/esign/v/[templatePublicId]/page.tsx`
- Create: `src/components/analytics/esign/{esign-analytics.tsx,funnel.tsx,time-to-sign.tsx,signer-tracker.tsx,bottleneck.tsx}`

**Behaviour:**
- List page: KPI strip (Sent, Completed, Completion rate, Median time to sign, Waiting on signers with a "stuck" count), funnel (`BarChart` horizontal: Sent → Viewed → Signed → Completed with drop-off percentages between bars), activity-over-time `AreaChart` (sent vs completed), status `DonutChart`, "Slowest signers" mini-list; below, the envelope table with filter chips (status, "Stuck over 3 days", uploader, signer search), date range, server pagination, page size, column visibility, `CsvButton`.
- Envelope detail: signer progress `Tracker` strip (one block per signer, colour = status), a "Waiting on {name} for {n} days" callout with the existing resend-link action (reuse `template.resendLink`; do not add a new sender), per-signer timing table, and the audit timeline.
- Keep the existing status text values; add colour chips with text (not colour alone).

- [ ] **Step 1:** Pure-logic tests for funnel drop-off maths and the stuck label; run FAIL → implement → PASS. **Step 2:** Compose pages, gate by `templates:read` / `audits:read`. **Step 3:** Visual check with seed at 1280/375 plus empty and error states. **Step 4:** tsc, biome, `tests/tenant/esign-resend.test.ts`. **Step 5:** Commit `feat(esign): analytics, funnel and filters`.

---

### Task 10: Reports page, company analytics, export

**Files:**
- Create: `src/trpc/routers/analytics-router/procedures/company.ts`
- Modify: `src/app/(authenticated)/(dashboard)/[publicId]/reports/page.tsx`, create `src/components/analytics/reports/*`
- Test: `tests/tenant/analytics-company.test.ts`

**Interfaces:**
- `analytics.company` input `{ range?; from?; to?; includeBots? }`; output combines, for the permissions the caller holds, `{ documents: { visits, viewers, avgActiveSeconds, series, topItems: { kind, name, publicId, viewers, visits }[10], countries }, esign: { kpis, funnel, series }, holdings?: OverviewSummary["holdings"] | null }` (reuse the Task 5/8 aggregation modules; do not duplicate queries).
- Export datasets (client builds CSV via `toCsv`, paging the existing procedures up to 5,000 rows): "Viewers (all rooms and updates)", "E-sign envelopes", "Ownership by class", "Ownership by stakeholder". Each dataset appears only when the caller may read it.

**Behaviour:** Reports page = tabs "Engagement", "E-sign", "Ownership" (tabs hidden when not permitted), shared `RangeTabs`, KPI strips, charts as on the detail pages at company level, a ranked "Top rooms and updates" table (server paginated), an "Exports" card listing the datasets with `CsvButton`s, and the old empty state when the company has no data at all.

- [ ] **Step 1: Failing tests:** permission matrix (audits only / templates only / securities only / none), no leaked totals for hidden blocks, tenant isolation, empty company, bots excluded unless requested. **Step 2:** FAIL → implement → PASS. **Step 3:** CSV export test: dataset rows respect the same permission as the table (a member without `securities:read` gets no ownership dataset), and a recipient named `=cmd|' /C calc'!A0` is neutralised in the produced file. **Step 4:** Visual check, tsc, biome, roles/cross-tenant/architecture suites. **Step 5:** Commit `feat(reports): company analytics and exports`.

---

### Task 11: Whole-branch verification (orchestrator, then Opus review)

- [ ] **Step 1:** `pnpm vitest run` (one process), `pnpm tsc --noEmit`, `pnpm biome check` on every changed file.
- [ ] **Step 2: Visual and accessibility pass** in the browser pane with the demo seed on a local dev server (`.claude/launch.json`): Overview, data rooms list, data room detail, update detail, documents, e-sign list and detail, Reports; at 1280 px and 375 px, light theme, with and without data; keyboard-only walk through range tabs, chips, table, side sheet, CSV button; check every chart has its text alternative. Save screenshots in the SDD directory.
- [ ] **Step 3:** Opus whole-branch review with the Review Focus list and the permission matrix; one fix wave; one scoped re-review.
- [ ] **Step 4:** Open the PR; wait for Tests and Image workflows.

---

### Task 12: Release together with PR #31 (orchestrator, each step needs the owner's approval)

PR #31 is already merged to `main`, so the image built from `main` contains it; there is nothing separate to deploy.

- [ ] **Step 1:** Merge this PR (owner approves). Wait for the Image workflow; record the full-SHA tag.
- [ ] **Step 2:** Neon backup branch `pre-analytics-<date>` from `production`; apply `20261016000000_view_doc_seconds` by hand with the `_prisma_migrations` row (sha256 of the file), before switching the image. The column is additive and nullable; the running image ignores it.
- [ ] **Step 3:** Deploy the image (compose backup, switch, recreate `app`, wait healthy), not between 06:30 and 07:30 UTC (digest run).
- [ ] **Step 4: Production verification with the owner:** Overview shows real numbers that match the Cap table data; open a data room link on a phone, confirm the visit, per-page seconds and per-document completion appear within a minute; e-sign list shows funnel and filters; Reports page tabs and CSV export (open the CSV, check it opens cleanly); a member with `audits:read` only sees no money. Delete any test rows with approval.
- [ ] **Step 5:** Update the production-state memory note.

Rollback: previous compose backup; the old image runs against the migrated schema.

---

## Self-review

- **Coverage:** Overview real data (Task 4); graphs on documents, data rooms, updates (Tasks 5–7); e-sign graphs, funnel, filters, pagination (Tasks 8–9); Reports page (Task 10); filters and pagination in every list (Global Constraints, Tasks 5–10); CSV (Tasks 2, 6, 9, 10); both money figures (Task 4); engagement labels (Tasks 2, 5, 6); release with PR #31 (Task 12).
- **Placeholders:** UI tasks specify components, props, data and acceptance rather than JSX; every server task has its types, tests and queries named. Task 7 depends on Task 5's `documentsSummary` and says so.
- **Type consistency:** `ViewerRow`, `DocumentAnalytics`, `EsignAnalytics`, `OverviewSummary`, `delta`, `engagement`, `toCsv`, `parseRange` are defined once and used with the same names later.
- **Known limits (documented as `shortcut:` in code):** UTC day buckets; 5,000-row exports; 400-day max range; engagement weights are heuristics and shown with raw numbers.
- **Out of scope:** the Cap table page (still "Work in progress"), scenario/dilution modelling, per-company timezone, auto-reminders, download tracking.
