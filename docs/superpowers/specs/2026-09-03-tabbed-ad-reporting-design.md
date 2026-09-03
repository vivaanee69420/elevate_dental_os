# Tabbed ad reporting — Facebook and Google — design

**Date:** 2026-09-03
**Status:** awaiting review
**Supersedes:** the two-route drill-down UI in `2026-09-03-facebook-reporting-page-design.md`. That spec's BACKEND is unchanged and still authoritative.

## Problem

The owner stated the interaction model they want, plainly: *"1 google page and 4 tabs inside it, 1 facebook page and 3 tabs inside it for campaigns, ads and ads sets"*.

The Facebook page as built (PR #4) is a drill-down chain instead — `/marketing-facebook` listing campaigns, `/marketing-facebook/[campaignId]` listing that campaign's ad sets with ads expanding in place. It works, but it is the wrong shape, and shipping it would leave two ad-reporting pages with different interaction models.

Google has not been built yet, so it costs nothing to get right first time.

## What survives, and what changes

**The Facebook backend survives essentially intact.** The funnel, the structural Meta identification, the 92-day window clamp, the practice scoping, the two Criticals the final review caught — all still correct and all still needed. Specifically unchanged: `ad_meta_funnel`, `facebookReportService`'s aggregation and cost derivation, the four tenant states, `unmatchedLeads` and `notIdentified`.

**What changes:**

1. `facebookReportService.adSets(orgId, campaignId, …)` and `.ads(orgId, adSetId, …)` take their parent id as a REQUIRED positional argument, because they only ever ran inside a drill-down. A standalone tab must list every ad set, or every ad, unfiltered. The parent id becomes an optional filter. The plumbing already supports this: `adGrainRepository`'s `filterParams` defaults `campaignId` and `parentId` to null.
2. The routes become query-parameter filters rather than nested paths.
3. The two Facebook screens are replaced by one tabbed page.

**No migration is needed for any of this.** `ad_grain_rollup` and `ad_keyword_rollup` already exist and are applied (`000148`), and `ad_meta_funnel` is applied (`000153`). This piece is entirely application code.

## The shared pattern

Both pages are the same object: a tab strip over a set of metric tables sharing one row contract, with a filter chain.

There is no `Tabs` primitive in `components/ui`; screens such as `TaskManagerScreen` roll their own with `useState` and a button row. With SEVEN tables across two pages, per-file duplication of the tab shell and the cell formatters is past defensible, so both are extracted to `frontend/features/marketing/_shared/`.

**This is a deliberate deviation from a local convention.** Existing marketing screens redefine `money`/`ctrPct`/`num` as unexported per-file consts, and previous implementers correctly matched that. Seven tables changes the arithmetic: one copy is a helper, seven copies is a liability — particularly for the em-dash rule, where a single missed guard renders `£0.00` for an unknowable cost.

Extracted:
- `AdReportTabs` — the tab strip, with the active tab in the URL so a view is shareable and the back button works.
- `AdMetricTable` — the shared table shell: sticky header, its own `overflow-x-auto` container so the page body never scrolls horizontally, and the em-dash contract applied centrally.
- The cell formatters: money via `formatPence` guarded for null, CTR as a raw 0–1 fraction scaled once, counts, and the em dash for every unknowable value.

## Facebook: one page, three tabs

`/marketing-facebook` — tabs **Campaigns**, **Ad sets**, **Ads**.

Columns per tab: name, spend, impressions, clicks, CTR, CPC, leads, booked, attended, patients, CPL, CPB, CPA.

Unchanged from the superseded spec and still binding: `attended` is Dentally-only and labelled; no platform-conversions column at ad set or ad grain, because Meta's `actions` are not requested at those grains and the column would be a permanent zero; costs are `null` on a zero denominator and render as an em dash; `unmatchedLeads` and `notIdentified` are stated, carry leads but never spend, and render only when non-empty.

## Google: one page, four tabs

`/marketing-google` — tabs **Campaigns**, **Ad groups**, **Ads**, **Keywords**.

Four tabs rather than three because Google's hierarchy is Campaign → Ad Group → { Ads, Keywords }, where ads and keywords are SIBLINGS. Neither contains the other, so neither belongs nested inside the other's view.

Columns per tab: name, spend, impressions, clicks, CTR, CPC, **conversions**, **cost per conversion**.

**Google supplies conversions at every grain and Meta does not.** `google-ads-deep-sync.js` requests `metrics.conversions` on all three streams and both rollups return them. So Google's tabs carry a real cost-per-conversion from Google's own tracking, where the Facebook page deliberately omits that column. The two pages differ here for a reason, and the difference must be visible rather than look like an inconsistency.

Keywords additionally carry **match type**, **Quality Score**, and the three impression-share figures.

Two statements the page must make, because both are approximations and saying so is the point:
- **Impression share is an impression-weighted average** over the days in the window, and the denominator is filtered to the days Google actually reported a share. Google computes its own range figure from eligible impressions, which the API does not expose, so ours can differ slightly. Spend, clicks and conversions are exact.
- **Quality Score is the latest value in the window**, not an average — it is a 1-10 grade Google assigns, and averaging grades is meaningless.

**No CPL, CPB or CPA columns on any Google tab until CallRail lands.** There are 197 attributed Google leads against £176,795 of spend, so any cost-per-lead figure would be fiction. The page says so. This matches the decision to remove the Reach column from the Facebook page rather than ship it permanently blank: an empty column is worse than an absent one.

## The filter chain

Clicking a row filters the tabs below it and moves to the most useful one:
- Facebook: campaign → Ad sets, ad set → Ads.
- Google: campaign → Ad groups, ad group → Ads (and the same filter applies to Keywords).

The active filter is shown as a dismissible chip naming what is being filtered by, and lives in the URL alongside the active tab. A tab that cannot honour the current filter clears it rather than silently ignoring it.

## MULTI-TENANT REQUIREMENTS

Carried forward unchanged from the superseded spec, and binding on every new endpoint and screen:

- **The org id comes only from `req.user.organisation_id`.** Never a query parameter. Under an agency switch that value is already the sub-account's.
- **No lead is identified by a CRM's own vocabulary.** Structural tests only.
- **Every coverage figure is computed per tenant and displayed**, never assumed.
- **The four states keep their own copy** — `not_connected`, `never_synced`, `no_spend_in_window`, `no_ad_id_coverage`, `ok` — and are correct per tab. A tab showing an empty table must say why.
- **Nothing assumes this tenant's volumes.** Every list is paged; the Ads tab in particular is unbounded across a whole organisation.
- **Gating matches the sibling marketing routes:** `requirePermission('marketing.view')`, `ROUTE_PERMISSION` entries for both routes, and the nav section's existing `SECTION_FEATURE` gate. Reception stays out per project rule 5.
- **Practice scope comes from the shared scope bar**, and the window is clamped to the deep tables' 92-day floor with `effectiveSince`/`windowClamped` surfaced.

## Testing

- Each service method returns correct rows with the parent filter ABSENT (the new case) and PRESENT (the existing one).
- The org id never reaches a service from a request parameter.
- Costs are `null` on a zero denominator on every tab.
- Paged reads assert READ COUNT, not row total — a row total cannot tell a correct pager from one that stops on a short page.
- Google's conversions and cost-per-conversion are present; Facebook's are absent at ad set and ad grain.
- The filter chain: filtering by a campaign yields only that campaign's ad sets, and clearing it restores the full list.

## Risks

| Risk | Mitigation |
|---|---|
| The Ads tab is unbounded across an org and could be large | Paged, with the same read-count assertions as elsewhere |
| Extracting shared helpers diverges from the per-file convention | Deliberate, documented, and confined to `features/marketing/_shared/` |
| Two pages sharing components could drift in meaning (e.g. CTR scale) | The formatters are the shared piece precisely so they cannot |
| Reworking Facebook risks regressing reviewed backend behaviour | Backend logic is unchanged; only argument optionality and route shape move, both covered by tests |
