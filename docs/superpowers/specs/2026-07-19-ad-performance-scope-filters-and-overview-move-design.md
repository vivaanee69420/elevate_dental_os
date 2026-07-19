# Ad Performance — scope/period filters and move to Overview

**Date:** 2026-07-19
**Status:** Approved, ready for planning
**Scope:** Frontend only. No migration, no backend change, no new endpoint.

## Problem

Two gaps on the Ad Performance screen (`/ad-performance`):

1. **The screen consumes a scope/period it cannot set.** `AdPerformanceScreen.tsx:68-73` already calls `useScopePeriod()` and threads `since`, `until` and `practiceId` into both `useAdPerformance` and `useAdLeads`. The backend already accepts all three (`performanceQuerySchema` in `backend/src/models/ad-attribution.model.js`). But the screen never renders `<ScopePeriodBar />`, so it silently inherits whatever `?scope=`/`?month=` happen to be in the URL from a previously visited page, with no UI to change them. The window is real and load-bearing but invisible and unsettable.

2. **The tab sits in the wrong section.** `lib/nav.ts:64` registers `ad-performance` under **Growth**. It belongs in **Overview**, alongside the Daily Cockpit whose filter idiom it will now share.

## Constraints

- Frontend only. No backend, repository, migration or connector change.
- British English in all user-facing strings.
- No dark mode.
- Money in integer pence; display via the existing helpers. `null` means "not known", never zero.
- Reuse the existing shared components. Do not fork a second filter bar.
- The React Query key prefix `'ad-performance'` must not be restructured — settings mutations invalidate on it.

## What the practice filter can and cannot scope

Established by reading `backend/src/services/ad-attribution.service.js` and querying the hosted database. This is the load-bearing fact for the design, because adding the bar is what makes it visible.

**Scoped correctly** when a practice is selected — the service already builds a full per-practice split and picks one bucket at `service.js:471-486`:

- `channels[].leads`, `conversions`, `acceptedValuePence`
- `totals.*`, including `paidLeads` / `paidConversions`
- `trend[]`
- the drill-in lead rows (`getLeads` filters on the lead's practice at `service.js:518-522`)

Attribution runs through the lead's GoHighLevel subaccount (`integration_accounts.practice_id`). On live data 83.4% of Plan4growth leads in 2026 carry a practice — Rochester 1873, Ashford 1305, Barnet 1072, Bexleyheath 640, and 971 with none. Leads on a subaccount with no practice are excluded from every practice bucket (`service.js:186-187`), so the per-practice figures deliberately do not sum to the group total.

**Not scoped — spend and everything derived from it.** `adSpend` splits on `ad_metrics.practice_id` (`service.js:316-319`), a column both connectors hardcode to `null` (`google-ads-sync.js:153`, `meta-ads-sync.js:219`). All 10,691 live `ad_metrics` rows have it null. The branch is dead code, so per-practice `spendPence` is always 0, and `finalise` (`service.js:71-72`) plus `incompleteSpendAcross` (`service.js:343-346`) turn that into `null` spend, `null` cost per lead and `null` cost per acquisition.

`ad_accounts.practice_id` — the mapping the settings screen writes — is never joined to `ad_metrics` and is not even fetched by `getPerformance`. It has no effect on spend today.

**Not scoped — two mapping-health counters.** `excludedUnmappedLeads` (`service.js:487`) and `unmappedPipelineCount` (`service.js:492-495`) are returned org-wide regardless of `practiceId`. They are correct today only because there is no way to select a practice.

**Not distinguishable — empty practice from £0 practice.** If a selected practice has no leads in the window, `byPractice[0]` is undefined and the service substitutes synthetic zeros (`service.js:476-481`).

The backend fix for the spend half is already designed in `2026-07-19-ad-attribution-mapping-health-and-spend-design.md` §4 — join spend to practice through `ad_accounts.customer_id` rather than the null column. It is deliberately **not** part of this work: it is inert until an operator maps ad accounts to practices, and every live account is currently unmapped. This design makes the gap legible; that one closes it.

## Design

### 1. Move the tab to Overview

In `frontend/lib/nav.ts`, remove `{ id: 'ad-performance', label: 'Ad Performance', isNew: true }` from the Growth `items` array and insert it into the Overview `items` array, positioned directly after `{ id: 'cockpit', label: 'Daily Cockpit' }` — the two share a filter idiom and a daily-operational purpose, so they read as a pair.

Nothing else changes. `NAV` is the single source for both the sidebar and `components/layout/SectionTabs.tsx`, which resolves the current section via `sectionForRoute(routeId)` (`nav.ts:100`). The route file `app/(dashboard)/ad-performance/page.tsx`, the feature directory, and RBAC (`lib/permissions canAccessRoute`, which resolves per item id) are all unaffected.

### 2. Render the shared filter bar

In `AdPerformanceScreen.tsx`, render `<ScopePeriodBar />` immediately after the `<PageHeader>` (~line 100), before the mapping-gap banners.

No props — the same bare call the cockpit uses at `CockpitScreen.tsx:932`. That yields the practice chip row and the This month / This year / Pick month / Custom row with the month selector, identical to the cockpit.

Specifically **not** `dentallyOnly`. That flag drops practices whose `pms_site_id` is null, which is a Dentally-feed concern; ad attribution resolves practices through GoHighLevel subaccounts, a different mapping. Passing it would hide practices that do have ad leads.

No state is added. `useScopePeriod` is URL-synced through `scope-context.tsx`, the screen already reads from it, and the existing `useMemo` on `[sp.win.since, sp.win.until, practiceId]` already re-keys both queries when the selection changes.

### 3. Tell the truth about what the practice filter did

Frontend only, driven off data already on the response. Three additions, all conditional on a practice being selected (`sp.scope !== 'all'`):

**A group-scope note above the scorecards**, shown when `data.totals.spendPence == null`:

> Leads, conversions and treatment value are for this practice. Spend, cost per lead and cost per acquisition remain group-wide — no ad account is mapped to a practice yet. Map them in Settings → Ad attribution.

Rendered in the existing neutral banner style (`rounded border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700`), matching the `mappedButQuiet` banner already in the file. Not amber: this is an explanation, not a fault the operator introduced.

**A "group-wide" qualifier on the two org-scoped counters.** Wherever `excludedUnmappedLeads` and `unmappedPipelineCount` are surfaced, label them explicitly as group-wide when a practice is selected, so they are not misread as belonging to that practice.

**An empty-practice distinction.** When a practice is selected and `data.totals.leads === 0`, show "No ad leads attributed to this practice in this window" rather than letting the synthetic zeros render as a measured result.

Blank cells stay blank. Nothing displays a fabricated £0.

## Error handling

Unchanged. The screen's existing `isLoading` / `error || !data` guards (`AdPerformanceScreen.tsx:84-85`) already cover the fetch; this work adds no new fetch and no new failure mode. The new banners are pure functions of a successfully-loaded response, so a failed load falls through to the existing message.

## Testing

The frontend has no test framework and CI does not run frontend tests, so verification is manual plus the gates CI does enforce.

- `npm run typecheck` and `npm run lint` in `frontend/` must pass; `npm run build` must succeed.
- Manual: the Ad Performance tab appears under Overview in both the sidebar and the section tab bar, and no longer under Growth.
- Manual: the filter bar renders and matches the cockpit's; changing practice or period refetches and visibly changes leads/conversions/trend.
- Manual: selecting a practice shows the group-scope note, with spend/CPL/CPA blank rather than £0.
- Manual: selecting a practice with no ad leads in the window shows the empty-practice message, not zeros.
- Manual: deep-linking `/ad-performance?scope=<uuid>&month=...` restores the same selection, confirming the bar and URL stay in sync.

No backend test change — no backend code changes.

## Explicitly out of scope

- The backend spend-to-practice join. Specced separately in `2026-07-19-ad-attribution-mapping-health-and-spend-design.md` §4.
- Making `excludedUnmappedLeads` / `unmappedPipelineCount` genuinely practice-scoped. This work labels them honestly; changing their computation is a backend change.
- Backfilling `ad_metrics.practice_id`, or any connector change.
- Any change to the Growth section beyond removing the one moved item.
