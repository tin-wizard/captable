# Option A "exact" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the logged-in app match the approved Option A mockup (Inter UI at 14.5-15px, Newsreader serif for page titles, panel titles and big numbers, grouped sidebar, ownership table with share bars, activity rows, KPI strip).

**Architecture:** PR #47 already applied the colour/token/shape layer. This adds the type layer (Newsreader via `next/font`, serif for headings and figures, larger UI sizes) and the presentational markup the mockup needs (static sidebar group labels, ownership table in place of the donut, hairline activity rows, KPI strip look).

**Tech Stack:** Next.js 16, Tailwind, `next/font/google`, Remix icons, Biome.

**Spec:** `docs/design/option-e-mockup.html` (E layout) plus the type settings of Option A in `/private/tmp/claude-501/-Users-developer-Projects-captable-subdomains/29285b40-0914-40a6-990f-39fb9d1f95be/scratchpad/deal-room-mockup-fonts-static.html` (`data-f="A"` block). Copy that file to `docs/design/option-a-type.html` in Task 1.

## Global Constraints

- **Presentation only.** Allowed: `className` strings, CSS/tokens, `next/font` setup, Tailwind theme values, and **presentational markup**: wrapper elements, static text labels with no data, rearranging how EXISTING props/data are displayed. **Forbidden: any change to data, queries, tRPC calls, props passed in or out of components, hrefs/routes, the sidebar `navigation`/`company` arrays' items, order, hrefs or active logic, handlers, hooks, conditions that decide what is shown, aria/data attributes that carry behaviour, component APIs, tests, and the paths `src/server`, `src/trpc`, `src/proxy.ts`, `src/app/api`, `prisma`, `e2e`, `tests`, `src/emails`, `src/jobs`, `src/lib`.**
- Do not add the mockup's breadcrumb text ("Company / Overview"): it needs company-name plumbing into the top bar, which is a wiring change. Leave the top bar as is.
- Type: body/UI text `text-[14.5px]`-`text-[15px]` (nav 14.5px, table/body 14px, labels 12.5px); Inter for UI; Newsreader (`font-serif` utility, weight 500, tracking -0.01em, lining + tabular numerals) for: page titles (`h1-h3` and the `PageLayout` title, 32-34px), panel titles (19px), big stat numbers (36px) and KPI numbers (24px), company name in the switcher (15px, 500).
- Palette, radius and borders as already shipped (steel blue `#2b4c7e`, hairline `#e2e4e7`, 4px radius).
- Accessibility: contrast >= 4.5:1, visible focus ring, hit targets >= 32px, `font-display: swap`, `lang` unchanged; numbers keep `tabular-nums`; truncation (`min-w-0 truncate`) kept on stat values.
- New branch `design/option-a-exact` from `origin/main`, worktree `/Users/developer/Projects/captable-design-refresh`. Pre-commit hook: never `--no-verify`; a `// biome-ignore <rule>: pre-existing, design-only change` comment above the exact offending line is allowed, otherwise skip the file and report.

## Review Focus

- Serif figures overflow or wrap in narrow stat cells at 375px (34-36px serif is wider than 28px Inter).
- Newsreader fails to load: fallback must be a serif that does not shift layout (`adjustFontFallback`), no invisible text.
- Ownership table with 0 slices (empty state) and with many slices (9+) and long stakeholder names (truncate).
- Sidebar group labels never change nav order/links; mobile drawer shows the same labels.
- Existing toggles (Ownership by class/stakeholder) still work and stay keyboard accessible.

## Model routing

| Task | `model` | `subagent_type` | Justification |
|------|---------|-----------------|---------------|
| 1. Serif font + type scale | `sonnet` | `general-purpose` | Font setup + class edits, no logic |
| 2. Overview: ownership table, activity rows, KPI strip | `sonnet` | `general-purpose` | Presentational markup over existing data; judgement needed |
| 3. Sidebar groups + shell type | `sonnet` | `general-purpose` | Presentational markup; must not touch nav data |
| Per-task review | `sonnet` | `general-purpose` | Per matrix; `opus` for the final whole-branch behaviour-preservation review |

---

### Task 1: Serif font and type scale

**Files:** Modify `src/styles/fonts.ts`, `src/app/layout.tsx` (add the font variable class only), `tailwind.config.ts` (`fontFamily.serif`), `src/styles/globals.css` (base heading font), `src/components/dashboard/page-layout/index.tsx`, `src/components/analytics/stat-card.tsx`, `src/components/ui/card.tsx` (CardTitle), `src/components/dashboard/sidebar/company-switcher.tsx` (name only), `src/components/analytics/chart-card.tsx` (title); Create `docs/design/option-a-type.html`.

**Interfaces:** Produces `font-serif` (Newsreader, `--font-newsreader`) and the sizes in Global Constraints.

- [ ] Add `export const newsreader = Newsreader({ subsets: ["latin"], display: "swap", variable: "--font-newsreader" })` in `src/styles/fonts.ts`; add `newsreader.variable` next to the other variables in `layout.tsx`'s `className`.
- [ ] Tailwind `fontFamily.serif: ["var(--font-newsreader)", "Georgia", "serif"]`.
- [ ] `globals.css`: `h1, h2, h3` (and `.h1-.h3`) use the serif at weight 500, `tracking-[-0.01em]`, `font-variant-numeric: lining-nums`; `h4` stays Inter. Body font-size base for UI stays 16px; sizes below are set by classes.
- [ ] Page title (`PageLayout` h3 and the Overview `<h3>`): `font-serif text-[32px] font-medium leading-tight`. CardTitle and ChartCard title: `font-serif text-[19px] font-medium`. StatCard value: `font-serif text-[36px] font-medium` (keep `min-w-0 truncate`, `max-sm:text-2xl`). Company switcher name: `font-serif text-[15px] font-medium`.
- [ ] Verify: `pnpm tsc --noEmit` (only the 4 pre-existing TS2307 `@/assets` errors), biome on changed files, Guard (no forbidden paths), diff shows only classes/font setup. Commit `style: serif headings and figures (Option A type)`.

### Task 2: Overview markup

**Files:** Modify `src/components/dashboard/overview/{ownership-card,activities-card}.tsx`, `src/components/analytics/chart-card.tsx`, `src/app/(authenticated)/(dashboard)/[publicId]/page.tsx` (classes only), as needed `src/components/analytics/stat-card.tsx`.

**Interfaces:** Consumes existing `byClass` / `byStakeholder` props (`{name, shares, pct}`), the `by` state and its toggle.

- [ ] `OwnershipCard`: replace the DonutChart + legend with a table: columns `Holder`, `Shares` (right, `formatCount`), `Ownership` (right: a 6px bar `bg-primary/85` with width = pct%, then `formatPercent(pct)`). Keep the by-class/by-stakeholder toggle, the empty state, truncation (`max-w-[16rem] truncate` on names), `tabular-nums`, header `bg-muted`-ish row like the mockup. Remove the now-unused DonutChart/COLORS imports ONLY if nothing else uses them. The data transformations and the `by` state stay exactly as they are.
- [ ] `ActivityCard`: render each item as a hairline-separated row (`border-b`, `px-4 py-3`): summary on top (14px, foreground), below it `small` time + (keep `dayjsExt().to(...)`), drop the avatar/connector timeline decorations (presentational). Keep the query, the "No activities to show" state and the "View all activity" link with its href.
- [ ] KPI strip ("Views this week / Not opened yet / Awaiting signatures"): serif 24px numbers, 14px muted labels, one bordered strip with dividers (class edits on existing StatCards).
- [ ] Verify as Task 1; additionally state that no prop, query, href, condition or text changed except removed decoration. Commit `style: overview ownership table, activity rows and KPI strip`.

### Task 3: Sidebar groups

**Files:** Modify `src/components/dashboard/sidebar/index.tsx` (render only), mobile drawer if it renders its own list.

- [ ] Insert static, non-link group labels `Equity`, `Deals`, `Company` (10.5px, uppercase, tracking .1em, `text-muted-foreground`, `px-2.5 pt-3.5 pb-1.5`, `aria-hidden`) in the existing render loop by item NAME: before Overview (`Equity`), before Fundraise (`Deals`); the existing "Company" label stays before Team/Settings. The `navigation` array's items, order, hrefs and active logic are NOT modified; labels are derived in render by comparing `item.name`.
- [ ] Nav item size 14.5px, active weight 500 (class edits in `nav-link.tsx` and the accordion trigger).
- [ ] Verify as Task 1. Commit `style: sidebar group labels and nav type`.

### Task 4: Final review (orchestrator)

- [ ] tsc, biome on changed files, Guard, `git diff --stat origin/main`.
- [ ] Opus whole-branch review: confirm only presentation changed (data, props, queries, hrefs, nav array untouched).
- [ ] Open PR; deploy only after the user approves.
