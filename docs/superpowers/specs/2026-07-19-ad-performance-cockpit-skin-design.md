# Ad Performance — adopt the cockpit skin

**Date:** 2026-07-19
**Status:** Approved, ready for planning
**Scope:** Frontend only, presentation only. No migration, no backend change, no data-shape change.

## Problem

The Ad Performance screen is meant to read in the Daily Command Cockpit's visual language, and it already imports the shared cockpit primitives — `SectionCard`, `SecHead`, `Kpi` — from `@/components/ui`. It does not look like the cockpit.

The cause is a scoping bug, not a styling preference. `frontend/components/ui/cockpit.module.css:9-34` declares every theme variable on `.shell`:

```css
.shell {
  --bg: #ffffff;
  --tint2: #f6faf8;
  --line: #e2ebe6;
  --green: #14503c;
  --muted: #6b7c74;
  /* … */
  background: #f4f7f5;
  padding: 24px;
}
```

There is no `:root` fallback. `frontend/app/globals.css` defines different names (`--line-2`), so nothing else supplies them. `AdPerformanceScreen.tsx` renders `PageHeader` inside a plain `<div className="space-y-4">` and never renders `s.shell`, so every `SectionCard` on the page resolves `background: var(--bg)` and `border: 1px solid var(--line)` against undefined values — transparent background, and a border that falls back to `currentColor`. The numbered `SecHead` badge resolves `background: var(--green)` to nothing.

So the components are right and the wrapper is missing. Adding the wrapper fixes the majority of the appearance on its own.

Three secondary gaps remain once the wrapper is in place:

1. **Half-converted children.** `ByPracticeTable.tsx:34-54` sits inside a `SectionCard` but renders its table with raw slate Tailwind (`border-slate-200`, `text-slate-500`). `OverlapTable.tsx` imports nothing from `components/ui` at all. Against a mint-tinted card these read as foreign.
2. **State messages.** Loading and error render as `text-sm text-slate-500`; the cockpit uses `s.stateBox` / `s.errorBox`.
3. **Notice banners.** The four conditional banners use slate/amber Tailwind (`border-slate-200 bg-slate-50`, `border-amber-200 bg-amber-50`) rather than the module palette.

## Constraints

- Frontend only. Presentation only — no change to data fetching, derived values, conditions, or copy.
- No dark mode (project rule 1). British English. No emojis.
- Money stays integer pence; `null` renders "Not reporting" via `money()`, never a fabricated `£0`. No change to `format.ts`.
- The React Query key prefix `'ad-performance'` must not be restructured.
- `cockpit.module.css` is a CSS Module scoped deliberately so it "never leaks into the ~60 slate/white screens that share KpiTile/Panel" (its header comment). That scoping must be preserved.
- Do not mix the two KPI primitives on one screen: the cockpit-skin `Kpi` (`SectionKit.tsx:48`) and the legacy Tailwind `KpiTile` (`components/ui/KpiTile.tsx`) look different. Ad Performance uses `Kpi` throughout and must continue to.

## Rejected alternative

**Promoting the variables to `:root`** would fix the appearance without any wrapper. Rejected: the module is explicitly scoped to avoid bleeding into the other ~60 screens, and lifting `--line`, `--muted` and `--ink` to `:root` risks colliding with `globals.css` tokens across the whole product. The wrapper is local and reversible; the `:root` change is neither.

## Design

### 1. Wrap the screen in the cockpit shell

In `AdPerformanceScreen.tsx`, the module-scope `Frame` component becomes the cockpit chrome. It currently renders:

```tsx
<div className="space-y-4">
  <PageHeader title="Ad performance" subtitle="…" />
  <ScopePeriodBar />
  {children}
</div>
```

It becomes the same structure the cockpit uses at `CockpitScreen.tsx:921-937` — `s.shell` > `s.wrap` > `s.topbar` containing `s.h1`, `s.sub`, and `ScopePeriodBar` at `marginTop: 14` — followed by `{children}`. `PageHeader` is dropped from this screen; the title and subtitle move into `s.h1` / `s.sub` verbatim, so the wording does not change.

`Frame` stays at module scope. It is wrapped there for a reason recorded in its own comment: a component declared inside the render function gets a new identity each render, which remounts the subtree and drops focus from the month selector. That must not regress.

This step alone supplies the variables, so the existing `SectionCard`, `SecHead` and `Kpi` instances on the page render correctly — grey page background, white bordered cards, serif green heading, dark-green numbered badges, mint-tinted tiles.

**Double padding is accepted, not fixed.** `app/(dashboard)/layout.tsx:24` puts `p-6` on `<main>` and `.shell` adds its own `padding: 24px`. The cockpit already renders with this quirk. Matching it keeps the two screens identical; fixing it here alone would make them differ. Any fix belongs in a separate change that moves both.

### 2. State messages use the module

The loading and error branches move from `text-sm text-slate-500` to `s.stateBox` and `cx(s.stateBox, s.errorBox)`, matching `CockpitScreen.tsx:941-944`. Both continue to render inside `Frame`, so the header and filter bar stay on screen in every state — the property the frame exists to guarantee.

### 3. Two notice classes added to the module

The module has no callout class. `.note` is the `Kpi` sub-caption and must not be reused for banners.

Add exactly two classes to `cockpit.module.css`, built from variables the module already defines:

- `.notice` — neutral: `background: var(--tint2); border: 1px solid var(--line); color: var(--ink)`.
- `.noticeWarn` — modifier: `background: var(--amberbg); border-color: var(--amber); color: var(--amber)`.

Both take the card's `border-radius: 10px` and `padding: 12px 14px`, `font-size: 13px`.

The four banners in `AdPerformanceScreen.tsx` then map: `nothingMapped` → `cx(s.notice, s.noticeWarn)`; `mappedButQuiet`, `spendIsGroupWide` and `practiceHasNoLeads` → `s.notice`. This preserves today's semantics exactly — amber for the one actionable setup gap, neutral for the three informational notes — while moving them onto the palette.

Banner order, conditions and copy are unchanged.

### 4. Finish the two half-converted children

- **`ByPracticeTable.tsx`** — the table markup adopts the module's `.table` (which already styles `th` and `td`, including the uppercase muted header treatment and the hairline `border-bottom: 1px solid var(--line)`). The raw slate classes at `:34-54` are removed. The `SectionCard`/`SecHead` wrapper is unchanged.
- **`OverlapTable.tsx`** — same `.table` treatment. It does **not** gain a `SectionCard`/`SecHead` wrapper: it renders inside a `DetailPanel` (`AdPerformanceScreen.tsx:204`, the `drill === 'overlap'` branch), so adding a card would nest a card inside a panel. Only its table markup changes.

Both follow the cockpit's established table idiom, e.g. `CockpitScreen.tsx:205-218`: a `div.scrollX` wrapper, `<table className={s.table} style={{ minWidth: N }}>`, right-aligned numeric cells as `cx(s.r, s.money)` with matching `th className={s.r}`. `ByPracticeTable`'s deduped total row uses the module's `.totalRow`, and its trailing caveat paragraph uses `.footNote`.

### 5. Deliberately out of scope

- `PracticeSparkline.tsx` (`text-slate-400`) — one colour on a small chart element; converting it means touching recharts styling, which is a different kind of change.
- `AdLeadsDrilldown.tsx` — delegates rendering to the cockpit's shared `LeadsTable`, which is already on the skin.
- The `p-6` / `padding: 24px` double padding, per section 1.
- Any change to `PageHeader` itself or to the other ~60 screens that use it.

## Error handling

No new failure modes. The change is presentational: no fetch, no condition, and no derived value is altered. The existing `isLoading` and `error || !data` branches keep their current behaviour and gain only new class names. A missing CSS variable degrades to an unstyled box rather than a crash, which is the current state this change corrects.

## Testing

The frontend has no test framework and CI does not run frontend tests (the CI frontend job runs typecheck/lint/build only). Verification is therefore the CI gates plus explicit visual checks.

- `npm run typecheck`, `npm run lint`, `npm run build` in `frontend/` must all pass.
- Visual, against the cockpit side by side at the same viewport: page background, card border colour and radius, heading font and colour, numbered badge, and tile background must match.
- Visual: the four notice banners in both their amber and neutral forms.
- Visual: loading and error states render as bordered state boxes with the header and filter bar still present.
- Visual: `ByPracticeTable` and `OverlapTable` show no residual slate borders or grey text against the mint cards.
- Regression: changing practice or period still refetches and the month selector keeps focus across the refetch — the `Frame` module-scope property.

These visual checks require a running dev server and a login. They cannot be performed by an automated agent and must be signed off by a human before merge; the CI gates alone do not evidence appearance.
