# Ad attribution — mapping health, spend detail, richer lead rows

**Date:** 2026-07-19
**Status:** Approved, ready for planning
**Scope:** Backend only, read-only. No migration, no connector change, no writes.

## Problem

Three gaps were deferred from the Ad Performance cockpit treatment (`2026-07-19-ad-performance-cockpit-treatment-design.md`) because the data was not on any endpoint:

1. **Mapping health is invisible at account level.** The performance endpoint returns only two aggregate counts (`excludedUnmappedLeads`, `unmappedPipelineCount`). Which ad account, which GoHighLevel subaccount, which Emergent business is unmapped — and to which practice the mapped ones point — is not exposed anywhere the operator can see it.

2. **Spend cannot be drilled into.** `spendPence` arrives as one number per channel. The Spend tile on Ad Performance is therefore not clickable, because there is nothing to open.

3. **Lead rows are thinner than the data behind them.** `getLeads` discards `patientName` and `acceptedDate` that the matcher already computed, and does not expose `personKey` or the practice — so the client cannot identify a person reliably and the cross-channel overlap count is only a lower bound.

There is also a latent defect this work closes as a side effect. Both ad connectors write `ad_metrics.practice_id` as literal `null` (`meta-ads-sync.js:219`, `google-ads-sync.js:153`) and nothing backfills it, so the per-practice spend accumulation in `computePerformance` (`ad-attribution.service.js:316-319, 330-333`) is dead code on live data. Per-practice spend, cost per lead and cost per acquisition therefore render "Not reporting" even though the information is recoverable.

## Constraints

- Backend only, read-only. No writes, no migration, no connector change.
- Money is integer pence throughout. `null` means "not known", never zero.
- Every repository method must pin `organisation_id` explicitly — repositories use `serviceClient`, which bypasses RLS, so there is no automatic tenant isolation.
- Any read that can exceed 1000 rows must page via `fetchAllPages` or aggregate in SQL. PostgREST silently caps at `db-max-rows` = 1000; this has caused a production undercount before.
- New endpoints follow the existing layering: routes → controller (Zod parse) → service → repository. Query params are snake_case on the wire, camelCase into the service.
- All routes gated by `requireRole('owner', 'practice_manager')`, matching the existing ad-attribution routes.
- British English in any user-facing string.

## Data available

Established by reading the schema and connectors:

- **`ad_accounts`** — `id, organisation_id, provider, customer_id, name, currency, status, is_selected, practice_id, period_*`. `practice_id` nullable; null means unmapped. Unique on `(organisation_id, provider, customer_id)`. An org may have **N accounts per provider**, not one.
- **`ad_metrics`** — grain is **org × provider × account (`customer_id`) × campaign × day**. Carries `campaign_id`, `campaign_name`, `campaign_status`, `objective`, `spend_pence`, `impressions`, `clicks`, `leads`, `conversions`, `reach`, `frequency`. `practice_id` is always null in practice.
- **`integration_accounts`** — GoHighLevel subaccounts. `practice_id` nullable (null = academy/accounting Locations, deliberately excluded from this feature). Pipelines live in `config.pipelines` JSON as `{id, name}`, not a table.
- **`emergent_practice_map`** — `business_id`, `business_name`, `practice_id` (null = intentionally unmapped). Unique on `(organisation_id, business_id)`. Read today only by `emergent-practice-map.repository.js`.
- **The matcher** (`lib/lead-emergent-match.js`) already returns `{ valuePence, treatmentName, patientName, acceptedDate }`. `getLeads` uses the first two and discards the last two.
- **`personKey`** is already exported at `ad-attribution.service.js:36` and already computed inside `getLeads` at `:523`. The practice is in scope at `:518`.

### Not summable

`reach` and `frequency` must never be summed across days. `growth.routes.js:461` does exactly that in its per-campaign rollup; that is an existing overcount and must not be copied. Any window-level reach comes from `ad_accounts.period_*`, and this design simply omits reach rather than reproducing the bug.

## Design

### 1. `GET /api/ad-attribution/mapping-health`

No query parameters. Org-scoped only — deliberately **not** narrowed by practice, because its purpose is to show what is missing across the whole group.

```
{
  adAccounts: [{ id, provider, customerId, name, practiceId, practiceName, mapped }],
  ghlAccounts: [{ id, label, externalAccountId, practiceId, practiceName, mapped,
                  status, pipelineCount, unmappedPipelineCount }],
  emergentBusinesses: [{ businessId, businessName, practiceId, practiceName, mapped }],
  summary: { adAccountsUnmapped, ghlAccountsUnmapped, emergentUnmapped, pipelinesUnmapped }
}
```

`mapped` is `practiceId !== null`, computed server-side so no consumer re-derives it. `practiceName` resolves through `practiceOptions`, null when unmapped.

`unmappedPipelineCount` counts pipelines on that subaccount with no channel in `ad_channel_pipelines`, matching the existing definition in `getPerformance` — including its rule that a subaccount with `practice_id` null is excluded entirely, so its pipelines never inflate the count.

### 2. `GET /api/ad-attribution/spend?since&until&practice_id`

```
{
  byAccount:  [{ customerId, provider, accountName, practiceId, practiceName,
                 spendPence, impressions, clicks, conversions }],
  byCampaign: [{ customerId, provider, campaignId, campaignName, campaignStatus,
                 practiceId, practiceName, spendPence, impressions, clicks, conversions }],
  unattributedSpendPence
}
```

Both arrays sorted by `spendPence` descending. `unattributedSpendPence` is spend on a `customer_id` with no matching `ad_accounts` row — spend that exists but cannot be tied to a known account. Surfacing it prevents the two arrays quietly failing to reconcile to the group total.

`practice_id` filters both arrays to accounts mapped to that practice. Accounts with no practice are excluded when the filter is present, included when it is absent.

`reach` and `frequency` are deliberately absent. See "Not summable".

### 3. `GET /api/ad-attribution/leads` — additive fields

The row shape gains five fields; nothing is removed or renamed:

```
personKey, practiceId, practiceName, matchedPatientName, matchedAcceptedDate
```

All five are already in scope at the row-construction site (`ad-attribution.service.js:529-541`) or already computed by the matcher. `practiceName` requires threading `practiceOptions` into `getLeads` the same way `getPerformance` already does at `:466/469` — one extra query already performed elsewhere in the same request pattern.

`personKey` is the field that makes the client-side cross-channel overlap count exact rather than a lower bound, closing a known limitation of the frontend work.

### 4. The `customer_id → practice_id` join

A single exported helper resolves an account's practice:

```js
export function accountPracticeByCustomerId(adAccounts)  // Map<`${provider}|${customer_id}`, practice_id|null>
```

Keyed on provider **and** customer id, because `ad_accounts` is unique on `(organisation_id, provider, customer_id)` and a bare customer id is not guaranteed unique across providers.

Used in two places:

- The new spend endpoint, to attribute account and campaign rows to a practice.
- `computePerformance`'s per-practice spend accumulation, replacing the dead `if (row.practice_id)` branch.

One helper, two call sites — not two implementations that drift apart.

**This change is inert on current data.** Every `ad_accounts` row in the live org has `practice_id` null, so per-practice spend continues to render "Not reporting" until an operator maps accounts on the settings page. That is precisely the gap the mapping-health endpoint makes visible. The join means per-practice cost metrics begin working the moment a mapping is saved, with no re-sync.

### 5. Repository additions

Three org-scoped methods on `ad-attribution.repository.js`:

- `emergentBusinesses(orgId)` — reads `emergent_practice_map`. Selecting here rather than reusing `emergent-practice-map.repository.js` keeps this feature's reads in one repository; the alternative couples two features' repositories together for one query.
- `adSpendDetailed(orgId, since, until)` — selects the columns `adSpend` drops: `customer_id`, `campaign_id`, `campaign_name`, `campaign_status`, `impressions`, `clicks`, `conversions`, alongside `provider`, `spend_pence`, `metric_date`. **Must page via `fetchAllPages`** — at campaign × day grain a 12-month window will exceed 1000 rows.
`adAccounts(orgId)` needs no change — it already selects `id, provider, customer_id, name, practice_id`, which is everything the mapping-health and join paths require.

`adSpend` gains exactly one column, `customer_id`. The join needs it and there is no other way to reach `practice_id` from a spend row; adding one text column keeps the performance path narrow while making the per-practice fix possible. It does not gain the campaign or engagement columns — those stay exclusive to `adSpendDetailed`.

`unmappedPipelineCount` reuses the existing `adChannelPipelineRepository.channelMap(orgId)` and the `pipeKey(accountId, pipelineId)` helper rather than introducing a second notion of what "mapped" means — the count must agree with the one `getPerformance` already returns.

## Error handling

- A missing or unreadable mapping table yields an empty array for that surface with the other two still populated, rather than failing the whole request. A partially-configured org must still see what it does have.
- `unattributedSpendPence` is `0`, never null — it is a computed sum over rows that exist, so zero is a real measurement.
- Money fields on spend rows are real sums and therefore never null. The null-means-unknown rule applies to derived cost metrics, which this endpoint does not compute.

## Testing

The backend has vitest and CI runs it, so this work is test-driven.

- **`ad-attribution.isolation.test.mjs`** — every new repository method added to the enumeration that asserts `organisation_id` is pinned. This suite exists to catch exactly the cross-tenant leak that the `serviceClient` path makes possible; a new method not listed there silently weakens it.
- **`ad-attribution.repository.test.mjs`** — assert the exact select strings for the new methods and that `adSpendDetailed` runs the 1000-row paging loop.
- **`ad-attribution.service.test.mjs`** — mapping-health aggregation, including: an account mapped to a practice with no spend; an account unmapped; a GHL subaccount with `practice_id` null excluded from `pipelinesUnmapped`; an Emergent business intentionally unmapped.
- **New unit tests for `accountPracticeByCustomerId`** — including the case where the same `customer_id` exists under two providers, which the composite key exists to handle.
- **Spend endpoint** — `byAccount` and `byCampaign` reconcile to the same total; `unattributedSpendPence` accounts for the remainder; the `practice_id` filter excludes unmapped accounts.

`docs/API.md` gains entries for both new endpoints, per the repo's standing rule that any new endpoint is documented there.

## Explicitly out of scope

- Any write path. Mapping is edited on the existing `/settings/ad-attribution` screen.
- Any migration or connector change. `ad_metrics.practice_id` stays null; the join makes it irrelevant rather than backfilling it.
- Frontend work. Consuming these endpoints — the account-level mapping panel, the clickable Spend tile, exact overlap — is a separate piece of work.
- `reach` and `frequency` at campaign level, for the summability reason above.
