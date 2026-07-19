# Ad Channel Attribution — Design

Date: 2026-07-19
Status: Approved, ready for implementation planning

## Problem

Google Ads and Facebook Ads lead attribution is currently guessed by a regular
expression on the GoHighLevel pipeline name
(`backend/src/services/lead-attribution.service.js:76` — `/facebook|fb/` →
facebook, `/google/` → google, else `other`). A pipeline named "New Enquiries"
is invisible to the classifier; a pipeline renamed in GHL silently changes
channel. Cost per lead and conversion rate inherit that fragility.

Three mappings the operator needs are also missing entirely:

1. **GHL subaccount → practice.** The column `integration_accounts.practice_id`
   exists (migration `000085`) but is only ever set by that migration's
   single-practice backfill. There is no UI.
2. **Pipeline → ad channel.** Does not exist in any form. Replaced by the regex
   above.
3. **Ad account → practice.** The column `ad_accounts.practice_id` exists
   (migration `000069`) and is null on all six live accounts. There is no UI.
   Because of this, cost per lead and ROI can only be computed at group level
   (documented at `lead-attribution.service.js:197-201`).

## Goals

- Replace inferred channel with an explicit, operator-controlled pipeline →
  channel map.
- Give the operator one clean, guided settings screen for all three mappings.
- Produce a new page showing Google vs Facebook spend, leads, cost per lead,
  conversions and cost per acquisition, broken down by practice and over time,
  drillable to the underlying people.
- Leave the Daily Cockpit's behaviour unchanged. The two surfaces converge
  later, as a separate decision.

## Non-goals

- Merging this into the Cockpit. Explicitly deferred.
- Changing the Cockpit's `classifyChannel` regex. It stays until the merge.
- Attributing spend to practices proportionally or by any estimate. Spend is
  either really mapped to a practice or it is reported at group level only.

## Decisions

| Question | Decision |
| --- | --- |
| What does a channel tag on a pipeline mean? | The pipeline **is** the channel. Every lead in a Google-tagged pipeline is a Google lead. No per-lead source override. |
| What is mapped to a practice? | The GHL **subaccount**, not the pipeline. Pipelines inherit their subaccount's practice. |
| Uncategorised pipelines? | Shown as their own **Unassigned** bucket — a visible third column, never folded into Google or Facebook and never guessed. |
| What is a conversion? | A lead matched to an Emergent `treatment_accepted` record. |
| Where does the page live? | New top-level page `/ad-performance`. |
| Subaccounts per practice? | Exactly one. The existing partial unique index on `(organisation_id, practice_id)` for `gohighlevel` in migration `000085` is correct and stays. |
| Pipeline assignment granularity? | Per subaccount. Two pipelines sharing a name in different subaccounts are assigned independently. |

## Data model

One new table. Migration `20260101000114_ad_channel_pipelines.sql`.

```sql
create table if not exists public.ad_channel_pipelines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  ghl_pipeline_id text not null,
  pipeline_name text,          -- cached from GHL config for display
  channel text not null check (channel in ('google_ads','meta_ads')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, integration_account_id, ghl_pipeline_id)
);
```

The **absence of a row means unassigned**. There is no `'unassigned'` channel
value; representing it as a row would require writing a row for every pipeline
just to say nothing about it, and would make a newly created GHL pipeline
indistinguishable from a deliberately excluded one.

`channel` uses the same vocabulary as `ad_metrics.provider`
(`'google_ads' | 'meta_ads'`) so spend and leads join without a translation
layer.

No other schema change. Subaccount→practice and ad-account→practice reuse
existing columns.

## Backend

A new domain slice, following the repository → service → controller → routes
layering. Nothing in the Cockpit slice changes except one extraction (below).

### Shared matcher extraction

`lead-attribution.service.js` already matches a lead to an Emergent accepted
record by **phone (last 10 digits) → email → practice-scoped normalised name**
(`matchAcceptedValue` at `:27`, `buildAcceptedByKey` at `:48`). The new page
needs exactly that logic.

Extract it verbatim into `backend/src/lib/lead-emergent-match.js` and have both
services import it. This is a pure move with no behaviour change — the Cockpit
must produce byte-identical output before and after, which is the acceptance
criterion for that step. Duplicating the matcher instead would let the two
surfaces drift apart, which is precisely the class of bug that produced the
earlier lead-count discrepancies.

### New files

- `backend/src/repositories/ad-channel-pipeline.repository.js` — CRUD on
  `ad_channel_pipelines`, org-scoped via an explicit `.eq('organisation_id', …)`
  filter on every query, per the service-client convention.
- `backend/src/repositories/ad-attribution.repository.js` — reads for the
  performance page: leads by pipeline/practice/date, accepted treatments,
  ad spend by provider/practice/date.
- `backend/src/services/ad-attribution.service.js` — assembles the settings
  payload and computes the performance figures.
- `backend/src/models/adAttribution.model.js` — Zod schemas.
- `backend/src/controllers/ad-attribution.controller.js`
- `backend/src/routes/ad-attribution.routes.js`, mounted in `app.js`.

### Endpoints

All under `/api/ad-attribution`, gated `requireRole('owner','practice_manager')`.

- `GET /config` — everything the settings screen needs in one call: connected
  GHL subaccounts with their current `practice_id` and lead counts; every
  pipeline across every subaccount with its current channel (or none) and lead
  count; the org's practices; the ad accounts with their current `practice_id`.
- `PUT /pipelines/:integrationAccountId/:pipelineId` — body `{ channel }` where
  channel is `'google_ads' | 'meta_ads' | null`. Null deletes the row, returning
  the pipeline to Unassigned.
- `PATCH /subaccounts/:id` — body `{ practice_id }`. Delegates to the existing
  GHL account update path rather than writing `integration_accounts` directly.
- `PATCH /ad-accounts/:id` — body `{ practice_id }`.
- `GET /performance?from&to&practice_id` — the page payload:
  `{ channels: [...], byPractice: [...], trend: [...] }`.
- `GET /leads?from&to&channel&practice_id` — the drill-in list.

### How performance is computed

1. Load the pipeline → channel map and the subaccount → practice map.
2. Load leads in the window. Assign each a channel from its pipeline's map entry
   (absent → `unassigned`) and a practice from its subaccount.
3. **Dedupe to people**, keying on `contact_id` when present and falling back to
   `lead:<id>`. Counting opportunity rows rather than people was the cause of an
   earlier inflated lead count; this is a load-bearing step, not an optimisation.
4. Match each person to a `treatment_accepted` row via the shared matcher.
   Matched → conversion; sum `value_pence` for accepted value.
5. Sum `ad_metrics.spend_pence` by provider and, where `practice_id` is set, by
   practice.
6. Derive: `cost_per_lead = spend / leads`, `cost_per_acquisition = spend /
   conversions`, `conversion_rate = conversions / leads`. Every one is null when
   its denominator is zero — never zero, never infinity.

The `unassigned` channel reports leads, conversions and accepted value, but
`spend`, `cost_per_lead` and `cost_per_acquisition` are **null** — there is no
spend to attribute to it, and rendering zero would misread as free leads.

Per-practice rows report spend only for practices with mapped ad accounts.
Practices with none show spend as null with a "not mapped" indicator, following
the established "Not reporting, never £0" rule.

All money stays in integer pence end to end.

## Frontend

### Settings — `/settings/ad-attribution`

One page, three numbered steps, each a `Card`. Steps 2 and 3 render but are
visually de-emphasised with a short explainer until step 1 has at least one
subaccount mapped, so the operator is guided through the order that makes the
data correct rather than confronted with three equal panels.

**Step 1 · Connect subaccounts to practices.** A row per connected GHL
subaccount: label, location id, its total lead count (so ambiguous labels can be
told apart), and a practice dropdown. Unmapped rows carry an amber status. The
one-subaccount-per-practice constraint means an already-taken practice is
disabled in the dropdown with the reason shown, rather than being offered and
then failing on save.

**Step 2 · Sort pipelines into channels.** Three columns — Google Ads, Facebook
Ads, Unassigned. Each pipeline chip shows its name, its subaccount/practice, and
its lead count. Moving a pipeline is a single click. Unassigned is a permanent,
first-class column with a running count, not an error state: it is how the
operator sees what is not being attributed. Assignment is per subaccount; two
pipelines sharing a name in different subaccounts are separate chips.

**Step 3 · Connect ad accounts to practices.** The same row-and-dropdown pattern
for Google and Meta accounts, each showing provider, account name and spend in
the last 30 days for identification.

### Page — `/ad-performance`

`frontend/app/(dashboard)/ad-performance/page.tsx` and a new feature slice
`frontend/features/ad-performance/` (`api.ts`, `hooks.ts`, components), using the
existing `ScopePeriod` practice/period selector and the shared `components/ui`
primitives.

- **Scorecard** — Google, Facebook and Unassigned side by side: spend, leads,
  cost per lead, conversions, accepted value, cost per acquisition.
- **By practice** — a `DataTable` of the same metrics per practice.
- **Trend** — cost per lead and lead volume by week or month per channel
  (`recharts`, matching existing chart usage).
- **Drill-in** — clicking any lead or conversion figure opens the shared
  `LeadsTable` (name, email, phone, pipeline tag, created, treatment, value)
  filtered to that cell, with an indicator for whether the person matched an
  Emergent record. Per the established leads-table standard, this is the same
  component used elsewhere, not a bespoke list.

Empty and unconfigured states are explicit and actionable: if no pipelines are
categorised, the page says so and links to `/settings/ad-attribution` rather
than rendering zeroes.

## Testing

- **Unit, backend.** Channel resolution (mapped → channel, unmapped →
  unassigned); person-level dedupe collapsing multiple opportunities for one
  contact; null-safety of every derived ratio at a zero denominator; unassigned
  bucket carrying null spend rather than zero.
- **Extraction safety.** A test asserting the Cockpit's attribution output is
  unchanged after the matcher moves to `lib/lead-emergent-match.js`.
- **Tenant isolation.** A cross-org test proving `ad_channel_pipelines` reads and
  writes are scoped by `organisation_id`, matching the existing isolation tests.
- **Frontend.** Typecheck, lint and build. The frontend has no test framework and
  CI does not run frontend tests, so correctness is enforced on the backend side.

## Documentation

- `docs/API.md` — the new endpoints.
- `docs/FORMULAS.md` — cost per lead, cost per acquisition and conversion rate as
  defined here, since the accountant reviews that file before launch.

## Risks and known limits

- **Emergent has no per-lead records for the cash-up counts.** The daily cash-up
  feed carries counts only. Conversions here come from `treatment_accepted`
  rows, which are per-record, so this page is unaffected — but the cash-up
  `num_new_leads` figure shown on the Cockpit will not equal this page's lead
  count, and that difference is expected rather than a defect.
- **Name matching is the weakest matcher tier.** Phone and email are reliable;
  practice-scoped name matching can produce false positives for common names.
  This is inherited from the existing Cockpit behaviour and is not made worse
  here.
- **Spend is only as good as the ad-account mapping.** Until step 3 is completed,
  per-practice cost per lead is null. This is surfaced, not hidden.
- **Live ad spend currently lands in the developer organisation** for some
  accounts, so the Plan4growth ad feed reads empty. That is a data/reconnection
  issue independent of this work.
