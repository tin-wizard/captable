# Design Refresh ("Swiss Institutional") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole logged-in app to the approved "Option E / Swiss Institutional" look: white ground, graphite text, one steel blue, strict grid, hairline borders, tabular numbers, Inter Tight headings. **Visual change only.**

**Architecture:** The app already themes through shadcn CSS variables (`src/styles/globals.css`) and `cn()` class strings. Change the tokens first so most screens move together, then the shared `ui/*` primitives, then the shell (sidebar, navbar, page header), then the Overview, then a sweep for hard-coded colours. No new dependencies; Inter and Inter Tight are already loaded in `src/styles/fonts`.

**Tech Stack:** Next.js 16, Tailwind (shadcn tokens), Remix icons, vitest, Biome, Playwright smoke.

**Spec:** Approved mockup `/private/tmp/claude-501/-Users-developer-Projects-captable-subdomains/29285b40-0914-40a6-990f-39fb9d1f95be/scratchpad/deal-room-design-options-2.html`, Option E. Copy it to `docs/design/option-e-mockup.html` in Task 1 so the spec travels with the repo.

## Global Constraints

- **DESIGN ONLY. Do not change wiring, routing, data, props, handlers, hooks, queries, text content, link targets, `href`s, ids, `aria-*`, `data-*`, form names, or component APIs.** If a visual goal seems to need one of these, stop and ask.
- Allowed edits: `className` strings, `cva` variant class strings, `src/styles/globals.css`, `tailwind.config.ts` theme values, `src/styles/fonts.ts` only to add weights, and static presentational wrappers that change no behaviour. Icons may be swapped only for a visually matching Remix icon already used elsewhere; do not touch which route a link goes to.
- Forbidden paths (never edited): `src/server/**`, `src/trpc/**`, `src/proxy.ts`, `src/app/api/**`, `prisma/**`, `src/lib/**` except `constants.ts` is also forbidden, `e2e/**`, `tests/**`, `src/emails/**`, `src/jobs/**`, `src/app/**/route.ts`, any `*.test.ts`.
- Palette (HSL for tokens): background `0 0% 100%`; foreground `210 14% 9%` (graphite `#14171a`); muted text `213 8% 43%` (`#6a7078`); border `216 11% 90%` (`#e2e4e7`); sidebar/subtle surface `210 14% 97%` (`#f7f8f9`); primary and accent `215 49% 33%` (`#2b4c7e`). No other chromatic colour. Status colours (destructive, success, warning) stay as they are, used sparingly.
- Shape: radius `0.25rem` (4px) on cards, inputs, buttons; no drop shadows on cards (1px border only); focus ring uses primary, not orange.
- Type: Inter for body, Inter Tight for headings; numbers use `tabular-nums`; page title 24px/600, no 48px+ headings inside the app; sentence case labels.
- Accessibility: body text contrast ≥ 4.5:1, visible focus ring on every interactive element, hit targets unchanged.
- Dark mode (`.dark` tokens) must keep working: retune to neutral graphite, same single accent.
- Work on a new branch `design/institutional-refresh` from `origin/main` in a fresh worktree. Do not use `/Users/developer/Projects/captable-subdomains` (it has unrelated uncommitted work).

## Review Focus

- Long company names and long stakeholder/document names truncate or wrap without breaking the sidebar or table layout.
- Tables with many columns still scroll horizontally on a phone instead of overflowing the page.
- Empty states (no holdings, no activity) still look finished, not broken, with the new borders.
- Every screen's focus ring and disabled/hover states remain visible on white and on the `#f7f8f9` surface.
- Dark mode toggled on still shows readable text and borders on every touched screen.

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Tokens, fonts, mockup copy | `sonnet` | `general-purpose` | Few files but every screen depends on exact values |
| 2. UI primitives | `sonnet` | `general-purpose` | Multi-file class-string edits with judgment, no logic |
| 3. App shell | `sonnet` | `general-purpose` | Multi-file layout work; must not touch nav data or routes |
| 4. Overview | `sonnet` | `general-purpose` | Component styling only |
| 5. Colour sweep | `sonnet` | `general-purpose` | Many files, mechanical but needs judgment per hit |
| Per-task review | `sonnet` | `general-purpose` | Checks diff is class-only; `opus` if any non-class line appears |
| 6. Verify and final review | `opus` (review), orchestrator runs browser and CI | `general-purpose` | Whole-branch review; browser checks stay with the orchestrator |

## Guard (run after every task, must print nothing)

```bash
git diff --name-only origin/main | grep -E '^(src/server|src/trpc|src/proxy|src/app/api|prisma|e2e|tests|src/emails|src/jobs)|route\.ts$|\.test\.ts$|src/lib/' ; \
git diff -U0 origin/main -- 'src/**/*.tsx' | grep -E '^[+-][^+-]' | grep -vE 'className|cn\(|cva\(|variants|^[+-]\s*["`'"'"'][^"`'"'"']*["`'"'"'],?$|^[+-]\s*(\)|\}|\{|,)*\s*$' | head
```

Any output means a non-style line changed: inspect it by hand and revert unless it is a pure class string.

---

### Task 1: Tokens and type

**Files:**
- Modify: `src/styles/globals.css` (`:root`, `.dark`, base heading sizes), `tailwind.config.ts` (radius, font family only if needed), `src/styles/fonts.ts` (add Inter Tight 500/600 only if missing)
- Create: `docs/design/option-e-mockup.html` (copy of the spec mockup)

**Interfaces:**
- Produces: the Global Constraints palette as shadcn tokens (`--background`, `--foreground`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--primary`, `--accent`, `--secondary`, `--card`, `--popover`, `--radius: 0.25rem`), plus a `.tabular` utility (`font-variant-numeric: tabular-nums`) for later tasks.

- [ ] **Step 1: Read `tailwind.config.ts` and `src/styles/fonts.ts`; note current radius, font and colour mapping.**
- [ ] **Step 2: Replace `:root` and `.dark` token values per Global Constraints.** Keep every token name. `--ring` becomes the primary value. Dark: background `210 14% 8%`, card `210 14% 10%`, border `210 10% 20%`, same primary lightened to `215 55% 68%`.
- [ ] **Step 3: Rebase the heading scale** in `@layer base`: `h1` `text-3xl`, `h2` `text-2xl`, `h3` `text-2xl font-semibold tracking-tight` (no `sm:text-3xl`), `h4` `text-base font-semibold`. Login pages use these; check `src/app/(auth)` still reads sensibly in Step 5.
- [ ] **Step 4: Add `.tabular` to `@layer utilities`.**
- [ ] **Step 5: Run `pnpm tsc --noEmit` and `pnpm biome check src/styles` → no errors. Start the dev server, open `/login` and one dashboard page, confirm nothing is unreadable.**
- [ ] **Step 6: Run the Guard (prints nothing). Commit:** `style: institutional design tokens and type scale`.

### Task 2: UI primitives

**Files:**
- Modify (class strings only): `src/components/ui/{card,button,badge,input,table,tabs,select,dialog,dropdown-menu,dropdown-button,textarea,checkbox,popover,sheet}.tsx` (only those that exist)

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: `Card` = `rounded border bg-card` with no shadow; `CardTitle` `text-base font-semibold`; `Table` header `bg-muted/40 text-xs font-medium text-muted-foreground`, row borders `border-b`, cells `tabular-nums`; `Button` default = solid primary, outline = 1px border graphite-on-white, radius from token; `Badge` quiet (border + muted text) except destructive.

- [ ] **Step 1: Edit each primitive's class strings only; keep every prop, variant name and export.**
- [ ] **Step 2: Run `pnpm tsc --noEmit` and `pnpm vitest run src/components` → unchanged pass count.**
- [ ] **Step 3: Open Stakeholders, Share classes, Documents (tables), Team (forms) and one dialog in the browser; confirm layout, focus ring, disabled state.**
- [ ] **Step 4: Guard; commit:** `style: restyle ui primitives to institutional look`.

### Task 3: App shell

**Files:**
- Modify (class strings only): `src/components/dashboard/sidebar/{index,nav-link,company-switcher}.tsx`, `src/components/dashboard/navbar/{index,mobile-drawer,user-dropdown,command-menu}.tsx`, `src/components/dashboard/page-layout/index.tsx`, the dashboard `layout.tsx` wrapper classes

**Interfaces:**
- Produces: sidebar bg `bg-muted/50` with right border; nav items `rounded px-2.5 py-1.5 text-[13.5px]`, active `bg-secondary font-semibold text-foreground`, icons 16–17px `text-muted-foreground`; "Company" group label uppercase `text-[10.5px] tracking-[.1em]`; top bar white, `h-12`, bottom border, search styled as a bordered button; `PageLayout` title `text-2xl font-semibold`.
- The `navigation` and `company` arrays, active-route logic and `href`s are NOT touched.

- [ ] **Step 1: Restyle per Interfaces; do not edit any array, condition or handler.**
- [ ] **Step 2: Check at 1440, 1024 and 375 px: sidebar, drawer, switcher dropdown, user menu, command menu. Long company name truncates.**
- [ ] **Step 3: Click through every nav item and the company switcher: every route still loads (same URLs as before the change).**
- [ ] **Step 4: Guard; commit:** `style: institutional app shell`.

### Task 4: Overview

**Files:**
- Modify (class strings only): `src/app/(authenticated)/(dashboard)/[publicId]/page.tsx`, `src/components/dashboard/overview/{ownership-card,summary-table,activities-card,empty}.tsx`, `src/components/analytics/*` (`StatCard` and friends)

**Interfaces:**
- Produces: stat strip as one bordered grid with hairline dividers, numbers `text-[28px] font-medium tabular-nums tracking-tight`, label `text-xs text-muted-foreground`; panels with `border rounded` and a header row; ownership table with in-cell share bars using `bg-primary/85`; chart colours from one blue ramp.

- [ ] **Step 1: Restyle per Interfaces; keep every query, prop, `hint`, delta and formatter call as is.**
- [ ] **Step 2: Screenshot with data (Konnect) and empty (Lock'd) at 1440 and 375 px.**
- [ ] **Step 3: Guard; commit:** `style: institutional overview`.

### Task 5: Colour and shadow sweep

**Files:**
- Modify (class strings only): any remaining `src/app/(authenticated)/**` and `src/components/**` file the search below turns up

- [ ] **Step 1: List hits:** `rg -n "bg-(gray|slate|zinc|blue|indigo|orange)-|text-(gray|slate|blue|indigo|orange)-|border-(gray|slate)-|shadow-(md|lg|xl)|rounded-(xl|2xl|3xl)" src/app src/components -g '*.tsx'`.
- [ ] **Step 2: Replace with tokens** (`bg-muted`, `text-muted-foreground`, `border`, `text-primary`, `rounded`), leaving semantic status colours and chart palettes alone. Skip `src/emails`, `src/components/auth/*` brand animation, and public share/data-room viewer pages unless the user later asks.
- [ ] **Step 3: Open each changed screen once (list them in the commit body). Guard; commit:** `style: replace hard-coded colours with tokens`.

### Task 6: Verify and review

- [ ] **Step 1:** `pnpm tsc --noEmit`, `pnpm biome check src`, `pnpm vitest run` (DB-backed tests may need CI), `pnpm playwright test e2e/smoke.spec.ts` → all pass as on `origin/main`.
- [ ] **Step 2:** Guard prints nothing; `git diff --stat origin/main` shows only allowed paths.
- [ ] **Step 3:** Browser pass in light and dark, 1440 and 375 px, on: Overview, Cap table, Stakeholders, Share classes, Documents, Data rooms, Settings, Team, one dialog. Fix defects in one batch.
- [ ] **Step 4:** `opus` reviewer reads the whole diff and confirms in writing that no non-style line changed.
- [ ] **Step 5:** Open a PR. Deploy only after the user approves (image build and restart by the orchestrator).
