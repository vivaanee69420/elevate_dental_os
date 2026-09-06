# Open days, and GoHighLevel as the source of truth for Facebook leads

**Status:** design, awaiting review
**Date:** 2026-09-06
**Supersedes:** the Meta-only open-day model shipped in migrations `000168`/`000169`

## The correction this rests on

Every Facebook lead reaches this system through GoHighLevel. Meta supplies
**numbers** — spend, impressions, clicks — and nothing else. Leads and their
details come from GHL; patients come from Dentally.

The Facebook report does not currently work that way. `ad_meta_lead_ledger`
(`000167`) identifies a Meta lead *structurally*, by its `ad_id` resolving to a
campaign in that org's Meta `ad_metrics`. That makes Meta the arbiter of which
leads exist, and it silently drops every lead Meta did not attribute.

The Google report already does it the right way: `ad_google_lead_ledger`
(`000158`) takes its pool from `ad_channel_pipelines` where
`channel = 'google_ads'` — an explicit operator mapping, not an ad platform's
opinion and not a CRM text label. This spec brings Facebook into line.

## What changes, measured

Every GHL lead for Plan4growth, June–August 2026, grouped by the channel its
pipeline is mapped to:

| Pipeline channel | Leads | of which Meta-attributed |
|---|---:|---:|
| `meta_ads` (mapped) | 1,977 | 1,580 |
| **UNMAPPED** | 1,509 | 280 |
| `google_ads` | 267 | 5 |

Switching the Facebook pool from "Meta attributed it" to "it is in a Meta
pipeline":

- **gains 397 leads** (1,977 − 1,580) that are real Facebook leads with no ad
  attribution and are invisible to the report today;
- **loses 285** (280 + 5) that Meta attributed but whose pipeline nobody has
  categorised as Meta.

Those 285 are not a loss to accept quietly — they are a **mapping gap with a
name**, and the report will say so (see *Coverage*, below). 1,509 leads sit in
pipelines no one has categorised at all.

## Open days, measured

The org runs dedicated GHL pipelines per open day —
`3. Dental Implants Open Days (June + July 2026)`,
`4. Cosmetic Dental Open Day (14th July 2026)`, and four more — holding **432
leads** between them. Of those, 195 carry a Meta campaign id (193 resolving to a
campaign in this org's own metrics) and **237 carry no Meta attribution at
all**.

There are also **several open days per month**, not one: July 2026 alone has
events on the 7th, 8th, 9+11th and 14th, split by practice and treatment. The
monthly routine is "several new campaigns and pipelines at once".

## The model

```
ad_open_days                     the event: name, optional date        (exists)
  ├── ad_open_day_campaigns      Meta campaigns -> its SPEND           (exists)
  └── ad_open_day_pipelines      GHL pipelines  -> its LEADS           (NEW)
```

Spend from the campaigns. Leads from the pipelines. Patients from Dentally on
the money-paid rule (`000167`). Each source answers the question it is
authoritative for, and none answers another's.

### `ad_open_day_pipelines`

```sql
organisation_id        uuid    not null
open_day_id            uuid    not null
integration_account_id uuid    not null   -- pipelines are per GHL subaccount
ghl_pipeline_id        text    not null
created_at             timestamptz not null default now()

PRIMARY KEY (organisation_id, integration_account_id, ghl_pipeline_id)
FOREIGN KEY (organisation_id, open_day_id)
  REFERENCES ad_open_days (organisation_id, id) ON DELETE CASCADE
```

The primary key is the same partition discipline the campaign table uses: a
pipeline belongs to at most one open day, so "always-on" is exactly "not mapped
to an event". The composite foreign key stops a mapping pointing at another
tenant's event even if a service forgets to check.

`integration_account_id` is in the key because the same pipeline name exists in
several subaccounts (`2. Facebook Ads Leads` appears three times) and GHL
pipeline ids are unique only within a location.

## The lead pool

The Facebook report's leads are GHL leads whose pipeline is either:

- mapped to `channel = 'meta_ads'` in `ad_channel_pipelines` — always-on, or
- mapped to an open day in `ad_open_day_pipelines` — that event's.

An open-day pipeline needs **no** channel mapping to count. Mapping a pipeline
to an open day is itself the statement that its leads are that event's, so one
action suffices and a half-finished mapping (event set, channel forgotten) still
reports correctly rather than dropping the event's leads on a technicality.

In practice both will usually be set, because the mapping screen offers them on
one row — but the report must not depend on that.

**A lead's campaign still comes from its `ad_id`**, where it has one. That is
what ties a lead to a campaign, ad set or ad in those tabs. A lead with no
`ad_id` is in the pool and lands in the existing, visible "Not attributed"
bucket rather than being dropped.

### The one judgement

A pipeline mapped to an open day wins over a channel mapping: its leads are the
event's, not always-on's, even where Meta attributed them to an always-on
campaign (67 such leads live today). A human deliberately put the lead in that
pipeline, which says what the lead *is*; the ad click says only where the person
came from. Without a stated winner the same lead lands in both buckets and the
totals stop adding up.

## Arithmetic, and what stays true

Spend partitions cleanly — a campaign belongs to exactly one event or none.
Leads partition cleanly too, because a pipeline belongs to exactly one event or
none. So the split table keeps its identity, and gains a column that says how
much of it Meta can account for:

```
                          Spend      Leads   of which Meta-attributed
Always-on                     .          .                         .
Open days                     .          .                         .
= Total                       .          .                         .
```

Shape only. The real figures are computed per tenant; a plausible number written
into a design document is read as a finding six weeks later.

`of which Meta-attributed` is not decoration — it is what tells a reader when a
cost per lead rests largely on leads the ads cannot be shown to have bought.

## Coverage

The report states its own coverage rather than asking for trust:

> 1,509 leads sit in pipelines that have not been categorised, 280 of them
> carrying Meta attribution. Categorise them on Settings → Ad attribution.

Computed per tenant from that tenant's own rows. This is the honest home for
the 285 leads the pool change drops: they do not vanish, they are named, with
the action that recovers them.

## The Facebook Open days tab

A fourth tab beside Campaigns / Ad sets / Ads, shown **only to tenants that
have at least one open day** — an always-empty tab is noise for everyone else.

- one row per event, newest first: spend, leads, of-which-attributed, booked,
  patients, cost per lead, cost per patient, collected;
- expanding an event lists its campaigns and its pipelines, each with its own
  lead count, so a reader can see what the event is made of;
- clicking a number opens the people behind it, as the cards already do.

The Always-on / Open days split stays on the panel above the tabs: it answers
"how is my advertising divided", not "how did each event do".

## Where pipelines are mapped

The per-subaccount pipeline mapping already exists, as step 2 of
**Settings → Ad attribution** (`PipelineChannelStep.tsx`): grouped by
subaccount, sorted by lead volume, filterable, Google / Facebook / Unassigned
per pipeline, and explicitly refusing to infer from names — an earlier
heuristic there classified the three largest pipelines ("Open Day Archive -
IMPLANTS" and friends, 1122/990/873 leads) as *other* while catching only a
33-lead pipeline with "Google" in its name.

Two things change.

**It gains an open-day column.** One row per pipeline: the channel buttons it
has today, plus — when the channel is Facebook — an optional open day. That
mirrors the report exactly: always-on versus open days *within* Facebook.

**It is mounted in the GoHighLevel tile on Integrations**, beside the other
mapping controls, so "what is this pipeline" is answered in one place rather
than split between Settings and the Meta tile. The SAME component is used, not
a copy: two screens editing one mapping would drift in behaviour. The Settings
step stays where it is for the full attribution walkthrough.

### The gate changes, deliberately

`PUT /api/ad-attribution/pipelines/:accountId/:pipelineId` is
`requireAgencyActor` today. It becomes **owner OR agency actor** — not
owner-only, which would lock out an agency admin who is not an owner of the
sub-account they administer.

This is the second considered departure from the house rule that mapping
mutations are an agency power (open-day writes were the first). The reason is
the same: a tenant launching an open day next month must be able to categorise
its pipeline end to end without waiting on their agency. Ad-account → practice
and subaccount → practice mappings are untouched and stay agency-only, because
those decide how an agency's client data is attributed rather than what a
tenant's own pipeline is.

## The monthly routine

Integrations → Meta Ads → Open days gains a **New since you last mapped**
section: unmapped Meta campaigns and unmapped GHL pipelines, newest first, with
a count badge.

Anything whose name reads like an open day is **pre-ticked with a suggested
event**; nothing is written until the owner presses Confirm. The name is a
shortcut for a human, never the stored answer — the line that separates this
from the practice-name and Emergent fuzzy-matching failures.

The suggestion is generic and fails soft: a tenant whose naming it does not
recognise gets no suggestions and ticks boxes by hand. It can only ever cost a
shortcut, never produce a wrong mapping.

No new fetching is needed. `ad_metrics` and `ad_channel_pipelines` are already
filled by the nightly syncs, so a campaign appears once it has spend and a
pipeline once GHL reports it.

## Multi-tenancy

Every table is org-scoped and every read carries an explicit `organisation_id`
filter, since these repositories run on the service client. Beyond that:

- the suggestion heuristic reads only that tenant's own names, and goes silent
  rather than guessing when it does not recognise them;
- the Open days tab, the split rows, the coverage line and the "new since"
  badge are each computed from that tenant's own rows — a tenant with no open
  days sees the report as it is today;
- open-day writes are `requireRole('owner')` and pipeline mapping becomes
  owner-or-agency-actor (see above); subaccount → practice and ad account →
  practice stay agency-only;
- reads stay behind `marketing.view`, so Reception never sees them (rule 5).

## Out of scope

- **Google open days.** Both mapping tables carry a `provider`/`channel`
  column already, so the model supports it; no UI until asked.
- Changing the Google report. It already works this way.
- Attributing spend to leads with no `ad_id`. They have none, and a share
  invented for them would be a number with no source.

## Testing

- the pool is the union of channel-mapped and open-day-mapped pipelines, and an
  open-day pipeline counts **without** a channel mapping;
- a lead in an open-day pipeline counts under the event even when Meta
  attributed it to an always-on campaign, and is counted exactly once;
- always-on + open days = the whole, for spend, for leads, and for attributed
  leads;
- a pipeline cannot be mapped to two events;
- cross-org isolation: another tenant's event must never claim this tenant's
  pipeline, and the composite foreign key must reject the attempt;
- an org with no open days and no channel-mapped pipelines gets an empty report
  that says why, not a zeroed one that looks healthy;
- the suggestion function proposes but never persists, and returns nothing for
  names it does not recognise;
- a tenant OWNER can set a pipeline's channel and its open day; an agency actor
  who is not an owner of that org still can too; neither can touch another
  org's pipelines.
