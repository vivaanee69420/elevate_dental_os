# Ad Performance — Daily Cockpit treatment

**Date:** 2026-07-19
**Status:** Approved, ready for planning
**Scope:** Frontend only. No backend, no migration, no re-sync.

## Problem

`/ad-performance` renders as flat prose blocks with no card boundaries — the "Total (deduped)" panel is a bare grid of label/value pairs with no visual separation between metrics, no explanation of how each is derived, and no way to see the records behind a number. The Daily Cockpit (`/cockpit`) already solves all three problems with an established visual language. Ad Performance should adopt it so the two pages read as one product.

Two aggregate figures on the page are also non-additive in ways the current UI states only in fine print: `totals` is deduped per person across all channels, while the three channel columns each count a person who appears in multiple channels. The redesign makes that concrete rather than footnoted.

## Constraints

- Frontend only. The page uses what `GET /api/ad-attribution/performance` and `GET /api/ad-attribution/leads` already return.
- The Daily Cockpit must render identically after the work. It is a 963-line screen with many call sites; any visual change to it is a regression.
- Money is integer pence throughout. `null` money means "not known", never zero — `formatPence` must never be called on a nullable.
- British English. No dark mode. No emojis.

## Data available

From `frontend/features/ad-performance/api.ts`:

- `AdPerformance` — `channels: ChannelStats[]` (always 3, in `CHANNELS` order), `totals: AdTotals`, `byPractice: PracticeChannels[]`, `trend: TrendMonth[]`, `excludedUnmappedLeads`, `unmappedPipelineCount`.
- `AdLeadLine` — `id, contactId, name, email, phone, channel, pipelineName, createdAt, converted, matchedTreatmentName, matchedValuePence`.

Channels are `google_ads | meta_ads | unassigned`. "Facebook Ads" is the display label for `meta_ads`. **Emergent is not a channel** — it is the source of accepted-treatment records that leads are matched against (`backend/src/lib/lead-emergent-match.js`), supplying `matchedTreatmentName` and `matchedValuePence`.

### Latent field already sent and discarded

`ad-attribution.service.js:378` attaches a `trend` array to every `byPractice` entry. The frontend `PracticeChannels` interface does not declare it, so it is fetched and dropped. Declaring it enables per-practice trend display with no backend change.

## Design

### Section layout

Five `SectionCard`s, each with a numbered `SecHead` carrying `desc` prose.

1. **Group total (deduped)** — `Kpi` tiles for Leads, Paid leads, Spend, Cost per lead, Conversions, Paid conversions, Conversion rate, Cost per acquisition, Accepted value.
2. **By channel** — Google Ads, Facebook Ads, Unassigned side by side.
3. **Attribution & match quality** — Emergent linkage: match rate, matched pairs, accepted value with no matching lead.
4. **By practice** — existing `ByPracticeTable` plus the per-practice trend that is already being sent.
5. **Trend** — existing `ChannelTrend`, restyled to the section language.
6. **Mapping health** — rendered only when there is a gap. See below.

### Component promotion

`SecHead`, `SectionCard`, `Kpi`, `DetailPanel` and `cockpit.module.css` move from `frontend/features/cockpit/components/cockpit-ui.tsx` into `frontend/components/ui/`. `cockpit-ui.tsx` becomes a re-export of the new location so every existing cockpit import path continues to resolve unchanged. `CockpitScreen.tsx` and its sibling components are not edited.

This is the safest form of shared ownership: both pages consume the same components, and the cockpit's own files see no diff.

### Drill-down

Follows the cockpit pattern exactly — a `Drill` string-union state plus a toggle, rendering an inline `DetailPanel` beneath the owning section. No modal; the codebase has no shared modal primitive and the cockpit uses inline expansion by design.

`useAdLeads(open, …)` fetches lazily on `enabled: open` and returns up to 500 rows. **One fetch serves every lead drill-down.** Each tile filters that in-memory array rather than issuing its own request.

| Tile | Panel contents |
|---|---|
| Leads | `LeadsTable` — all rows, deduped per person |
| Paid leads | `LeadsTable` — rows where channel is `google_ads` or `meta_ads` |
| Conversions | `LeadsTable` — rows where `converted` |
| Accepted value | `LeadsTable` — rows with `matchedValuePence > 0`, value-descending |
| Per-channel leads | `LeadsTable` — rows for that channel |
| Overlap | Table of people appearing in more than one channel |
| Spend, Cost per lead, Cost per acquisition, Conversion rate | Not clickable — see below |

### Non-clickable tiles

`spendPence` arrives as one number per channel with no per-account, per-campaign or per-day breakdown on this endpoint. The Spend tile and the derived cost/rate tiles are therefore rendered without `onClick`. They are not given a drill affordance, because an empty panel is worse than no panel. They still carry an `Explainer` describing the formula.

### Overlap view

Derived client-side, not fetched. `getLeads` dedupes per `channel|personKey`, so a person present in both a Google-tagged and a Meta-tagged pipeline returns as two rows. `AdLeadLine` does not expose the server's `personKey`, so the client identifies a person the same way the existing `dedupeByPerson` helper in `LeadsTable.tsx:26` does: `contactId`, falling back to `lead:${id}` when `contactId` is null. Grouping by that identity and keeping entries with more than one distinct channel yields the overlap population — the difference between the deduped total and the sum of the channel columns, expressed as a list of names rather than a footnote.

**Known limitation of this identity rule.** A lead whose `contactId` is null gets a per-row synthetic key, so it can never be seen as overlapping even if the same human appears in both channels. The client-side overlap count is therefore a *lower bound* on true overlap, and the panel must say so rather than presenting it as exact. Matching those rows properly would need the server's `personKey` on the response, which is out of scope here.

### Attribution & match quality section

Built entirely from `AdLeadLine` fields plus `totals.acceptedValuePence`:

- **Match rate** — leads with a non-null `matchedTreatmentName` over total leads.
- **Matched pairs** — table of lead → accepted treatment name → value.
- **Unmatched accepted value** — `totals.acceptedValuePence` minus the summed `matchedValuePence` of returned lead rows, with prose stating this is accepted treatment that could not be tied to any tracked lead.

The section prose states plainly that Emergent supplies accepted-treatment records, not leads, so it is a measure of downstream outcome rather than a fourth advertising channel.

### Mapping health

Reduced to what the endpoint exposes: `excludedUnmappedLeads` (leads on a GHL subaccount with no practice mapped, deliberately excluded from all figures) and `unmappedPipelineCount`. Both are rendered as explained figures with prose describing what is missing and why the numbers are affected.

Account-level mapping health — which of the ad accounts, GHL subaccounts and Emergent businesses map to which practice — is **out of scope**; those rows are not on this endpoint.

### Descriptions

Every `Kpi` gets an `Explainer` in its `info` slot stating what the metric is and how it is calculated. The non-additive nature of the channel columns and the deduped nature of the total are stated on the tiles themselves, not only in section prose.

## Explicitly out of scope

- Any backend, endpoint, service, repository or migration change.
- The account-by-account mapping table.
- Spend drill-down.
- The "Not reporting" copy on the cost tiles. `ad-attribution.service.js:343` nulls both cost metrics when a paid channel has leads but zero accumulated spend; this design does not diagnose or alter that behaviour.

## Verification

The frontend has no test framework, so verification is command output plus direct inspection:

1. `cd frontend && npm run typecheck` — clean.
2. `npm run lint` — clean.
3. `npm run build` — succeeds.
4. Load `/cockpit` and confirm it is visually identical to before the component promotion. This is the one plausible regression and must be checked explicitly, not assumed.
5. Load `/ad-performance` and confirm each clickable tile opens a populated panel, and that no tile without data offers a drill affordance.
6. Confirm every nullable money field renders "Not reporting" rather than "£0" or "£NaN".
