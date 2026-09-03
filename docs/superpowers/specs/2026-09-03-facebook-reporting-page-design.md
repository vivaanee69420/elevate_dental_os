# Facebook Reporting page — design

**Date:** 2026-09-03
**Status:** awaiting review
**Sub-project:** 2 of 4 (see "Where this sits")

## Problem

Sub-project 1 landed the data: `ad_meta_adsets` and `ad_meta_ads` now hold Meta
spend and performance at day grain on a rolling 92-day window, and migration
`000148` is applied on hosted. Nothing renders it. The owner's original request
was a Facebook report covering "campaign, ad sets and ads reports and for
everything we need to have cost per lead, cost per booking and cost per
acquisition, and total spend and spend per campaign".

## Where this sits

1. **Deep-grain pull** — DONE (`docs/superpowers/specs/2026-09-03-ads-deep-grain-pull-design.md`, PR #3).
2. **Facebook Reporting page** — this spec.
3. **Google Reporting page** — next. Will ship spend/clicks/keywords/Quality
   Score/impression share but no CPL/CPB/CPA: Google lead attribution through
   GoHighLevel is negligible until CallRail lands.
4. **CallRail integration** — last, per the owner's chosen order. Fills the
   Google page's lead layer. Ingestion shape already recorded in the
   sub-project 1 spec.

## MULTI-TENANT REQUIREMENTS

This is a first-class section because the owner raised it twice: *"we are
building it for multitenants not just for us"* and *"for everything we do we
need to keep in mind that it is for multi tenants"*. A sub-account is a client
organisation the agency provisions; every requirement below is about working
for ANY of them, not for the org whose data happened to be available while
designing.

**M1. The org id comes only from `req.user.organisation_id`.** Never from a
query parameter, never from a body field. Verified in
`backend/src/middleware/auth.js`: under an agency switch `actingOrgId` becomes
the target sub-account after validating `target.parent_organisation_id ===
agencyOrgId`, and that value is what lands in `req.user.organisation_id`. So an
endpoint that reads org from there works per sub-account with no extra code,
and one that accepts an org parameter is a cross-tenant hole.

**M2. No lead is identified by a CRM's own vocabulary.** An earlier draft of
this design selected Meta leads with `attribution_source = 'Paid Social'`. That
is a GoHighLevel label. Another tenant's GHL may label it differently or not at
all, and the page would show nothing while appearing to work. The test is
structural instead: a lead belongs to Meta if its `ad_campaign_id` appears in
that org's own Meta rows. String matching against a CRM's taxonomy is
forbidden anywhere in this feature.

**M3. Every coverage figure is computed per tenant and displayed, never
assumed.** The numbers gathered while designing — 5,475 Meta leads with a
campaign id, 4,695 with an ad id, 86% ad-set coverage — describe ONE
organisation. Another tenant may have zero ad-id coverage or complete
coverage. The page shows each tenant its own figure.

**M4. Four distinct states, each with its own copy.** A generic empty table is
a bug in a multi-tenant product, because most tenants will sit in one of these
states rather than the happy path:

| State | Behaviour |
|---|---|
| Meta not connected for this org | Prompt to connect, link to Integrations. No table. |
| Connected, never synced | "Waiting for the first sync" — never "no data" |
| Synced, zero ad-id coverage | Platform metrics only; funnel columns absent with a stated reason |
| Non-GBP accounts present | Reuse the `excludedAccounts` surface from sub-project 1 |

**M5. Nothing assumes this tenant's volumes.** The funnel read is paged on the
established idiom (order on a unique key, `.range()`, stop on an EMPTY page
never a short one). Ads inside an expanded ad set are capped with an explicit
"show more" rather than rendering every row, so a tenant with ten times the ad
count does not hang the page.

**M6. Gating matches the sibling marketing pages exactly.**
`requirePermission('marketing.view')` on the route; the nav entry respects
`SECTION_FEATURE` so an org with the Marketing module disabled never sees it;
Reception stays locked out (project rule 5). Practice scope comes from the
shared `useScopePeriod`, not a local control that could disagree with the rest
of the dashboard.

**M7. The "Ad set not identified" row renders only when non-empty.** A tenant
with complete coverage never sees a row explaining a problem they do not have.

**Explicitly OUT of scope:** an agency roll-up that reads across
`organisation_id` to show every sub-account in one table. That deliberately
crosses the boundary which is currently the hard tenant guard, so it needs its
own isolation design and an agency-admin-only gate. It is a separate
sub-project, not a column on this page. The reconciliation service already
accepts an account set, so adding it later is a parameter change rather than a
rewrite.

## Findings that shape the design

Measured on the live database on 2026-09-03, for ONE organisation (see M3):

- `contacts.ad_set_id` is **0 of 96,382** rows. GoHighLevel never sends it.
- `contacts.ad_id` is present on **4,695** of the 5,475 contacts that carry a
  campaign id, and every one is an 18-digit Meta ad id.
- `ad_meta_ads.parent_id` **is** the ad set id.

Therefore ad-set attribution does not need a name match: a lead's `ad_id`
joins to `ad_meta_ads.entity_id`, whose `parent_id` names the ad set. Exact,
and immune to renaming.

The 780 leads with a campaign but no ad id could in principle be matched by
`utm_medium` against ad-set names. **They will not be**, and this is a
deliberate choice: `ad_meta_adsets` is empty until the first sync, so the
claim that those strings match ad-set names is UNVERIFIED. Designing on an
unverified join is how invented attribution ships. Once the first sync lands,
the real overlap can be measured and the decision revisited with evidence.

## Architecture

### Lead identity at the finer grains

`ad_lead_conversions` (migration `000144`/`000146`) already returns one row per
lead carrying `booked_at`, `attended`, `converted`, `is_new_patient` — the
funnel. It carries `ad_campaign_id` but not `ad_id`, which lives on `contacts`.

**Widen `ad_lead_conversions` with `ad_id`, appended LAST**, exactly as
`ghl_pipeline_id` was added in `000146`. Appending keeps every existing
positional consumer working. One lead-matching implementation continues to
serve every grain; a second copy at ad grain would be two definitions of
"booked" that can disagree.

### New RPC: `ad_meta_funnel`

```
ad_meta_funnel(p_org uuid, p_since timestamptz, p_until timestamptz,
               p_practice uuid DEFAULT NULL)
RETURNS TABLE (
  campaign_id text, ad_set_id text, ad_id text, practice_id uuid,
  leads bigint, booked bigint, attended bigint,
  patients bigint, new_patients bigint
)
```

Reads THROUGH `ad_lead_conversions` so booked/attended/new-patient keep one
definition, resolves the ad set by LEFT JOINing `ad_meta_ads` on
`(organisation_id, entity_id = f.ad_id)` and taking its `parent_id`, and groups
by `(campaign_id, ad_set_id, ad_id, practice_id)`. A lead whose ad set cannot
be resolved emits `ad_set_id IS NULL` — that is the "not identified" bucket,
and it carries leads but never spend.

`LANGUAGE plpgsql` with `RETURN QUERY EXECUTE ... USING`, `SECURITY DEFINER`,
`SET search_path = public`, and the mandatory grant idiom. A `LANGUAGE sql`
body with `SECURITY DEFINER` cannot be inlined, gets planned with `p_org`
UNKNOWN, and has measured 10.7s against 608ms on this exact RPC family.

Restricted to Meta by construction (M2): the join to `ad_meta_ads` is what
makes a row a Meta row. No `attribution_source` string appears anywhere.

### Service

`backend/src/services/facebook-report.service.js` — new file, so
`marketing.service.js` (already 502 lines) does not grow further.

It joins three inputs and owns every derived figure:
- spend/impressions/clicks/reach per grain from `adGrainRepository.rollup`
  (`meta_adset`, `meta_ad`) — already paged;
- campaign-grain spend from `marketingRepository.campaignSpendByProvider(...,
  'meta_ads')`;
- the funnel from `ad_meta_funnel`, paged.

Derived: CTR, CPC, CPL, CPB, CPA. Every one is `null` on a zero denominator,
never `0` — a cost per nothing is unknowable, not free. Coverage is computed
here (`leadsWithAdSet / leadsTotal`) so the page can state each tenant's own
figure.

### Endpoints

```
GET /api/marketing/facebook/campaigns
GET /api/marketing/facebook/campaigns/:campaignId/adsets
GET /api/marketing/facebook/adsets/:adSetId/ads?cursor=
```

All `requirePermission('marketing.view')`. Window and practice default
server-side from the shared scope, as the reconciliation endpoint now does —
so the client and server never compute a window on different clocks. The ads
endpoint is cursor-paged for M5.

### Pages

Following the repo's existing `marketing-campaigns` → `[campaignId]` idiom and
the expandable-row pattern from `PLMarginScreen`:

- `/marketing-facebook` — campaign table, each row linking onward.
- `/marketing-facebook/[campaignId]` — that campaign's ad sets, each row
  expandable in place to reveal its ads.

Two routes, one level of in-place expansion: deep-linkable, the back button
works, and ad sets are comparable without a page load per ad. One new nav
entry, **Facebook**, in the existing Marketing section.

New slice `frontend/features/marketing/facebook/` (api, hooks, components) so
the existing marketing slice does not accumulate a second page's worth of code.

## Columns, and what is deliberately absent

Per tier: spend, impressions, clicks, CTR, CPC, leads, booked, attended,
patients, CPL, CPB, CPA.

- **Attended is Dentally-only** and labelled. A GoHighLevel booking cannot say
  whether someone turned up.
- **No platform-conversions column at ad set or ad level.** Meta's `actions`
  are not requested at those grains (recorded as a known divergence in the
  sub-project 1 spec), so the column would be a permanent zero
  indistinguishable from "converted nobody". Campaign-grain conversions remain
  on the existing Campaigns page.
- **Reach appears at ad-set level only, marked non-additive.** It counts unique
  people; summing it is always wrong.

## Testing

- **Multi-tenant isolation:** an org id is never read from a request parameter;
  two orgs' data never mix. A test asserts `p_org` on every RPC call.
- **Zero-coverage tenant:** a tenant with no `ad_id` on any contact gets
  platform metrics and a stated reason, not a single "not identified" row.
- **Not-connected and never-synced tenants** each render their own copy.
- **Costs on a zero denominator are `null`**, not `0` — per tier.
- **Ad-set resolution is by id:** a renamed ad set still resolves; a lead with
  no `ad_id` lands in the null bucket rather than being guessed.
- **Paging discriminates:** read-count assertions, not row-total assertions —
  a row total cannot tell a correct pager from one that stops on a short page.
- **`ad_lead_conversions` widening is additive:** existing consumers still
  pass unchanged.

## Migration

One migration, `20260101000149_ad_meta_funnel.sql`: widen
`ad_lead_conversions` with `ad_id`, add `ad_meta_funnel`, grants, and
`NOTIFY pgrst, 'reload schema';`. Idempotent and additive.

## Risks

| Risk | Mitigation |
|---|---|
| A tenant has no ad-id coverage, making the ad-set tier empty | M4's third state: platform metrics with a stated reason |
| Ad counts far exceed this org's | M5: cursor-paged ads, capped expansion |
| Widening `ad_lead_conversions` breaks a consumer | `ad_id` appended last; existing consumers tested unchanged |
| CPL at ad-set level divides complete spend by partial leads | The null bucket makes the unattributed remainder visible rather than silently inflating every ad set's CPL |
