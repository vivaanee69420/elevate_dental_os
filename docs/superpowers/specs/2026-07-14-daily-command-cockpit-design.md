# Daily Command Cockpit — Design (Spec #2)

Date: 2026-07-14
Status: Draft
Depends on: Spec #1 (Emergent cash-up + monthly P&L ingestion) — DONE, data live.

## Context

GM Dental group wants a single-page "Daily Command Cockpit" (per the
`GM_Dental_Daily_Cockpit_3.html` reference) showing, for an editable date
window, the day's operational picture across their businesses. All the source
data now exists in the app:

- **Emergent daily cash-up** (`emergent_daily_cashup`) — 424 rows live: revenue
  proxy (cash_up_money_taken), treatments accepted, tx plans given/value, new
  leads, bookings, attended, chair utilisation, lead-source counts, refunds,
  per-patient rows.
- **Emergent monthly P&L** (`emergent_monthly_pl`) — 72 rows live: revenue,
  gross/net profit, cost lines, cash collected, bank balance.
- **Emergent treatments accepted** (`treatment_accepted`) — source-tagged
  (google/facebook/organic…), phone/email, value.
- **GHL ad leads** — per dental subaccount, dedicated `Facebook Ads Leads` /
  `Google Ads Leads` pipelines, leads linked to contacts (name/email/phone).
- **Ad spend** (`ad_metrics`) — Google + Meta spend, group-level.

This spec is GM-only but built on generic tables.

## Goals

1. An on-screen cockpit page with an editable From/To window driving all
   sections (except Monthly, which always tracks the calendar month).
2. Sections: (1) Revenue vs target, (2) Treatment & Close, (3) **Lead ROI /
   channel comparison**, (4) Cash Up, (5) Profit vs Breakeven, (6) Monthly
   revenue — plus the watch→lever table.
3. The **lead comparison** (the priority): per channel (Google/Facebook) and per
   practice — GHL leads → matched Emergent conversions → ad spend → CPL,
   conversion %, ROI.
4. Light theme (rule 1), British English (rule 4), money in integer pence.

## Non-goals

- Ad-platform lead fetch via Google/Meta APIs (not needed — GHL is the source).
- The 09:30 email digest (fast-follow after the page is trusted).
- Multi-tenant onboarding UI polish (GM-only for now).

## Data model (new — migration `000111`)

- **`businesses`** — `id, organisation_id, name, sort_order, active`. The
  grouping layer. Seeded for GM: Fixed Teeth Solutions, GM Dental (4 clinics),
  etc. `practices.business_id` nullable FK.
- **`business_targets`** — `business_id, daily_target_pence, effective_from`.
  Group target = sum. Monthly target = daily × trading weekdays.
- **`cockpit_settings`** (org-level) — `breakeven_source ('emergent'|'manual'|
  'quickbooks'), monthly_working_days int default 20`.
- **`breakeven_config`** (per practice) — `fixed_cost_monthly_pence,
  contribution_margin_pct` (manual path).
- **`ghl_pipeline_channel_map`** — `organisation_id, integration_account_id,
  ghl_pipeline_id, channel ('google'|'facebook'|'instagram'|'other'),
  business_id/practice_id`. Owner-confirmable; auto-seeded by name regex
  (`facebook`→facebook, `google`→google). This is what classifies a lead's
  channel. Nullable channel = intentionally excluded.

## Lead ↔ conversion matching

- A GHL lead → `contacts` (phone/email). An Emergent `treatment_accepted` row →
  `source` + phone/email in `raw`. Match a lead to a conversion when the
  normalised phone OR lower(email) matches AND the Emergent `source` equals the
  lead's channel (or, looser, ignore source and rely on the phone/email match).
- Per channel/practice/window:
  - **Leads** = count of GHL leads in that channel's pipeline(s), created in
    window.
  - **Conversions** = leads whose contact matches an Emergent accepted treatment
    in window.
  - **Spend** = `ad_metrics` spend for that provider in window (group-level →
    shown at group level; per-practice spend only if `ad_accounts.practice_id`
    set, else "—").
  - **CPL** = spend ÷ leads; **Conv %** = conversions ÷ leads; **ROI** =
    matched treatment value ÷ spend.

## Backend

- Migration `000111` + seed for GM businesses & channel map.
- `business.repository.js`, `cockpit.repository.js`, `cockpit.service.js`
  (assembles all sections for `{since, until}` + a calendar-month block).
- A `lead-attribution.service.js` (or within cockpit.service) does the
  GHL-lead ↔ Emergent-conversion match per channel/practice.
- Endpoints: `GET /api/cockpit?since&until` (owner + practice_manager);
  config CRUD (owner) for businesses, targets, breakeven, settings, channel map.
- Tests (vitest): channel classification, lead↔conversion match (phone/email),
  target scaling, breakeven source toggle, cross-org isolation, pence.

## Frontend

- `frontend/features/cockpit/` slice; page `app/(dashboard)/cockpit/`.
- Light-theme port of the 6 sections + watch→lever table; `ScopePeriodBar`
  drives the window; Monthly ignores it. Section 3 shows the channel comparison
  table (per practice + per channel) + group totals.
- A Cockpit Setup screen (businesses, targets, breakeven toggle, pipeline→channel
  map with name auto-suggest).

## Honesty guarantees

- Per-practice: revenue/cash-up/treatment/leads/conversions ✓. Spend per
  practice only where `ad_accounts.practice_id` is set, else group-level with a
  note. No fabricated cells — missing data reads "—".

## Phasing (build order)

1. Migration + businesses/channel-map seed + config read.
2. `cockpit.service` + `/api/cockpit` (Emergent-backed sections) + tests.
3. Lead-attribution (channel comparison) service + wire into section 3 + tests.
4. Cockpit page (light port) + setup screen.
5. (fast-follow) 09:30 email.
