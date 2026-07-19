# Ad Performance — scope/period filters and move to Overview: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Ad Performance tab from Growth to Overview, render the shared ScopePeriodBar on it, and state honestly what a practice selection does and does not scope.

**Architecture:** Frontend only, three files. The screen already consumes `useScopePeriod()` and passes `since`/`until`/`practiceId` to both queries, and the backend Zod schema already accepts all three — so no data plumbing is built, only the missing control and the copy that explains its limits. Navigation is data-driven from a single `NAV` array, so moving the tab is moving one array entry.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind, React Query.

**Spec:** `docs/superpowers/specs/2026-07-19-ad-performance-scope-filters-and-overview-move-design.md`

## Global Constraints

- Frontend only. No backend, repository, migration or connector change.
- British English in all user-facing strings (organisation, colour, optimise, centre).
- No dark mode — light/white only.
- No emojis in code or UI.
- Money in integer pence. `null` means "not known", never zero. Never render a fabricated `£0`.
- The React Query key prefix `'ad-performance'` must not be restructured — settings mutations invalidate on it.
- Reuse `features/_shared/ScopePeriodBar.tsx`. Do not fork a second filter bar.
- Frontend has **no test framework** and CI does not run frontend tests (`.github/workflows/ci.yml` frontend job runs typecheck/lint/build only). Verification is `npm run typecheck`, `npm run lint`, `npm run build`, plus the manual checks written into each task. TDD is not available here; do not invent a test harness.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/lib/nav.ts` | Modify | Single source for sidebar + section tabs. Move one item between two arrays. |
| `frontend/features/ad-performance/components/AdPerformanceScreen.tsx` | Modify | Render the filter bar; add the two practice-scope messages. |

No files are created. No component is extracted — the additions are two short conditional blocks in a file that already holds four similar ones, and splitting them out would scatter closely-related copy.

## Already done — do not re-implement

The spec's §3 "group-wide qualifier on the two counters" is **already in the code**. `AdPerformanceScreen.tsx:163-196` (the Mapping health `SectionCard`) already states, for `unmappedPipelineCount`, "This count is group-wide — it is not narrowed by the practice selector above", and for `excludedUnmappedLeads`, "This count is also group-wide, computed before any practice filter, so it does not shrink when you scope to one practice." Leave that section untouched.

---

### Task 1: Move the Ad Performance tab to Overview

**Files:**
- Modify: `frontend/lib/nav.ts:22-36` (Overview `items`) and `frontend/lib/nav.ts:62-69` (Growth `items`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks. `NavItem` shape is unchanged: `{ id: string; label: string; isNew?: boolean }`.

- [ ] **Step 1: Remove the item from the Growth section**

In `frontend/lib/nav.ts`, find the Growth section and delete the `ad-performance` line:

```ts
  { label: 'Growth', items: [
    { id: 'patients', label: 'Patients' },
    { id: 'marketing', label: 'Marketing & ROI' },
    { id: 'loyalty', label: 'Loyalty & Members' },
    { id: 'booking', label: 'Online Booking' },
    { id: 'benchmark', label: 'Benchmark' },
  ]},
```

- [ ] **Step 2: Insert it into the Overview section, directly after Daily Cockpit**

In the same file, the Overview section's first two entries become:

```ts
  { label: 'Overview', items: [
    { id: 'cockpit', label: 'Daily Cockpit', isNew: true },
    { id: 'ad-performance', label: 'Ad Performance', isNew: true },
    { id: 'dashboard', label: 'Command Centre' },
```

Leave the remaining Overview items in their existing order. Note `isNew: true` is preserved — it was on the original entry.

- [ ] **Step 3: Verify the id appears exactly once**

Run from the repo root:

```bash
grep -n "ad-performance" frontend/lib/nav.ts
```

Expected: exactly one line, inside the Overview block. If two lines appear, Step 1's deletion did not apply.

- [ ] **Step 4: Typecheck and lint**

Run from `frontend/`:

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0. `nav.ts` is a plain array literal, so a failure here means a stray comma or bracket from the edit.

- [ ] **Step 5: Manual check**

Run `npm run dev` in `frontend/`, log in, and visit `/ad-performance`.

Expected: the section tab bar above the page shows the **Overview** tabs (Daily Cockpit, Ad Performance, Command Centre, …) and "Ad Performance" is the active tab. The left sidebar lists Ad Performance under Overview, and it is **absent** from Growth. Both come from `NAV` via `sectionForRoute()` (`nav.ts:100`), so if the tab bar is right the sidebar is too.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/nav.ts
git commit -m "feat(ads): move Ad Performance from Growth to Overview"
```

---

### Task 2: Render the shared ScopePeriodBar

**Files:**
- Modify: `frontend/features/ad-performance/components/AdPerformanceScreen.tsx` (import block ~line 20-30; the early returns at lines 84-85; the `return` body starting line 87)

**Interfaces:**
- Consumes: `ScopePeriodBar` from `@/features/_shared/ScopePeriodBar` — signature `ScopePeriodBar({ hideScope?: boolean; dentallyOnly?: boolean }?)`, called here with **no props**.
- Produces: `function Frame({ children }: { children: React.ReactNode })` — a module-scope component in `AdPerformanceScreen.tsx` rendering `PageHeader` + `ScopePeriodBar` + children inside `<div className="space-y-4">`. Task 3 renders its messages as the first children of this frame.

The problem this task solves is not only "the bar is missing". The screen currently early-returns on loading and error **before** rendering anything, at:

```tsx
  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (error || !data) return <p className="p-6 text-sm text-slate-500">Could not load ad performance.</p>;
```

If the bar were simply added below `<PageHeader>` inside the main return, it would disappear while loading and after a failure — leaving no way to change a window that failed to load, and making every filter change flash the whole chrome away. So the header and bar move above the early returns.

- [ ] **Step 1: Add the import**

In the import block of `AdPerformanceScreen.tsx`, directly below the existing `useScopePeriod` import, add:

```tsx
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
```

The existing line to anchor on is:

```tsx
import { useScopePeriod } from '@/features/_shared/scope-context';
```

Do **not** pass `dentallyOnly`. That flag drops practices whose `pms_site_id` is null, which is a Dentally-feed concern; ad attribution resolves practices through GoHighLevel subaccounts (`integration_accounts.practice_id`), so passing it would hide practices that genuinely have ad leads.

- [ ] **Step 2: Define the frame at module scope**

`Frame` MUST be declared at module scope, **not** inside `AdPerformanceScreen`. A component defined inside a render function is a new function identity on every render, so React unmounts and remounts the entire subtree each time — the month selector would lose focus mid-interaction and the page would flicker on every filter change.

In `AdPerformanceScreen.tsx`, directly above `export default function AdPerformanceScreen() {`, add:

```tsx
// The header and filter bar render in every state, including loading and
// error. If they only rendered on success, a window that failed to load would
// leave the operator with no control to change it, and every filter change
// would flash the whole page chrome away.
//
// Declared at module scope on purpose: a component defined inside the render
// function gets a new identity each render, which remounts the whole subtree
// and drops focus from the month selector.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Ad performance"
        subtitle="Google and Facebook leads, cost per lead and conversions, from the pipelines you have mapped to each channel."
      />
      <ScopePeriodBar />
      {children}
    </div>
  );
}
```

- [ ] **Step 2b: Wrap the early returns in it**

Replace these two lines:

```tsx
  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (error || !data) return <p className="p-6 text-sm text-slate-500">Could not load ad performance.</p>;
```

with:

```tsx
  if (isLoading) return <Frame><p className="text-sm text-slate-500">Loading…</p></Frame>;
  if (error || !data) {
    return <Frame><p className="text-sm text-slate-500">Could not load ad performance.</p></Frame>;
  }
```

Note the `p-6` padding is dropped from the two messages — inside `Frame` they sit in the page's normal flow, and `p-6` would indent them relative to everything else.

- [ ] **Step 3: Use the frame in the success return**

In the main `return`, replace the opening wrapper and `PageHeader`:

```tsx
  return (
    <div className="space-y-4">
      <PageHeader
        title="Ad performance"
        subtitle="Google and Facebook leads, cost per lead and conversions, from the pipelines you have mapped to each channel."
      />

      {nothingMapped ? (
```

with:

```tsx
  return (
    <Frame>
      {nothingMapped ? (
```

Then change the matching closing tag at the very end of the component from `</div>` to `</Frame>`:

```tsx
      ) : null}
    </Frame>
  );
}
```

The `</div>` to replace is the last one before the final `);` and `}`, immediately after the Mapping health `{hasMappingGap ? (...) : null}` block.

- [ ] **Step 4: Typecheck and lint**

Run from `frontend/`:

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0. A "JSX element has no corresponding closing tag" error means Step 3's closing-tag swap was missed or applied to the wrong `</div>`.

- [ ] **Step 5: Build**

Run from `frontend/`:

```bash
npm run build
```

Expected: exits 0. `ScopePeriodBar` is a `'use client'` component and `AdPerformanceScreen` is already `'use client'`, so no server/client boundary error should appear.

- [ ] **Step 6: Manual check**

With `npm run dev`, visit `/ad-performance`.

Expected:
- A practice chip row (All practices, Rochester, Ashford, Barnet, Bexleyheath (Fixed Teeth Solutions), Warwick Lodge) and a period row (This month, This year, Pick month, Custom + month selector) render below the page title — the same control as `/cockpit`.
- Clicking a different practice or month refetches and visibly changes the leads and conversions figures.
- The bar stays on screen during the refetch, rather than being replaced by a bare "Loading…".
- The URL gains `?scope=<uuid>` / `?month=YYYY-MM`; reloading that URL restores the same selection.

- [ ] **Step 7: Commit**

```bash
git add frontend/features/ad-performance/components/AdPerformanceScreen.tsx
git commit -m "feat(ads): render the shared scope/period bar on Ad Performance"
```

---

### Task 3: State what a practice selection does not scope

**Files:**
- Modify: `frontend/features/ad-performance/components/AdPerformanceScreen.tsx` (derived flags near lines 87-93; JSX inside `Frame` before `<ChannelScorecard>`)

**Interfaces:**
- Consumes: `Frame` from Task 2. `useScopePeriod()` returns `{ scope: 'all' | string, ... }`. `data.totals` is `AdTotals` with `spendPence: number | null` and `leads: number` (`features/ad-performance/api.ts:34-45`).
- Produces: nothing consumed by later tasks.

Two facts, both verified against the hosted database and `backend/src/services/ad-attribution.service.js`:

1. Per-practice **spend** is always absent. `adSpend` splits on `ad_metrics.practice_id` (`service.js:316-319`), a column both connectors hardcode to `null` (`google-ads-sync.js:153`, `meta-ads-sync.js:219`); all 10,691 live rows have it null. So `totals.spendPence`, cost per lead and cost per acquisition come back `null` for any practice selection, while leads and conversions are real.
2. A practice with **no leads** in the window is indistinguishable from a measured zero — `byPractice[0]` is undefined and the service substitutes synthetic zeros (`service.js:476-481`).

Without copy, the first looks like a broken page and the second looks like a real £0.

- [ ] **Step 1: Add the derived flags**

In `AdPerformanceScreen.tsx`, just below the existing `hasMappingGap` line:

```tsx
  const hasMappingGap = data.unmappedPipelineCount > 0 || data.excludedUnmappedLeads > 0;
```

add:

```tsx
  // A practice selection scopes leads, conversions, accepted value and the
  // trend, but not spend: ad_metrics.practice_id is null on every synced row,
  // so per-practice spend, cost per lead and cost per acquisition come back
  // null. Say so rather than letting the operator read blank tiles as a fault.
  const practiceSelected = sp.scope !== 'all';
  const spendIsGroupWide = practiceSelected && data.totals.spendPence === null;
  // With no leads for this practice the service returns synthetic zeros, which
  // would otherwise read as a measured result rather than an absence.
  const practiceHasNoLeads = practiceSelected && data.totals.leads === 0;
```

- [ ] **Step 2: Render the two messages**

Inside the main `return`, immediately after `<Frame>` and **before** the existing `{nothingMapped ? (` block, insert:

```tsx
      {spendIsGroupWide ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">
          Leads, conversions and treatment value are for this practice. Spend, cost per lead
          and cost per acquisition remain group-wide — no ad account is mapped to a practice
          yet, so advertising spend cannot be split between them.{' '}
          <a className="underline" href="/settings/ad-attribution">Map ad accounts to practices</a>.
        </div>
      ) : null}

      {practiceHasNoLeads ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">
          No ad leads are attributed to this practice in this window. The figures below are
          zero because there is nothing to count, not because the campaigns measured zero.
        </div>
      ) : null}
```

The neutral slate styling matches the existing `mappedButQuiet` banner in the same file. Amber is reserved for a fault the operator introduced; neither of these is one.

- [ ] **Step 3: Typecheck and lint**

Run from `frontend/`:

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0. If typecheck reports `spendPence` is `number` rather than `number | null`, the wrong `totals` type is in scope — confirm against `features/ad-performance/api.ts:40`.

- [ ] **Step 4: Build**

Run from `frontend/`:

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Manual check — group view unchanged**

With `npm run dev`, visit `/ad-performance` with **All practices** selected.

Expected: neither new message appears, and the spend and cost-per-lead tiles show real figures. Both messages are gated on `practiceSelected`, so a regression here means `sp.scope !== 'all'` is evaluating wrongly.

- [ ] **Step 6: Manual check — practice view**

Select **Rochester**, period This year.

Expected: the group-scope message appears; leads and conversions show real non-zero figures; the spend, cost-per-lead and cost-per-acquisition tiles are blank or "Not reporting" — **never `£0`**. The Mapping health section's existing "This count is group-wide" wording still reads correctly alongside it.

- [ ] **Step 7: Manual check — empty practice**

Select a practice with no ad leads in the window — Warwick Lodge, or any practice with period Pick month set to a month before the ad feed starts (Google Ads data begins 2025-06-09 for Plan4growth).

Expected: the "No ad leads are attributed to this practice in this window" message appears above the zeroed tiles.

- [ ] **Step 8: Commit**

```bash
git add frontend/features/ad-performance/components/AdPerformanceScreen.tsx
git commit -m "fix(ads): disclose that spend stays group-wide when a practice is selected"
```

---

## Out of scope

Do not implement these here, even if they look adjacent:

- The backend spend-to-practice join. Specced separately in `2026-07-19-ad-attribution-mapping-health-and-spend-design.md` §4; it is inert until an operator maps ad accounts, and every live account is unmapped.
- Making `excludedUnmappedLeads` / `unmappedPipelineCount` genuinely practice-scoped — that is a backend change. The existing copy already labels them group-wide.
- Backfilling `ad_metrics.practice_id`, or any connector change.
- Any change to the Growth section beyond removing the one moved item.
