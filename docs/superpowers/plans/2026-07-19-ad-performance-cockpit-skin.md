# Ad Performance cockpit skin: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ad Performance screen render in the Daily Command Cockpit's visual language — grey page background, white bordered section cards, serif green heading, numbered section badges, mint-tinted tiles.

**Architecture:** The screen already imports the shared cockpit primitives (`SectionCard`, `SecHead`, `Kpi`) but never renders `s.shell`, and `cockpit.module.css` declares every theme variable on `.shell` with no `:root` fallback. So the components currently resolve `var(--bg)`, `var(--line)` and `var(--green)` against nothing. Task 1 supplies the variables by wrapping the screen, which fixes most of the appearance on its own; Tasks 2-4 clean up the parts still using raw Tailwind.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, CSS Modules (`cockpit.module.css`), Tailwind (being removed from these files).

**Spec:** `docs/superpowers/specs/2026-07-19-ad-performance-cockpit-skin-design.md`

## Global Constraints

- Frontend only, presentation only. Do NOT change data fetching, derived values, conditions, or user-facing copy. Every string stays byte-identical unless a step says otherwise.
- No dark mode (project rule 1). British English. No emojis in code or UI.
- Money stays integer pence. `money()` renders `null` as "Not reporting", never `£0`. Do NOT touch `frontend/features/ad-performance/format.ts`.
- Do NOT restructure the React Query key prefix `'ad-performance'`.
- `cockpit.module.css` is a CSS Module scoped so it "never leaks into the ~60 slate/white screens". Do NOT move its variables to `:root` and do NOT import it outside `components/ui`.
- Do NOT introduce `KpiTile` (`components/ui/KpiTile.tsx`). It is the legacy Tailwind primitive and looks different from the cockpit `Kpi`.
- The frontend has NO test framework and CI does not run frontend tests (CI frontend job = typecheck/lint/build only). Verification is `npm run typecheck`, `npm run lint`, `npm run build` from `frontend/`. Do NOT create a test file, test runner, or test config — there is no harness to add to.
- `Frame` in `AdPerformanceScreen.tsx` MUST stay at module scope. A component declared inside a render function gets a new identity every render, remounting the subtree and dropping focus from the month selector.

## The cockpit idiom (reference for every task)

Import: `import { SectionCard, SecHead, Kpi, DetailPanel, cx, cockpitStyles as s } from '@/components/ui';`

Table markup, as used at `CockpitScreen.tsx:205-218`:

```tsx
<div className={s.scrollX}>
  <table className={s.table} style={{ minWidth: 420 }}>
    <thead>
      <tr>
        <th>Practice</th>
        <th className={s.r}>Cash taken £</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Rochester</td>
        <td className={cx(s.r, s.money)}>£48,215.45</td>
      </tr>
    </tbody>
  </table>
</div>
```

Relevant module classes, all already defined in `frontend/components/ui/cockpit.module.css`:
`.shell` `.wrap` `.topbar` `.h1` `.sub` `.card` `.scrollX` `.table` `.r` (text-align: right) `.money` (tabular-nums, 600) `.totalRow` (tinted, bold td) `.footNote` (11.5px muted) `.stateBox` `.errorBox` `.subtle` (colour only — no font size).

In-card empty and loading text uses `<p className={s.subtle} style={{ fontSize: 13 }}>`. The inline size is not optional: `.subtle` sets only `color: var(--muted)`, so without it the text renders at base size. See `CockpitScreen.tsx:231`, `:320`, `:323`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/components/ui/cockpit.module.css` | Modify | Add two notice classes (Task 2 only). |
| `frontend/features/ad-performance/components/AdPerformanceScreen.tsx` | Modify | Shell wrapper + state boxes (Task 1); banners (Task 2). |
| `frontend/features/ad-performance/components/ByPracticeTable.tsx` | Modify | Table onto the module (Task 3). |
| `frontend/features/ad-performance/components/OverlapTable.tsx` | Modify | Table onto the module (Task 4). |

No files created. `ChannelScorecard.tsx`, `AttributionSection.tsx` and `ChannelTrend.tsx` are already on the skin and are NOT touched — they start rendering correctly the moment Task 1 supplies the variables.

---

### Task 1: Wrap the screen in the cockpit shell

**Files:**
- Modify: `frontend/features/ad-performance/components/AdPerformanceScreen.tsx` — imports (~line 12), `Frame` (~lines 68-87), loading/error returns (~lines 106-109)

**Interfaces:**
- Consumes: `cockpitStyles as s` and `cx` from `@/components/ui` (already exported there — `components/ui/index.ts:21`).
- Produces: a `Frame` that renders `s.shell > s.wrap > s.topbar`. Tasks 2-4 render inside it and rely on the theme variables it scopes.

This is the load-bearing task. `cockpit.module.css:9-34` puts `--bg`, `--line`, `--green`, `--tint2`, `--muted` and the rest on `.shell`. Until the screen renders `s.shell`, every `SectionCard` on it has a transparent background and a `currentColor` border.

- [ ] **Step 1: Update the imports**

The current import line is:

```tsx
import { PageHeader, SectionCard, SecHead, DetailPanel } from '@/components/ui';
```

Replace it with:

```tsx
import { SectionCard, SecHead, DetailPanel, cx, cockpitStyles as s } from '@/components/ui';
```

`PageHeader` is dropped — Step 2 replaces it. Leave every other import untouched.

- [ ] **Step 2: Rewrite `Frame` as the cockpit chrome**

Replace the whole `Frame` function. Current:

```tsx
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

New — this mirrors `CockpitScreen.tsx:921-937` exactly, so the two screens share one chrome:

```tsx
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.shell}>
      <div className={s.wrap}>
        <div className={s.topbar}>
          <div className={s.h1}>Ad performance</div>
          <div className={s.sub}>
            Google and Facebook leads, cost per lead and conversions, from the pipelines you
            have mapped to each channel.
          </div>
          <div style={{ marginTop: 14 }}>
            <ScopePeriodBar />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
```

Keep the existing comment block above `Frame` — including the note about module scope — unchanged. The title and subtitle strings are copied verbatim from the `PageHeader` they replace; do not reword them.

Note `space-y-4` is gone. Vertical rhythm now comes from `.card`'s own `margin-bottom: 16px`, which is how the cockpit spaces its sections.

- [ ] **Step 3: Move the state messages onto the module**

Replace:

```tsx
  if (isLoading) return <Frame><p className="text-sm text-slate-500">Loading…</p></Frame>;
  if (error || !data) {
    return <Frame><p className="text-sm text-slate-500">Could not load ad performance.</p></Frame>;
  }
```

with:

```tsx
  if (isLoading) return <Frame><div className={s.stateBox}>Loading…</div></Frame>;
  if (error || !data) {
    return (
      <Frame>
        <div className={cx(s.stateBox, s.errorBox)}>Could not load ad performance.</div>
      </Frame>
    );
  }
```

This matches `CockpitScreen.tsx:941-944`. Both stay inside `Frame`, so the header and filter bar remain on screen in every state — that is the property `Frame` exists to guarantee, and it must not regress.

- [ ] **Step 4: Verify no stale `PageHeader` reference remains**

Run from the repo root:

```bash
grep -n "PageHeader" frontend/features/ad-performance/components/AdPerformanceScreen.tsx
```

Expected: no output. Any hit means Step 1 or Step 2 was applied incompletely, and typecheck will fail on the removed import.

- [ ] **Step 5: Typecheck and lint**

Run from `frontend/`:

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0, lint prints "✔ No ESLint warnings or errors".

- [ ] **Step 6: Build**

Run from `frontend/`:

```bash
npm run build
```

Expected: exits 0, prints "✓ Compiled successfully" and lists `/ad-performance` in the route table.

- [ ] **Step 7: Commit**

```bash
git add frontend/features/ad-performance/components/AdPerformanceScreen.tsx
git commit -m "feat(ads): render Ad Performance in the cockpit shell

The screen already used the shared SectionCard/SecHead/Kpi primitives but
never rendered s.shell, where cockpit.module.css declares every theme
variable. They resolved --bg/--line/--green against nothing. Wrapping the
screen supplies them and adopts the cockpit's topbar chrome."
```

---

### Task 2: Notice classes for the banners

**Files:**
- Modify: `frontend/components/ui/cockpit.module.css` (append two classes)
- Modify: `frontend/features/ad-performance/components/AdPerformanceScreen.tsx` (five banner `className`s)

**Interfaces:**
- Consumes: `s` and `cx`, imported by Task 1.
- Produces: `s.notice` and `s.noticeWarn`, available to any screen using the kit.

The module has no callout class. Do NOT reuse `.note` — that is the `Kpi` sub-caption (`cockpit.module.css:201`) and repurposing it would restyle every tile on the cockpit.

- [ ] **Step 1: Add the two classes**

Append to the end of `frontend/components/ui/cockpit.module.css`:

```css
/* ---- inline notices ---- */
/* Page-level callouts. Distinct from .note, which is the Kpi sub-caption. */
.notice {
  background: var(--tint2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 13px;
  color: var(--ink);
  margin-bottom: 16px;
}
.noticeWarn {
  background: var(--amberbg);
  border-color: var(--amber);
  color: var(--amber);
}
```

`--tint2`, `--line`, `--ink`, `--amberbg` and `--amber` are all already declared on `.shell` (`cockpit.module.css:9-34`). Do not add new variables.

- [ ] **Step 2: Convert the four page-level banners**

In `AdPerformanceScreen.tsx`, change only the `className` on each of these five `div`s. Leave every condition, every string and the banner order exactly as they are.

`nothingMapped` — from `className="rounded border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900"` to:

```tsx
className={cx(s.notice, s.noticeWarn)}
```

`mappedButQuiet`, `spendIsGroupWide` and `practiceHasNoLeads` — each from `className="rounded border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700"` to:

```tsx
className={s.notice}
```

- [ ] **Step 3: Convert the truncation banner inside the detail panel**

Still in `AdPerformanceScreen.tsx`, inside the `DetailPanel`, the leads-truncation warning currently reads `className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900"`. Change it to:

```tsx
className={cx(s.notice, s.noticeWarn)}
```

`.notice` already carries `margin-bottom: 16px`, so the `mb-3` is dropped rather than kept.

- [ ] **Step 4: Confirm no raw banner styling remains**

Run from the repo root:

```bash
grep -n "bg-amber-50\|bg-slate-50" frontend/features/ad-performance/components/AdPerformanceScreen.tsx
```

Expected: no output.

- [ ] **Step 5: Typecheck, lint and build**

Run from `frontend/`:

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: all exit 0; lint prints "✔ No ESLint warnings or errors"; build prints "✓ Compiled successfully".

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ui/cockpit.module.css frontend/features/ad-performance/components/AdPerformanceScreen.tsx
git commit -m "feat(ads): notice classes so the banners use the cockpit palette

Adds .notice/.noticeWarn built from the module's existing variables and
moves the five Ad Performance banners onto them. Conditions, order and
copy are unchanged; amber still marks the one actionable setup gap."
```

---

### Task 3: `ByPracticeTable` onto the module table

**Files:**
- Modify: `frontend/features/ad-performance/components/ByPracticeTable.tsx`

**Interfaces:**
- Consumes: `s.scrollX`, `s.table`, `s.r`, `s.money`, `s.totalRow`, `s.footNote`, `s.subtle` and `cx` from `@/components/ui`.
- Produces: nothing consumed by later tasks.

The `SectionCard`/`SecHead` wrapper is already correct. Only the table markup inside it changes: it currently uses raw slate Tailwind, which reads as foreign against a mint-tinted card.

- [ ] **Step 1: Update the import**

Change:

```tsx
import { SectionCard, SecHead } from '@/components/ui';
```

to:

```tsx
import { SectionCard, SecHead, cx, cockpitStyles as s } from '@/components/ui';
```

- [ ] **Step 2: Replace the table markup**

Replace everything from `<div className="overflow-x-auto">` through its closing `</div>` (the block containing the `<table>`) with:

```tsx
      <div className={s.scrollX}>
        <table className={s.table} style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>Practice</th>
              <th>Channel</th>
              <th className={s.r}>Leads</th>
              <th className={s.r}>Spend</th>
              <th className={s.r}>Cost per lead</th>
              <th className={s.r}>Conversions</th>
              <th className={s.r}>Accepted value</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((p) => [
              ...p.channels.map((c, i) => (
                <tr key={`${p.practiceId}|${c.channel}`}>
                  <td>{i === 0 ? (p.practiceName ?? '—') : ''}</td>
                  <td>{LABEL[c.channel]}</td>
                  <td className={cx(s.r, s.money)}>{c.leads.toLocaleString('en-GB')}</td>
                  <td className={cx(s.r, s.money)}>{money(c.spendPence)}</td>
                  <td className={cx(s.r, s.money)}>{money(c.costPerLeadPence)}</td>
                  <td className={cx(s.r, s.money)}>{c.conversions.toLocaleString('en-GB')}</td>
                  <td className={cx(s.r, s.money)}>{formatPence(c.acceptedValuePence)}</td>
                  <td></td>
                </tr>
              )),
              <tr key={`${p.practiceId}|total`} className={s.totalRow}>
                <td></td>
                <td>Total (deduped)</td>
                <td className={cx(s.r, s.money)}>{p.total.leads.toLocaleString('en-GB')}</td>
                <td className={cx(s.r, s.money)}>{money(p.total.spendPence)}</td>
                <td className={cx(s.r, s.money)}>{money(p.total.costPerLeadPence)}</td>
                <td className={cx(s.r, s.money)}>{p.total.conversions.toLocaleString('en-GB')}</td>
                <td className={cx(s.r, s.money)}>{formatPence(p.total.acceptedValuePence)}</td>
                <td><PracticeSparkline trend={p.trend} /></td>
              </tr>,
            ])}
          </tbody>
        </table>
      </div>
```

Every value expression, every `key`, and the row structure are unchanged — only classes and the `minWidth` idiom differ. `.totalRow` supplies the tint and bold that `bg-slate-50 font-medium` supplied before. `.table th` already applies the uppercase muted header treatment, so the per-`th` `font-medium` and colour classes are dropped.

- [ ] **Step 3: Convert the two trailing paragraphs**

Replace:

```tsx
      {rows.length === 0 ? <p className="py-3 text-sm text-slate-500">No practice data in this period.</p> : null}
```

with:

```tsx
      {rows.length === 0 ? (
        <p className={s.subtle} style={{ fontSize: 13 }}>No practice data in this period.</p>
      ) : null}
```

`.subtle` sets only `color: var(--muted)` — it carries no font size — so the inline `fontSize: 13` is required or the text renders at base size, larger than the `text-sm` it replaces. This is the codebase's established idiom for in-card empty and loading text; see `CockpitScreen.tsx:231`, `:320`, `:323`.

and change the caveat paragraph's `className="mt-2 text-[11px] text-slate-400"` to:

```tsx
className={s.footNote}
```

Leave both strings exactly as they are, including the `&quot;` and `&apos;` entities in the caveat.

- [ ] **Step 4: Confirm no slate classes remain**

Run from the repo root:

```bash
grep -n "slate-" frontend/features/ad-performance/components/ByPracticeTable.tsx
```

Expected: no output.

- [ ] **Step 5: Typecheck, lint and build**

Run from `frontend/`:

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/features/ad-performance/components/ByPracticeTable.tsx
git commit -m "feat(ads): By practice table on the cockpit table styling

The SectionCard wrapper was already on the skin but the table inside used
raw slate Tailwind. Moves it to s.table with the module's totalRow and
footNote. Values and row structure unchanged."
```

---

### Task 4: `OverlapTable` onto the module table

**Files:**
- Modify: `frontend/features/ad-performance/components/OverlapTable.tsx`

**Interfaces:**
- Consumes: `s.scrollX`, `s.table`, `s.subtle` and `cx` from `@/components/ui`.
- Produces: nothing.

This component currently imports nothing from `@/components/ui`.

**Do NOT add a `SectionCard` or `SecHead` wrapper.** `OverlapTable` renders inside a `DetailPanel` (`AdPerformanceScreen.tsx:204`, the `drill === 'overlap'` branch), so a card here would nest a card inside a panel. Only the table markup and the empty-state paragraph change.

- [ ] **Step 1: Add the import**

Directly below the `'use client';` line and the existing comment block, add:

```tsx
import { cockpitStyles as s } from '@/components/ui';
```

Keep the existing `import type` lines for `OverlapPerson` and `PerfChannel` unchanged.

- [ ] **Step 2: Convert the empty state**

Replace:

```tsx
      <p className="py-2 text-sm text-slate-500">
        No one in this window was found under more than one channel.
      </p>
```

with:

```tsx
      <p className={s.subtle} style={{ fontSize: 13 }}>
        No one in this window was found under more than one channel.
      </p>
```

`.subtle` sets only `color: var(--muted)`, so the inline `fontSize: 13` is required or the text renders at base size. This matches the codebase idiom at `CockpitScreen.tsx:231`, `:320`, `:323`.

- [ ] **Step 3: Replace the table markup**

Replace the whole returned `<div className="overflow-x-auto" style={{ maxHeight: 420 }}>` block with:

```tsx
    <div className={s.scrollX} style={{ maxHeight: 420 }}>
      <table className={s.table} style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Counted under</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.key}>
              <td>{p.name ?? '—'}</td>
              <td>{p.email ?? '—'}</td>
              <td>{p.phone ?? '—'}</td>
              <td>{p.channels.map((c) => LABEL[c]).join(' + ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
```

The `maxHeight: 420` is preserved — this list can be long and the panel scrolls it. No column is numeric, so no `s.r` / `s.money` is used here.

- [ ] **Step 4: Confirm no slate classes remain**

Run from the repo root:

```bash
grep -n "slate-" frontend/features/ad-performance/components/OverlapTable.tsx
```

Expected: no output.

- [ ] **Step 5: Typecheck, lint and build**

Run from `frontend/`:

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: all exit 0; build prints "✓ Compiled successfully".

- [ ] **Step 6: Commit**

```bash
git add frontend/features/ad-performance/components/OverlapTable.tsx
git commit -m "feat(ads): overlap table on the cockpit table styling

Last Ad Performance component still on raw slate Tailwind. No SectionCard
wrapper — it renders inside a DetailPanel, so a card would nest in a panel."
```

---

## Human visual sign-off (cannot be automated)

The CI gates prove this compiles; they cannot prove it looks right. Nothing in these tasks is evidenced visually until a person loads the page. Before merging, with `npm run dev` running and logged in, open `/ad-performance` beside `/cockpit` at the same viewport width and confirm:

1. Page background, card border colour and radius, heading font/colour, numbered badge and tile background all match the cockpit.
2. The four page-level banners render correctly — amber for `nothingMapped`, neutral for the other three. Select a practice to see `spendIsGroupWide`.
3. Loading and error states render as bordered state boxes with the header and filter bar still visible.
4. `By practice` and the overlap drill-down show no residual slate borders or grey text.
5. Changing practice or period refetches, and the month selector keeps focus across the refetch — the `Frame` module-scope property.

## Out of scope

- `PracticeSparkline.tsx` (`text-slate-400`) — converting it means touching recharts styling.
- `AdLeadsDrilldown.tsx` — delegates to the shared `LeadsTable`, already on the skin.
- The `p-6` (`app/(dashboard)/layout.tsx:24`) plus `.shell` `padding: 24px` double padding. The cockpit already has it; matching it keeps the screens identical. Any fix moves both.
- Moving the module's variables to `:root`.
- `ChannelScorecard.tsx`, `AttributionSection.tsx`, `ChannelTrend.tsx` — already on the skin.
