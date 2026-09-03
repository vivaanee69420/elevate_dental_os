# CallRail and Google lead conversions — design

**Date:** 2026-09-03
**Status:** awaiting review
**Sub-project:** 3 of 4. Precedes the Google Reporting page, which consumes this.

## Problem

Google Ads leads mostly arrive as **phone calls**, and a phone call leaves no form for GoHighLevel to attribute. That is why `contacts.ad_campaign_id` covers 5,312 Meta contacts and only 137 Google ones.

The owner reports roughly **50 Google Ads calls a month, of which 25 to 30 book an appointment**. Measured against what the product can currently see over the same 92 days:

| | Visible today | Reality |
|---|---|---|
| Google leads | 260 | 260 + ~150 calls |
| Bookings | 34 | ~75-90 from calls alone, plus the visible ones |
| Google spend (92 days) | £41,686 | — |

So cost per booking currently reads **£1,226** where the true figure is nearer **£360**. The distortion is not only in the total: calls convert at roughly 50-60% while form fills convert at 13%, so omitting calls makes Google look far worse at converting than it is.

## Two phases, and why the UI comes first

The owner asked to build the UI first. Rather than backing it with stubs that get thrown away, it is backed by the data that **already works**.

**Phase A — the lead-conversion surface, on mapped-pipeline leads.** `ad_channel_pipelines` already maps five GoHighLevel pipelines to `google_ads`, holding 260 leads. Matching those to Dentally today yields 60 patients, 34 bookings and 23 treatment starts — real, plausible figures. The surface ships useful.

**Phase B — CallRail ingestion**, feeding the same funnel. It adds rows; it does not change the shape. Nothing built in Phase A is rebuilt.

This also unblocks Phase A from an unresolved question about the CallRail account (below).

## The dedup rule — the heart of this

The owner's standing demand is that numbers tally with no duplication. Two sources will now describe the same human being: a CallRail call and a GoHighLevel pipeline lead. Someone who rings *and* fills in a form is **one lead**, not two.

**One person, one lead, across both sources:**
- The dedup key is the **normalised 10-digit phone** first, then the **normalised email**. CallRail always supplies a phone and rarely an email; GoHighLevel supplies both. Phone is therefore primary.
- Reuse `normaliseEmail` / `normalisePhone` from `backend/src/lib/sheet-export/normalise.js`, and the `email_norm` / `phone10` columns already on `contacts`. Do not write a second normaliser: two normalisation rules would silently disagree about who is the same person.
- **First touch wins.** The earliest timestamp across both sources is the lead's date, matching how `ad_lead_conversions` already picks a person's earliest lead.
- **Repeat callers collapse.** The same number ringing three times is one lead. Without this, CPL falls by however often people ring back, which flatters it for no reason.

## Existing patients are counted separately, never folded in

An existing patient ringing the tracked number about an unrelated matter is not a new lead. CallRail cannot tell; the product can — `ad_lead_conversions` already computes whether a person had an appointment *before* the lead date.

Such callers are reported as their own figure ("23 new patients, 4 existing") rather than silently included or silently dropped. Folding them into CPA would flatter it; dropping them without saying so would hide real demand the ads produced.

## What CPA means

**CPA is spend divided by people who STARTED TREATMENT** — a `treatment_plans` row with a `start_date`, reached through the matched Dentally patient. Verified populated: 14,882 plans, every one with a start date, 10,342 linked to a contact.

This is stricter than "matched to a patient record", and deliberately so: someone can be a matched patient without ever starting treatment. Both are shown — *Patients* (matched) and *Started treatment* (acquired) — so the drop-off between them is visible rather than hidden inside one number.

The Facebook page's existing `patients` figure uses the looser definition. It gains the stricter one too, so the two pages cannot mean different things by acquisition.

## Storage

**A new `callrail_calls` table, NOT rows in `leads`.**

Writing calls into `leads` would reuse the existing machinery, but it pollutes a GoHighLevel-shaped table with rows that have no pipeline, no opportunity and no GHL id — and it makes the cross-source dedup implicit at write time, where it is invisible and unfixable. A separate table keeps the sources distinct and makes the dedup an explicit, testable step at read time.

Columns: `organisation_id`, `practice_id`, CallRail's own call id (unique per org, for idempotent re-ingestion), the tracking number called, the caller's number and its `phone10`, `email` and `email_norm` where supplied, `started_at`, duration, answered/missed, `gclid`, `keyword`, `campaign`, `source`, and the raw payload for forensics.

## The surface

One tab, **Google lead conversions**, on the Google Reporting page.

**A row of cards, not another wide table** — the owner was explicit that extras belong hidden inside the cards rather than on display:

- **Spend**
- **Leads** — with CPL beneath
- **Booked** — with CPB beneath
- **Started treatment** — with CPA beneath

**Every card states its denominator.** "CPA £7,113" invites the question; "£7,113 · 23 patients started treatment" answers it, and makes a suspicious figure self-diagnosing.

**Clicking a card opens the people behind it** — name, email, phone — so "who actually came from this" is answerable in one click. Inside each card, secondary figures that do not deserve their own tile: attended, existing-patient count, and the split between calls and form fills.

**One caveat the page must state:** spend covers every Google account, while leads come only from mapped pipelines and tracked numbers. If an account's leads land in an unmapped pipeline, its spend counts and its leads do not, inflating all three costs. The page shows which pipelines are mapped, so a gap is visible rather than silent.

## MULTI-TENANT REQUIREMENTS

Carried forward and binding:

- **The org id comes only from `req.user.organisation_id`** — never a request parameter. Under an agency switch it is already the sub-account's.
- **CallRail credentials are per-organisation**, encrypted via `lib/crypto.js` like every other provider, and a call is only ever matched against contacts of its own organisation.
- **No coverage figure is assumed.** Each tenant sees its own.
- **Nothing assumes this tenant's call volume.** Ingestion pages; the people list behind a card pages.
- **Gating** matches the sibling marketing routes: `requirePermission('marketing.view')`, `ROUTE_PERMISSION`, and the Marketing section's `SECTION_FEATURE`. Reception stays out per project rule 5.
- **The people list shows patient names, emails and phone numbers.** That is the tenant's own patient data, already visible to the same roles under Contacts — but it must never cross an organisation boundary, and Reception must not reach it.

## Ingestion (Phase B)

Both paths, as every other integration here does — a webhook alone loses anything arriving during a deploy, and cannot reach calls from before connection:
- **CallRail Post-Call webhook** for real time. Its payload carries `keywords`, `gclid` and `fbclid`.
- **A scheduled pull** of CallRail's API v3 `calls` endpoint for backfill and gap-filling. Auth is `Authorization: Token token="<key>"`.

Idempotent on CallRail's own call id, so a webhook and a pull describing the same call produce one row.

**OPEN QUESTION, blocking Phase B only.** Does this CallRail account use a **Google-Ads-specific tracking number**, or one pool for all practice calls? If it is a single pool, "every call is a Google lead" would sweep in organic and referral callers, and ingestion must instead key off CallRail's own source field per call. Phase A does not depend on the answer.

Note also that CallRail returns the `gclid` of **most value** for a call rather than strictly first touch, which will matter when keyword-level attribution is added.

## Testing

- **Dedup:** one person appearing as both a call and a pipeline lead counts once; three calls from one number count once; first touch sets the date.
- **Existing patients** are reported separately and never counted in CPA.
- **CPA** counts only people with a treatment plan carrying a start date.
- **Costs are `null` on a zero denominator**, never `0`.
- **Cross-org isolation:** a call never matches a contact of another organisation.
- **Idempotent ingestion:** the same call ingested twice yields one row.
- Paged reads assert **read count**, not row total.

## Migration

One migration, `20260101000150_callrail_calls.sql`: the table, its indexes, the funnel RPC, grants following the mandatory revoke idiom, and `NOTIFY pgrst, 'reload schema';`.

## Risks

| Risk | Mitigation |
|---|---|
| A single-pool tracking number makes every call look like a Google lead | Open question above, resolved before Phase B; Phase A unaffected |
| Repeat callers inflate the lead count | Dedup on `phone10`, first touch |
| Spend covers accounts whose leads are unmapped, inflating all costs | Stated on the page with the mapped pipelines shown |
| A call and a form fill from one person double-count | Explicit cross-source dedup at read time, with a test |
