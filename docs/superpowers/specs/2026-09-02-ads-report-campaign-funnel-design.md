# Ads report, part A — booking funnel and campaign drill-down

**Date:** 2 September 2026
**Status:** design, approved in brainstorming, not yet implemented
**Branch:** `feat/marketing-campaign-funnel`
**Migrations:** `20260101000144_ad_lead_conversions_booked.sql` (widens the row-level function) and `20260101000145_ad_campaign_funnel.sql` (the aggregate). `000143` is the highest on disk and applied on hosted.

Part A of three. B (ad set and ad grain) and C (Google keywords and search
terms) get their own specs and are deliberately out of scope here; the sections
they will occupy are named at the end so this design does not have to be
reworked when they land.

## The problem

The Marketing section reports spend, leads, and new patients per campaign. It
cannot say what happened between a lead and a patient, and it cannot name the
people behind a campaign's numbers.

So an owner can see that a campaign is expensive but not *where* it leaks. A
campaign producing cheap leads that never book looks identical to one producing
expensive leads that book and attend, until the patient count arrives months
later.

Two questions the section cannot answer today:

- How many of this campaign's leads booked an appointment, and what did each
  booking cost?
- Which named people came from this campaign, and where did each one stop?

## What we hold already

Verified against the live database (`mkfhpzjbijbachoonytt`) on 2 September 2026.

| | |
|---|---|
| `ad_metrics` | 20,227 rows, 140 campaigns, 2025-06-09 → 2026-09-02. Campaign × day. |
| `contacts.ad_campaign_id` | 5,558 populated |
| `contacts.ad_id` | 4,605 populated (Meta) |
| `contacts.ad_set_id` | **0 populated** — the ad set *name* is in `utm_medium`, 306 distinct |
| `contacts.gclid` | 190 populated |
| `ghl_appointments` | 1,149 rows, 714 with a `contact_id` |
| `ad_lead_conversions` (`000142`) | one row per person: converted, is_new_patient, patient_contact |

Attribution splits almost entirely by platform: Paid Social carries 5,192
campaign ids and 4,430 ad ids; Paid Search carries 190 campaign ids and **zero**
ad ids. Google lead attribution below campaign grain is therefore not
achievable, now or in part B, and no design should imply otherwise.

## Definitions

These are the whole design. Everything downstream is plumbing.

**Booked** — the person holds a GoHighLevel calendar booking **or** a Dentally
`appointments` row, subject to two rules that apply equally to both arms:

1. **Cancellations do not count.** GHL status not in (`cancelled`, `invalid`);
   Dentally status not `cancelled`. Excluding cancellations on one side only
   would be indefensible.
2. **The appointment must start at or after the enquiry.** Without this an
   existing patient who enquires again counts as "booked" on a visit from two
   years ago — the same class of error `is_new_patient` was added in `000142`
   to correct.

The Dentally arm probes both the lead contact itself and the `patient_contact`
that `ad_lead_conversions` already matched by email or phone; without that
second probe the signal collapses, because only 52 ad-attributed contacts link
to a Dentally appointment by `contact_id` directly against 157 that resolve
through the match.

The union is not a subset of conversion. On a trailing-three-month sample of
1,861 ad-attributed leads the two arms contributed 77 and 157 for a union of
202, against 190 people matched to a patient record at all — so some people
book a GoHighLevel slot and never reach a patient record. Both arms earn their
place.

Under the two rules above, over the fixed reference window used for
verification (org `1a5f888a-0dfe-4802-acf8-6003665089ad`, 1 June – 31 August
2026 London), the whole lead population is **3,325**, of which **1,946** carry a
campaign id, **533** booked and **323** attended.

The lead figures are stable — the window is closed. The booking figures are a
**floor**: nothing bounds a booking's date from above, so someone who enquired
in August can book in December and the count rises the moment the sync pulls it.
Measured drift of +1 on each within an hour. Verification asserts the lead
counts exactly and the booking counts as a minimum; the durable checks are the
invariants (earliest-booking ordering, no booking before its enquiry, and the
aggregate reconciling to the row-level function in the same session).

**Attended** — a Dentally `appointments` row with status `completed`.

Dentally tracks attendance (last 3 months: 11,553 `completed`, 709 `no_show`,
2,992 `cancelled`). GoHighLevel does not: across its entire history it holds
1,096 `confirmed`, 15 `cancelled` and **2** `noshow`. Nobody updates those
statuses.

Therefore `attended = false` means **unknown**, not *did not attend*, for anyone
whose only booking is a GHL one. The UI states this. A no-show rate is never
computed against a GHL-only denominator.

**New patient** — unchanged from `000142`: converted, and no appointment
starting before the window opened. This, not the looser matched-patient count,
is the CPA denominator; 26% of what was previously reported as acquisition was
an existing patient enquiring again.

**Cost definitions.** CPL = spend ÷ leads. CPB = spend ÷ booked. CPA = spend ÷
new patients. Each is null when its denominator is zero — rendered `—`, never
`£0.00`. A zero that reads as "free" is the failure mode this section has
already shipped once.

## Approach

Considered and rejected:

- **Widen `ad_lead_conversions` and aggregate in JS.** Smallest diff, but that
  function returns 10,429 rows at 2.8s for a year and must be paged around
  PostgREST's 1000-row cap. The campaigns table would inherit that on every
  load. This is the lesson `marketing_monthly_rollup` (`000143`) was written to
  record.
- **A nightly materialised funnel table.** Fastest reads, but a new worker, a
  staleness window and a backfill to solve what a 60-second cache solves.

**Chosen: widen the row-level function, then wrap it in a campaign-grain
aggregate.** The aggregate reads *through* the row-level function, so booked,
attended and new-patient have exactly one definition in exactly one place. The
section already carries duplicated channel-resolution logic between
`marketing_monthly_rollup` and `marketing.service.js`; a third copy is not
acceptable.

## SQL layer

### `ad_lead_conversions` — two new columns

Migration `000144` drops and recreates the function (its return type changes,
as it did in `000142`).

- `booked_at timestamptz` — earliest booking under the definition above; null if
  never booked.
- `attended boolean` — true when a Dentally appointment for that person has
  status `completed`.

Both are bounded `EXISTS` probes keyed on `(organisation_id, contact_id,
starts_at)`, the index `000142` added, plus a new one on `ghl_appointments
(organisation_id, contact_id)`. They cost a probe per person, not a join across
the population.

The body stays `plpgsql` with `RETURN QUERY EXECUTE … USING`. `SECURITY DEFINER`
and `SET search_path` both block SQL-function inlining, so a `LANGUAGE sql` body
is planned generically with `p_org` unknown and never chooses the per-lead index
probes — measured at 10.7s against 608ms for the identical query inline. This is
load-bearing and must not be "simplified".

### `ad_campaign_funnel` — new

```
ad_campaign_funnel(p_org uuid, p_since timestamptz, p_until timestamptz,
                   p_practice uuid DEFAULT NULL)
RETURNS TABLE (ad_campaign_id text, attribution_source text, practice_id uuid,
               leads bigint, booked bigint, attended bigint,
               patients bigint, new_patients bigint)
```

Defined as a grouped select over `ad_lead_conversions(p_org, p_since, p_until,
p_practice)`. Same `plpgsql` + `EXECUTE … USING` shape, same reason.

Grouped by `(ad_campaign_id, attribution_source, practice_id)` rather than
campaign alone, so one call still feeds the campaign table, the channel split
and the practice comparison. Channel is resolved in the service from the
campaign→provider map, exactly as it is today; this function does not resolve
channel and must not start to.

Both functions take the mandatory grant idiom:

```sql
REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION … TO service_role;
```

The migration ends with `NOTIFY pgrst, 'reload schema';`.

## API and service layer

**No new endpoints.** The detail page composes calls that already exist.

`marketing.repository.js` gains `campaignFunnel(orgId, since, until,
practiceId)` — a paged, deterministically ordered read of `ad_campaign_funnel`.
Paged on principle: the row count should sit in the low hundreds, but the
1000-row cap has bitten this file twice and defensive paging costs four lines.
Ordering is required for sound paging, on the full group key.

`marketingService.campaignPerformance` swaps `leadsByCampaign` for
`campaignFunnel`. This is a net performance win — the campaigns screen stops
paging ten thousand person rows in order to count them. `joinSpendToLeads`,
`channelSplit` and `practiceSplit` take pre-aggregated counts instead of person
rows. Channel resolution is unchanged and stays in step with
`marketing_monthly_rollup`.

Row and totals shapes gain `booked`, `attended`, `costPerBookingPence`,
`costPerNewPatientPence`.

`marketingService.leadList` keeps the row-level `ad_lead_conversions` — per-person
detail is its purpose — and gains a `campaignId` filter plus `bookedAt` and
`attended` per row. `campaignId` is validated as a **string**, not a uuid:
`ad_campaign_id` is the ad platform's own text id.

`PAYLOAD_VERSION` bumps. Without it every org is served the previous shape from
cache and the new columns render empty.

Permissions are unchanged: `requirePermission('marketing.view')`. Reception
never holds that key (project rule 5).

## UI

`/marketing-campaigns` gains **Booked**, **Attended** and **CPB** columns, and
each row links to the campaign.

New route `app/(dashboard)/marketing-campaigns/[campaignId]/page.tsx` rendering
`CampaignDetailScreen`:

- **Header** — campaign name, channel badge, status, and `ScopePeriodBar`, so the
  window carries through from the table.
- **Funnel** — Spend → Leads → Booked → Attended → New patients, each stage with
  its cost beneath: CPL, CPB, CPA. A stage with no denominator shows `—`.
- **Attendance caveat, inline** — a GHL-only booking renders as *Booked,
  attendance unknown*. Two recorded no-shows in GoHighLevel's entire history is
  not an attendance rate.
- **People** — the campaign's leads with a *Stage reached* column: Enquired /
  Booked / Attended / New patient.

The detail page reads `useMarketingPerformance()` (already cached, shared with
the table) for the header and funnel, and `useMarketingLeads({ campaignId })`
for the people. No new hook, no new endpoint.

`LeadsScreen`'s table body is extracted to
`features/marketing/components/MarketingLeadsTable.tsx` and shared by
`/marketing-leads` and the detail page, so the two can never show the same
person differently.

**Deliberate deviation:** `features/cockpit/components/LeadsTable.tsx` is the
documented shared lead table, but it is typed to `CockpitLeadLine` — pipeline
name and treatment-accepted value. Bending a marketing row into that type costs
the *Stage reached* column, which is the point of the drill-down. The standard's
intent — one table wherever the same leads are shown — is met within the section.

No seventh nav item.

## Testing

Backend, vitest, following `test/marketing*.test.mjs`:

- `booked_at` is the earlier of the two arms when a person has both.
- A `cancelled` or `invalid` GHL booking does not count as booked.
- A Dentally appointment on the **matched patient contact** counts, not only one
  on the lead contact — the case that separates 157 from 52.
- `attended` is false for a GHL-only booking, and the response marks it unknown
  rather than not-attended.
- CPL / CPB / CPA are null, not zero, on a zero denominator.
- `ad_campaign_funnel` totals reconcile to `ad_lead_conversions` over the same
  window and practice.
- Cross-org isolation: a second org's leads and bookings never appear.
- Repository paging: stop on an empty page, not a short one.

Frontend has no test framework; `npm run typecheck` and `npm run lint` must be
clean.

## Rollout

Backend and frontend ship together but the change is additive — new columns on
an existing payload, one new route. No breaking shape change, so no forced-
together constraint of the kind Call Reporting v2 carried.

Migrations `000144` and `000145` are applied on hosted after merge, in that order, followed by `NOTIFY pgrst,
'reload schema';`. Verify the two functions exist with the new signatures and
that `anon`/`authenticated` hold no EXECUTE.

## What this does not do

- **Ad set and ad grain.** `ad_metrics`'s unique key is
  `(org, provider, customer_id, campaign_id, metric_date)` and both syncs pull
  campaign level only. Part B adds a new table and new sync levels; it lands as
  tiers *inside* this detail page, not as new pages.
- **Google keywords and search terms.** Part C.
- **Revenue and true ROAS.** Every figure here stops at "became a new patient".
  `invoice_items` and Emergent `treatment_accepted` hold real money; extending
  the conversion function to carry it is a separate piece of work.
