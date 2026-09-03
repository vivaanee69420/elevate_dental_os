# Ads deep-grain pull — design

**Date:** 2026-09-03
**Status:** approved, ready for plan
**Sub-project:** 1 of 4 (see "Where this sits" below)

## Problem

The Marketing section reports ad spend at **campaign × day** and no finer. Both
reporting pages the owner wants — Facebook Reporting (campaign / ad set / ad)
and Google Reporting (campaign / ad group / ad / keyword) — are blocked on data
that is not pulled today. Nothing below campaign exists anywhere in the
codebase.

The acceptance criterion, in the owner's words: *"when I tally the data in our
app and in the Google Ads account it should match exactly without any
duplication and data multiplication"*, and the same for Meta.

## Where this sits

The full request decomposes into four sub-projects. This spec covers **only the
first**.

1. **Deep-grain pull** (this spec) — new tables and sync at ad set / ad / ad
   group / keyword grain. No new pages.
2. **Facebook Reporting page** — campaign → ad set → ad drill-down.
3. **CallRail integration** — call ingestion, keyword attribution, phone →
   Dentally matching. Verified 2026-09-03: CallRail fires a **Post-Call
   webhook** on call completion whose payload carries `keywords`, `gclid` and
   `fbclid`, and exposes an API v3 `calls` endpoint (auth
   `Authorization: Token token="..."`). Ingestion must use **both** — webhook
   for real time, scheduled pull for backfill and for gaps left by any delivery
   missed during a deploy or outage — matching the two-path shape already used
   for Dentally, Emergent and GoHighLevel. Note that CallRail returns the
   `gclid` of *most value* for a call rather than strictly first touch, which
   will shape what "keyword-attributed booking" is defined to mean.
4. **Google Reporting page** — campaign / ad group / ad / keyword, with calls
   from (3) as the lead layer.

## Findings that shaped the design

Measured on the live database (project `mkfhpzjbijbachoonytt`) on 2026-09-03,
and verified against current platform API documentation.

### Lead attribution is asymmetric between the platforms

| | contacts with campaign id | with ad id | with ad set id |
|---|---|---|---|
| Paid Social (Meta) | 5,475 | 4,695 | **0** |
| Paid Search (Google) | 197 | 0 | 0 |

- **`ad_set_id` is 0 across all 96,382 contacts.** GoHighLevel never supplies
  it. The ad set survives only as a *name* in `utm_medium` (5,801 of 5,803 Paid
  Social contacts). Any lead-to-ad-set join must therefore be by name and will
  break on rename — a limitation for sub-project 2, recorded here so it is not
  rediscovered later.
- **Google lead attribution barely exists**: 197 contacts against £176,795 of
  Google spend. This is why CallRail is load-bearing rather than optional, and
  why the keyword page ships without our own funnel metrics (below).

### Google: keywords are siblings of ads, not children

The hierarchy is Campaign → Ad Group → { Ads, Keywords }. Ads and keywords are
independent facts about the same ad group. The schema must not imply a
parent-child relationship between them.

### Google: sub-campaign totals do not sum to campaign totals

Sum of keyword cost is always **less than** campaign cost — Dynamic Search Ads
traffic carries no keyword, and Display/Video campaigns have no keywords at
all. Google's own interface shows the same gap. This is not a defect to fix; it
must be *displayed* so it does not read as one.

### Google: average position no longer exists

Removed by Google in September 2019. The ranking signals available on
`keyword_view` today are `search_impression_share`,
`search_top_impression_share`, `search_absolute_top_impression_share`, plus
Quality Score and its three components via `ad_group_criterion.quality_info`.

### Meta: retention limits (changed 12 January 2026)

- Spend / impressions / clicks: **37 months**.
- Reach and other unique-count fields: **13 months**.
- Frequency breakdowns: **6 months**.
- 7-day and 28-day view-through attribution windows removed entirely.
- Since 10 June 2025 the API mirrors Ads Manager's own attribution settings,
  which is why spend and impressions now reconcile cleanly.

**The chosen 92-day window sits inside every one of these limits**, so no metric
is unavailable and no month needs a "not retained" label.

### A latent currency bug

`microsToPence` divides by 10,000 with **no currency conversion**, and
`spendToPence` on the Meta side likewise assumes GBP. One **USD** Google account
is connected. It is currently deselected so no total is wrong today, but
selecting it would silently inflate every group figure. Three further Google
accounts have a null currency.

## Scope

**In:** Meta ad set + ad; Google ad group + ad + keyword. Rolling 92-day window.
Reconciliation panel across both platforms.

**Out:** Google search terms (unbounded volume; own follow-on once real keyword
volumes are visible). Any new reporting page. Any change to `ad_metrics` or to
campaign-level behaviour.

## Architecture

### Five tables, one shared column contract

Campaign grain stays in `ad_metrics`, untouched. Five new tables:

| Table | Grain | Parent |
|---|---|---|
| `ad_meta_adsets` | ad set × day | campaign |
| `ad_meta_ads` | ad × day | ad set |
| `ad_google_adgroups` | ad group × day | campaign |
| `ad_google_ads` | ad × day | ad group |
| `ad_google_keywords` | keyword × day | ad group |

**Why separate tables rather than one table with a `level` column.** A `level`
discriminator means a read that omits `WHERE level = ...` silently sums every
grain together — spend multiplied four or five times over. That is precisely the
failure the owner named as unacceptable. Separate tables make it structurally
impossible: there is no column to forget.

**Why an identical column contract.** The objection to separate tables is five
drifting copies of the same aggregation. Every table therefore carries the same
core columns under the same names, so the aggregation is implemented **once**
and selected by grain (see "Read path"). Generic names (`entity_id`,
`entity_name`, `parent_id`) are a deliberate trade: less self-documenting per
table, but they are what makes a single aggregation possible.

**Shared core columns** (every table):

```
id                uuid primary key
organisation_id   uuid not null references organisations(id) on delete cascade
practice_id       uuid references practices(id) on delete set null
provider          text not null          -- 'google_ads' | 'meta_ads'
customer_id       text not null          -- Google customer id / Meta ad-account id
campaign_id       text not null          -- always present, for drill-down from campaign
campaign_name     text
entity_id         text not null          -- the ad set / ad / ad group / keyword id
entity_name       text
parent_id         text not null          -- ad set id, or ad group id (never null; see note)
entity_status     text
metric_date       date not null
spend_pence       bigint  not null default 0
impressions       bigint  not null default 0
clicks            bigint  not null default 0
conversions       numeric(14,2) not null default 0  -- PLATFORM-reported, not ours
created_at        timestamptz default now()
updated_at        timestamptz default now()
unique (organisation_id, provider, customer_id, parent_id, entity_id, metric_date)
```

**`parent_id` is `NOT NULL` and part of the unique key deliberately.** In Google
Ads the same ad id can be associated with more than one ad group, so
`(entity_id, metric_date)` alone would collide and one ad group's row would
overwrite another's — a silent undercount. Every grain here has a known parent
(ad set and ad group hang off the campaign; ads and keywords off their ad
group), so the column is never null and the key is always complete.

**Per-table additions:**

- `ad_meta_adsets`, `ad_meta_ads`: `reach bigint`, `frequency numeric`.
- `ad_google_keywords`: `match_type text`, `quality_score int`,
  `creative_quality_score text`, `post_click_quality_score text`,
  `search_predicted_ctr text`, `search_impression_share numeric`,
  `search_top_impression_share numeric`,
  `search_absolute_top_impression_share numeric`.

Indexes per table:
`(organisation_id, provider, customer_id, metric_date)` and
`(organisation_id, campaign_id, metric_date)`.

`conversions` is `numeric`, **not** `integer` — a deliberate divergence from
`ad_metrics`, which rounds. Google reports modelled conversions fractionally
(3.5 is a real value in its interface), so rounding would put our figure
permanently a little off the platform's and defeat the exact-tally criterion.

`conversions` holds the **platform's** conversion count and is named as such
everywhere it surfaces. Our own funnel numbers (leads, bookings, patients) are
never written to these tables.

### Write path — replace, never append

One replace RPC per table, mirroring the existing
`ad_metrics_replace_window` (migration 000106) rather than inventing a second
pattern:

```
<table>_replace_window(p_org uuid, p_customer_ids text[], p_since date, p_rows jsonb)
```

Each one:

- takes `pg_advisory_xact_lock` on `(org, table)` **before touching any row**, so
  a concurrent nightly and a manual re-sync queue on a cheap lock instead of
  deadlocking on row locks;
- sets `lock_timeout = 15s`, `statement_timeout = 60s`;
- `DELETE` **all** the org's rows for the selected accounts — not merely those
  from `p_since` forward — then `INSERT ... ON CONFLICT DO UPDATE` the window;
- `DISTINCT ON` the payload so an exact duplicate in one batch cannot abort the
  insert.

This is what makes re-syncs idempotent and makes the platforms' **restatements**
land correctly: Google revises conversions for up to 90 days after the click, so
re-pulling must overwrite the window rather than add to it.

### practice_id stamped at the write choke point

Inherited from `ad_accounts.practice_id` inside the replace RPC, exactly as
`ad_metrics` does. A `restamp_<table>_practices(p_org)` RPC per table backfills
after a mapping change, mirroring `restamp_ad_metrics_practices`.

This is not optional detail: every practice-scoped ad-spend figure in the
product read £0 for months because this stamp was missing on `ad_metrics`
(migration 000140).

### Read path — aggregate RPCs only, never raw table reads

**No repository may select from these tables directly.** At keyword grain a
single practice-month exceeds PostgREST's 1000-row server ceiling, which
truncates *silently* — the failure that made every QuickBooks-derived figure in
the product wrong until last week.

One aggregation RPC, selected by grain:

```
ad_grain_rollup(p_org uuid, p_grain text, p_since date, p_until date,
                p_practice uuid, p_campaign text, p_parent text)
```

- `p_grain` is validated against a **hard-coded CASE** mapping to a literal
  table name. No caller-supplied identifier ever reaches SQL — the grain
  parameter is an allowlist lookup, not an interpolated table name.
- Written `LANGUAGE plpgsql` with `RETURN QUERY EXECUTE ... USING`. A
  `LANGUAGE sql` function with `SECURITY DEFINER` + `SET search_path` cannot be
  inlined, so it gets planned with `p_org` UNKNOWN and degrades catastrophically
  (11.1s vs 55ms measured elsewhere in this codebase).
- Grants follow the mandatory idiom:
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`

### Currency guard

`ad_accounts.currency` is checked at the write choke point. A non-GBP account is
**refused, not converted** — its rows are skipped and the account is flagged in
the integration panel as "currency not supported". Silently treating dollars as
pounds is the failure mode; a visible gap is the safe one. Null-currency
accounts are treated as GBP (current behaviour) but reported in the
reconciliation panel so they can be corrected.

## Sync

**Window:** rolling 92 days, re-pulled in full each night.

Because the replace deletes the account's rows outright and reinserts the
window, **these tables hold exactly the last 92 days and nothing else**. That is
the intended behaviour and it keeps the tables at steady state (~360k rows
across all five at current account volumes) instead of growing without bound.

The consequence, stated plainly: widening the window later does not recover
history from these tables — it requires a re-pull. That is safe, because both
platforms retain far longer than we ask for (Google keeps full account history;
Meta keeps 37 months of spend). Nothing is permanently lost by choosing 92 days
now.

**Google** — three additional GAQL streams per selected account:

| Table | `FROM` | Key fields |
|---|---|---|
| `ad_google_adgroups` | `ad_group` | `ad_group.id/name/status`, `campaign.id/name`, `segments.date`, `metrics.*` |
| `ad_google_ads` | `ad_group_ad` | `ad_group_ad.ad.id`, `ad_group_ad.status`, `ad_group.id`, `metrics.*` |
| `ad_google_keywords` | `keyword_view` | `ad_group_criterion.criterion_id/keyword.text/keyword.match_type`, `ad_group_criterion.quality_info.*`, `metrics.search_*_impression_share`, `metrics.*` |

**Meta** — two additional insights pulls per selected account on the existing
edge, `level=adset` and `level=ad`, `time_increment=1`, fields
`adset_id, adset_name, ad_id, ad_name, campaign_id, campaign_name, spend,
impressions, clicks, reach, frequency, actions`.

Both hang off the existing sync entry points and the existing selected-account
filter. Deselecting an account stops new rows; it does not delete history.

**Rate limits.** Meta throttles harder at ad level than at campaign level, and
Google returns rate limiting as HTTP **403**, not 429 — a trap this codebase has
already hit once on Dentally. Both new pulls reuse the existing backoff and must
treat 403 as retryable, not as an auth failure.

## Reconciliation

The owner's acceptance criterion is that the numbers tally, so the tally is
built into the product rather than left as a manual check.

A reconciliation panel shows, per account and date range:

- our figure beside the platform's, per level;
- for Google, the **unkeyworded remainder** stated explicitly — e.g. "£41,200 of
  £44,800 attributed to keywords; £3,600 (8%) in traffic with no keyword" — so
  the expected gap reads as information rather than a bug;
- for Meta, reach marked **non-additive**, because it counts unique people and
  summing it is always wrong;
- any account skipped for unsupported currency.

What we can promise, and what the panel asserts nightly:

| Metric | Google | Meta |
|---|---|---|
| Spend, impressions, clicks | Exact at every level | Exact at every level |
| Platform conversions | Exact; restated up to 90 days | Exact when attribution settings match |
| Keyword total vs campaign total | Will not sum — by design | n/a |
| Reach | n/a | Never additive |

## Testing

- **Idempotency:** running a sync twice produces identical totals. This is the
  direct test of "no duplication".
- **No cross-grain sum:** a test asserting each table's total independently, and
  that no repository selects from these tables outside the rollup RPC.
- **Reconciliation:** fixture-based — a known payload aggregates to a known
  total at each level.
- **Currency guard:** a USD account's rows are skipped, not converted.
- **Practice stamping:** rows inherit `practice_id`; restamp fixes them after a
  mapping change.
- **Cross-org isolation:** the standing requirement — one org's sync never reads
  or writes another's rows.
- **403 handling:** a rate-limited response retries rather than failing the
  account.

## Migration

One migration, additive and idempotent, re-applying cleanly on a local
`supabase db reset`: five tables, their indexes, five replace RPCs, five restamp
RPCs, one rollup RPC, grants, and `NOTIFY pgrst, 'reload schema';`.

No change to `ad_metrics`, so the 18 backend files and 8 migrations that read it
are unaffected.

## Risks

| Risk | Mitigation |
|---|---|
| Keyword volume larger than estimated | 92-day window caps it; measure after first sync before adding search terms |
| Meta ad-level rate limits slow the nightly sync | Existing backoff; ad-level pull runs after campaign-level so a throttle degrades depth, not the core figures |
| Impression-share values are capped/sentinel above 90% in the API | Verify actual returned values during implementation; display as ">90%" if so |
| Generic column names make raw SQL less readable | Documented contract; the column dictionary already generated for the Data Room covers it |
