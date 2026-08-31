# Marketing section and ad lead attribution — design

**Date:** 2026-08-31
**Status:** design, not yet planned
**Sub-project:** B of the multi-tenant SaaS push. Sub-project A (agency model, feature
gating, isolation audit) shipped 2026-08-31 — see
`2026-08-31-saas-feature-gating-and-isolation-design.md`.

## Why this exists

A sub-account needs to answer one question: *for every pound we spend on Google and
Facebook, how many leads did we get, what did each cost, and how many became patients?*

Today it cannot. The two existing marketing screens — `/marketing` (Marketing & ROI)
and `/ad-performance` — take their spend from `ad_metrics` (platform-direct, tenant-safe)
but their **lead** side from GoHighLevel pipelines mapped by hand. A fresh sub-account
gets real spend next to an empty lead column.

The original plan was to fetch leads directly from the ad platforms. **That plan is
dead**, and the evidence is below. What replaced it is better and ships sooner.

## What we verified

All findings are from read-only probes against the live Plan4growth connections on
2026-08-31. They are the load-bearing facts of this design; do not re-litigate them
without re-running the probes.

### Google lead forms are an empty well

Customer `6846708190` spends ~£3,100/month across 6 enabled campaigns (40k impressions,
2,045 clicks, ~125 conversions in 30 days) and has **exactly one lead form asset with
zero submissions in 30 days**. Its conversions are not form fills: `Calls From Ads` 52,
`Clicks to call` 23, `Local actions` — directions 108, website visits 102, other
engagements 448. Every `WEBPAGE` form-fill conversion action is REMOVED and at 0.
Campaign types are SEARCH and PERFORMANCE_MAX driving the website and phone calls.

`lead_form_submission_data` would return nothing. **Not in scope.**

### Meta lead retrieval is unobtainable

261 `OUTCOME_LEADS` campaigns (21 active), and 28 of 35 active ad sets are
`destination_type = ON_AD` — genuine Instant Forms whose leads *are* retrievable in
principle. But `leads_retrieval` requires App Review **and Business Verification**, and
the owner has stated they cannot verify the app. **Not in scope, and not deferred —
abandoned.**

### GoHighLevel already carries campaign- and ad-level attribution

This is the finding the design rests on. `GET /contacts/?locationId=` returns a
non-empty `attributions[]` on **100/100** contacts — in the *list* response, so it costs
**zero extra API calls** on top of the contact pull that already runs nightly.

```json
{ "utmSessionSource": "Paid Social", "adSource": "facebook", "medium": "facebook",
  "utmSource": "facebook", "utmCampaign": "Dental Implant Open Day Sept 26",
  "utmCampaignId": "120249721894530517", "utmAdId": "120249722055010517",
  "utmMedium": "Photos | 35+ | 258K | 03/08/26", "utmContent": "AD 2",
  "mediumId": "1687229395721152", "isFirst": true }
```

Note the field names: the **list** endpoint uses `utm`-prefixed keys (`utmCampaignId`,
`utmAdId`), while the **single-contact GET** uses bare `campaignId`/`adId` for the same
values. Read the list shape; a reader written against the single-GET shape silently
finds nothing.

**The join is verified.** `utmCampaignId` `120249721894530517` → `ad_metrics` meta_ads
campaign "Dental Implant Open Day Sept 26": £1,472.65 spend, 105,437 impressions, 2,400
clicks, 10–31 Aug 2026. All 8 sampled campaign ids are present in `ad_metrics`
(140 distinct campaigns).

Coverage over 2,400 sampled contacts across 4 subaccounts:

| | share |
|---|---|
| `attributions[]` present | 92.3% |
| `utmCampaignId` **and** `utmAdId` present | 55.6% |
| First-touch source: Paid Social | 1,338 |
| Social media (organic) | 415 |
| Paid Search | 152 |
| Third Party / CRM Workflows / Other / Direct | 290 |

### Google leads attribute through a different key

Paid Search contacts carry **no** `utmCampaignId`. They carry `utmGclid` on **305/305
(100%)**, plus `gbraid` (110), `utmTerm`/`utmKeyword` (36/26), and `utmCampaign` on only
8. The campaign id is nonetheless recoverable, because it is embedded in the landing
page URL the visitor arrived on:

```
https://gmdentalbarnet.dentaloffers.co.uk/orthodontist-lp/?gad_source=1&gad_campaignid=22794584316&gclid=CjwKCAjw...
```

This also confirms Google leads are **landing-page fills flowing into GHL**, not native
lead forms — consistent with the empty-well finding above.

### Lead-to-patient conversion is measurable

25,127 GHL lead contacts (24,689 with an email) against 63,349 Dentally patients (43,320
with an email): **6,318 match by email, 6,629 by phone** (last 10 digits).

The combined figure **timed out** as a naive OR/`right()` join. It must use the indexed
UNION-ALL-of-equi-joins RPC pattern already established in `cockpit_accepted_lead_source`
(migration `000112`) — never one OR'd join, which forces a nested loop over every lead in
the org and times out through PostgREST while running fine in the SQL editor.

## Non-goals

- Direct lead retrieval from Google or Meta. Dead, per above.
- Meta App Review or Business Verification. Not happening.
- Call tracking. Google's real lead signal is phone calls (52 + 23 in 30 days); that is
  a separate product and a separate spec.
- Replacing `/marketing` or `/ad-performance`. Owner decision: both stay untouched. The
  new section ships alongside them.
- Working leads inside Elevate. This is reporting only — no pipeline, no assignment, no
  response-time SLA.

## Architecture

Four layers, each independently testable.

### 1. Attribution ingest (GHL)

Extend the existing contact pull in `gohighlevel-sync.js` to persist `attributions[]`.
No new API call, no new scope, no extra request budget.

`contactRow()` and `extractContact()` currently map only id/name/email/phone. Add a pure
`extractAttribution(contact)` that picks the first-touch row (`isFirst === true`, falling
back to `attributions[0]`) and returns a flat record. Keep it pure and separately
exported so the poll path and the webhook path map identically — the precedent set by
`contactRow`.

First touch, not last, matches the existing decision in `cockpit_accepted_lead_source`:
attribution is first touch, otherwise a patient later moved into an "Open Day" pipeline
steals credit from the ad that actually won them. Persist both where present, but every
read defaults to first touch.

Write to `leads`, whose `utm_source`/`utm_medium`/`utm_campaign` columns exist and are
**100% NULL across all 29,491 rows** because nothing has ever written them. New columns
alongside (migration `000137`):

| column | source | note |
|---|---|---|
| `ad_campaign_id` | `utmCampaignId`, else parsed `gad_campaignid` | joins `ad_metrics.campaign_id` |
| `ad_id` | `utmAdId` | Meta only |
| `ad_set_id` | `adSetId` when present | Meta only |
| `gclid` | `utmGclid` | Google |
| `landing_page_url` | `pageUrl` | source of the `gad_campaignid` parse |
| `attribution_source` | `utmSessionSource` | "Paid Social", "Paid Search", … |
| `attribution_tier` | derived | see §3 |

`utm_source`/`utm_medium`/`utm_campaign` get populated too, since they exist and are free.

**No backfill worker. Opportunistic fill instead** (owner decision). The nightly pull
already walks every contact — `pullContacts` fetches the full page set and then filters
*writes* to rows whose `dateUpdated` is newer than `since`. So a contact's attribution is
already in memory and is currently discarded. The fill is therefore: when a contact has
been fetched and its attribution columns are still empty, write them, even if the contact
itself is unchanged. No separate worker, no re-pull, no extra API requests.

Two consequences to design for. `MAX_PAGES = 50` caps a routine run at ~5k rows per
resource, so coverage builds over several nightly runs rather than landing at once — that
is acceptable and must be visible, which is what the coverage bar is for. And the write
must be genuinely conditional: an unchanged contact whose attribution is already present
gets no write at all, or the incremental sync degenerates into a full rewrite every
night.

### 2. Google campaign resolution

Two routes, primary first:

**A. Parse `gad_campaignid` from `landing_page_url`.** Free, synchronous, no API call.
A pure function with its own tests. Coverage across the whole lead set is unmeasured —
**measure it during implementation before relying on it.**

**B. `gclid` → Google Ads `click_view`.** Exact, and the fallback where the URL carries
no `gad_campaignid`. Constraints that shape the design: `click_view` has a **90-day**
window and **must be queried one day at a time** (`segments.date` must be a single day).
So this is a nightly job over yesterday's unresolved gclids, not a bulk backfill — leads
older than 90 days with no `gad_campaignid` are permanently unresolvable to a campaign
and stay at channel tier.

### 3. Attribution tiers

Every lead resolves to exactly one tier, and **every figure in the UI declares its
tier**. A blended number must never quietly present itself as a measured one.

| tier | how | precision |
|---|---|---|
| `campaign` | `ad_campaign_id` joins `ad_metrics` | campaign, and ad for Meta |
| `channel` | pipeline → channel via `ad_channel_pipelines` | Google vs Facebook only |
| `unattributed` | neither | counted, never apportioned |

Tiers are strictly ordered: a lead that resolves at `campaign` never consults the
pipeline map. The pipeline map exists solely for the residue, which inverts its role
from primary mechanism to fallback — and is what shrinks the mapping screen from 113
decisions to a handful.

`ad_channel_pipelines` is unchanged. No migration.

### 4. Conversion (lead → patient)

Separate from, and never conflated with, the platform's own `conversions` column.
Google and Facebook count a form submission; Elevate counts someone who walked in.
Both are shown, labelled distinctly.

A lead is converted when its contact's email **or** phone matches a Dentally patient
(`contacts.pms_external_id is not null`). New RPC `ad_lead_conversions(p_org, p_since,
p_until, p_practice)` built as a **UNION ALL of equi-joins** — one arm on normalised
email, one on the last 10 phone digits — never a single OR'd join. Add the supporting
functional indexes in the same migration; the naive form times out today at 25k × 63k.

Revenue attribution reuses the accepted-treatment path already proven in
`cockpit_accepted_lead_source`.

### 5. Multi-level ad metrics

`ad_metrics` stays exactly as it is — campaign × day — because Cockpit, Marketing & ROI,
Ad Performance, Business Hub and the Data Room all read it. Sub-campaign rows must never
land in it: every one of those screens would silently inflate.

Deeper levels go in a new pair (migration `000138`):

- `ad_entities` — the dimension. `(organisation_id, provider, account_id, level,
  entity_id)` → name, status, `parent_entity_id`, objective, creative thumbnail/headline.
- `ad_insights` — the facts. One row per entity per day, carrying `level` and
  `parent_entity_id`, plus spend/impressions/clicks/reach/frequency/conversions.

Mixed grains in one table means **every query must filter `level`**, enforced in the
repository, never by convention.

Also fix at sync time: Meta's `actions` breakdown is currently collapsed by a regex into
a single `conversions` integer, so 12 form leads and 3 purchases are indistinguishable.
Store the breakdown per action type.

Grain policy — campaign/ad set/ad daily over the existing 90-day incremental and 183-day
backfill windows; keywords and demographic/placement breakdowns at campaign level over
~90 days. At ad × age × gender × day over full history a single org is ~1M rows and
needs Meta's async report API; that is not worth it until someone asks a question that
requires it.

## Surfaces

### Marketing section

A **new top-level nav section**, structured like Overview — a section heading with
several pages beneath it, not a single screen. Module key `marketing` in
`lib/features.js` (`kind: 'module'`, `default: true`, `navSection: 'Marketing'`), so the
agency can toggle it per sub-account like any other. Gated on a new `marketing.view`
permission key.

The existing `Marketing & ROI` (under Growth) and `Ad Performance` (under Overview) stay
exactly where they are, untouched — owner decision. This section is the third marketing
surface and the only one that works without GoHighLevel pipeline mapping.

Reception must not see it — rule 5 confines Reception to Inbox, Pipeline and Contacts.
Follow the Call Reporting precedent, which is deliberately gated on `growth.view` rather
than `crm.view` for exactly this reason.

Screens, in drill order: **overview** (spend, leads, CPL, patients, cost per patient,
Google vs Facebook, per practice) → **campaigns** (the table, sortable, with tier badges)
→ **campaign detail** (ad sets, ads, creative, and the leads themselves) . Money is
integer pence end-to-end; display `(pence/100).toLocaleString('en-GB')`.

Every lead list on this section uses the shared `LeadsTable`, per the established
cockpit standard — no bespoke per-panel lead tables.

### Attribution mapping screen

Replaces `features/ad-attribution`'s three-step wizard. Mockup:
https://claude.ai/code/artifact/33fa0836-9344-4f72-8ae4-4541ff46ebff

The redesign follows from the tier model. Because most leads self-attribute, the screen
stops being a 113-row classification chore and becomes an exception queue:

- **Coverage first, weighted by leads not pipelines.** A bar showing matched /
  paid-but-untagged / not-paid, which moves as decisions are made, so the work has a
  visible end.
- **Ranked by leads at stake**, not alphabetically.
- **Evidence inline** — the dominant source, top campaign, landing page — so each
  decision is informed rather than guessed.
- **Suggestions only above 60% dominance**, otherwise an explicit "No confident
  suggestion". Elevate never infers channel from a pipeline's *name*: the three largest
  pipelines are "Open Day Archive - IMPLANTS" (1,122 leads), "dental implants open days
  archive" (990) and "Implants Open Days Archive" (873), and none of them names a
  channel. This preserves the no-inference rule already documented in
  `PipelineChannelStep.tsx`.
- **The automatic half shown as proof**, with real cost per lead, so it is trusted
  rather than assumed.

Mapping mutations stay `requireAgencyActor`-gated with reads open, per Sub-project A.

## Tenant story

A fresh sub-account connects Google Ads, Meta Ads and GoHighLevel. Spend and structure
arrive from the platforms; leads arrive from GHL and self-attribute where tagged. Where
a tenant runs landing-page funnels rather than tagged ads, the mapping screen is the
escape hatch — "using landing pages? connect GoHighLevel and map your pipelines" — and
the coverage bar tells them honestly how much of their volume that covers.

## Multi-tenancy and security

Standard rules, no exceptions: every new table carries `organisation_id` (rule 3); RLS
enabled with no policies, matching the Emergent-era tables, since repositories read via
`serviceClient`, which has **no** automatic isolation — every query filters
`organisation_id` explicitly. Body-supplied FKs go through `assertOrgOwns`, and freeform
patches through `stripImmutable`; PostgREST embeds are joins with no org predicate and
have leaked cross-org PII before. All mutations audit to `audit_log` (rule 9).
`NOTIFY pgrst, 'reload schema';` after every hosted DDL.

Lead PII (name, email, phone) is already stored; this adds no new category. The
attribution fields are ad identifiers, not personal data.

## Risks

| risk | mitigation |
|---|---|
| `gad_campaignid` coverage unknown across the full lead set | Measure before building route B. If low, `click_view` becomes primary and Google attribution is 90-day-bounded. |
| 55.6% campaign coverage may not hold beyond the 2,400 sample | Backfill reports true coverage; the bar shows it honestly rather than hiding it. |
| Opportunistic fill turns the incremental sync into a nightly full rewrite | The write is conditional on the attribution columns being empty, not on the contact being fetched. Pin it with a test. |
| Coverage builds slowly because `MAX_PAGES` caps a routine run at ~5k rows | Expected and acceptable; the coverage bar makes the ramp visible rather than hiding it. |
| `ad_insights` mixed grains double-count | `level` filter enforced in the repository; tests pin it. |
| Deleted GHL pipelines strand mappings | Absence of a row already means unassigned — no migration needed. |

## Phasing

1. **Attribution ingest + opportunistic fill.** Nothing else works without this data.
   Ends with a real, measured coverage number.
2. **Tiers + conversion RPC.** Campaign-level CPL and lead-to-patient conversion.
3. **Marketing section**, overview and campaigns, off `ad_metrics` + tier data.
4. **Mapping screen** rebuild.
5. **Ad set / ad depth** (`ad_entities` + `ad_insights`, Meta action breakdown).
6. Keywords and demographics, only if asked for.

Phases 1–3 deliver the whole question the section exists to answer. 4 removes the
operational pain. 5–6 are depth.

## Open questions

1. `gad_campaignid` coverage across all leads — resolve in phase 1.
2. Should `/marketing` and `/ad-performance` eventually fold into this section? Owner
   said keep both for now; revisit once the new section is real.
3. Does the Marketing section need its own practice scope, or does the shared
   `ScopePeriod` + practice scope suffice? Assume the shared one until proven otherwise.
