# Emergent Daily Cash-Up + Monthly P&L Ingestion — Design

Date: 2026-07-14
Status: Draft (spec #1 of the "GM Daily Command Cockpit" programme)

## Context

The GM Dental group runs a manual daily ops sheet ("Daily Cash-Up") and a
monthly P&L sheet inside the external **Emergent** ops app. Emergent already
pushes one feed into Dental-os today — `treatment.accepted` per-patient rows,
stored in `treatment_accepted` (see
`2026-06-16-emergent-practice-mapping-and-webhook-design.md`). Emergent has now
been extended to emit the **full** Daily Cash-Up snapshot and the **full**
Monthly P&L per business, over both pull endpoints and webhooks.

This data is the foundation for the forthcoming **Daily Command Cockpit** (a
separate spec). This spec covers ONLY the ingestion + storage of the two new
Emergent feeds. It deliberately does not build the cockpit page or any
ad-platform lead fetch.

### Why this feed, not Dentally/QBO/GHL

The cockpit is GM-only and must be "fully automatic" with no daily manual entry
inside Dental-os. Emergent is where GM's staff already key these numbers daily,
and it pushes them to us — so it is the most reliable, in-our-control source.
It is also richer than our existing integrations for this purpose: it carries a
till cash-up figure (no digital equivalent elsewhere), per-channel lead source
counts, and a real per-business monthly P&L.

## Goals

1. Store every field of the Daily Cash-Up and Monthly P&L feeds, losslessly.
2. First-time **backfill** of history via Emergent pull endpoints.
3. Ongoing real-time updates via **webhooks**, mirroring the existing
   `treatment.accepted` webhook contract exactly.
4. No double-counting between the per-patient `treatment.accepted` events and
   the `patients[]` array embedded in the Daily Cash-Up snapshot.
5. Money stored as integer pence throughout (project rule 2).
6. Custom fields a CEO adds to the Emergent form (`extra="allow"` schema) flow
   through automatically with no schema change.

## Non-goals (separate specs)

- The Daily Command Cockpit page and its aggregation service (spec #2).
- Fetching individual leads from Google / Meta ad platforms (spec #3; gated by
  Meta App Review and Google lead-form webhooks).
- Any change to targets, breakeven config, or the `businesses` grouping layer
  (those belong to the cockpit spec).

## Data sources

All endpoints authenticate with `X-API-Key` (the existing per-org key stored
encrypted in the `integrations` row, provider `emergent`). Row/sheet/month
elements are **byte-identical** to the corresponding webhook `data` object, so a
single mapper serves both the pull and webhook paths.

### Pull (backfill)

| Endpoint | Purpose | Envelope |
| --- | --- | --- |
| `GET /api/public/daily-cashups?start_date=&end_date=&business_id=&limit=` | per-day sheets | `{ count, sheets: [ …44 fields identical to daily_cashup.saved… ] }` |
| `GET /api/public/monthly-pl?start_month=&end_month=&business_id=&limit=` | per-month rows | `{ count, months: [ …47 fields identical to monthly_pl.saved… ] }` |

The `/summary` variants (`/daily-cashups/summary`, `/monthly-pl/summary`) return
range roll-ups. They are **not** used for storage (we store per-row and
aggregate ourselves) but may be used later for a cheap reconciliation
cross-check; noted, not built here.

### Webhooks

`POST /webhooks/emergent/:token` — existing route, raw body,
`X-Webhook-Signature: sha256=<hmac>` verified against the per-org
`config.webhook_secret`, event name in `X-Webhook-Event` / body `event`.
Envelope: `{ event, fired_at, data: {…} }`.

New event types to handle (existing `treatment.accepted|updated|deleted`
unchanged):

- `daily_cashup.saved` — full sheet snapshot for one business+day.
- `monthly_pl.saved` — full P&L for one business+month.

## Storage schema — migration `000110`

Design principle: **typed pence/int columns for every known field** (detailed,
directly queryable) **plus JSONB** for genuinely custom fields, per-line notes,
and the full raw payload (so custom CEO-added fields survive with no migration).
Money helper: `poundsToPence(x) = Math.round(Number(x || 0) * 100)`.

### `emergent_daily_cashup` — one row per (org, business, day)

Keys / attribution:
- `id uuid pk default gen_random_uuid()`
- `organisation_id uuid not null` (FK organisations)
- `business_id text not null`
- `business_name text`
- `practice_id uuid` (nullable; resolved via `emergent_practice_map` +
  fuzzy fallback — same `loadResolution` used by the treatments feed)
- `cashup_date date not null`
- `external_id text not null` — unique on **(organisation_id, business_id,
  cashup_date)**; a re-saved sheet upserts, never duplicates. Mirrors the
  provided `id` shape (`<business_id>_<date>`).

Typed pence:
- `cash_up_money_taken_pence bigint`
- `tx_plan_given_value_pence bigint` (from `total_tx_plan_given_value`)
- `total_refunds_pence bigint`
- `detail_patient_money_total_pence bigint`

Typed ints:
- `treatments_accepted int` (`treatments_accepted` == `num_treatment_accepted`;
  store once)
- `tx_plans_given int`
- `num_bookings int`, `num_new_leads int`, `num_follow_ups int`,
  `num_attended int`
- `total_chairs int`, `chairs_used int`
- `reviews_collected int`, `before_after_pictures int`,
  `video_testimonials int`, `practice_plan_signups int`
- `detail_patient_rows_count int`

Known lead-source counts (typed int columns):
- `source_google`, `source_facebook`, `source_walk_in`,
  `source_friends_family`, `source_wl_website`, `source_dentist_referral`,
  `source_instagram`, `source_youtube`, `source_other`

Numeric:
- `chair_utilisation numeric(6,2)` (e.g. 85.50)
- `variance_manager_vs_detail numeric` — stored verbatim as sent. Semantics per
  Emergent are a mismatch indicator (see Open Questions); we do not derive it.

JSONB (extensible):
- `custom_sources jsonb` — any `source_*` key not in the known set above
  (e.g. `source_referred`, `source_existing`) → `{ referred: 2, existing: 1 }`
- `refunds jsonb` — `[{ amount_pence, reason, patient_name }]` (small, always
  replaced whole; not worth a child table)
- `raw jsonb` — full payload, lossless

Text / audit:
- `appointment_booked_for text`, `crm_system_notes text`
- `emergent_created_at timestamptz`, `emergent_created_by text`
- `synced_at timestamptz default now()`, `updated_at timestamptz default now()`

Not stored here: `patients[]` — those upsert into `treatment_accepted` (see
Dedup). Only the `detail_*` totals stay on this row for the cash-up variance.

Indexes: unique `(organisation_id, business_id, cashup_date)`;
`(organisation_id, cashup_date)` for range reads.

### `emergent_monthly_pl` — one row per (org, business, month)

Keys / attribution: `id`, `organisation_id`, `business_id`, `business_name`,
`practice_id` (nullable, same resolution), `period_month date` (the 1st, e.g.
`2026-08-01`), `external_id` unique on **(organisation_id, business_id,
period_month)**.

Typed pence roll-ups:
- `revenue_pence`, `gross_profit_pence`, `net_profit_pence`,
  `total_cost_of_sales_pence`, `total_operating_expenses_pence`,
  `cash_collected_pence`, `tx_accepted_amount_pence`, `bank_balance_pence`

Numeric: `average_wait_time numeric` (minutes)

Known cost-of-sales lines (typed pence columns):
- `principal_fees_pence`, `hygienist_therapist_pence`, `lab_fees_pence`,
  `materials_pence`, `sedation_services_pence`

Known operating-expense lines (typed pence columns):
- `advertising_marketing_pence`, `bank_charges_pence`,
  `business_rates_rent_pence`, `salaries_staff_cost_pence`,
  `telephone_wifi_pence`, `utilities_pence`, `insurance_pence`,
  `management_fees_pence`, `subscriptions_pence`, `it_expenses_pence`,
  `card_machine_charges_pence`

JSONB (extensible):
- `custom_lines jsonb` — any cost/expense line not in the known sets above
  (pence), so CEO-added lines survive without a migration
- `line_notes jsonb` — every `*_notes` field keyed by its line
  (`{ principal_fees: "3 associates", advertising_marketing: "Meta + Google" }`)
- `raw jsonb`

Text / audit: `notes text`, `emergent_created_at/by`, `last_updated_at`,
`last_updated_by`, `last_updated_by_email`, `synced_at`, `updated_at`.

Indexes: unique `(organisation_id, business_id, period_month)`;
`(organisation_id, period_month)`.

### `treatment_accepted` — enrich (currently drops these into `raw`)

Add persisted columns, backfilled from `raw` where present:
- `phone text`, `email text`, `quantity int`, `ext_source text`,
  `ext_campaign text`

`external_id` derivation is **unchanged**
(`sha256(business_id|date|patient_name|treatment|amount)[:32]`) so the
`daily_cashup.patients[]` rows and the standalone `treatment.accepted` events
converge on the same row — idempotent, no double count. `mapRecord` is updated
to populate the new columns (they do not participate in the key).

## Ingestion architecture

Extends the existing `backend/src/lib/integrations/emergent-sync.js` and
`backend/src/services/webhook.service.js`; no new provider, no new webhook
route.

### Mappers (shared by pull + webhook)

- `poundsToPence(x)` — the single money converter.
- `mapCashup(data, orgId, maps)` → `emergent_daily_cashup` row + a list of
  `treatment_accepted` rows derived from `data.patients[]` (each via the
  existing `mapRecord`-style path so `external_id`/practice resolution match).
- `mapMonthlyPl(data, orgId, maps)` → `emergent_monthly_pl` row, splitting known
  vs custom line items into typed columns vs `custom_lines`, and collecting
  every `*_notes` into `line_notes`.
- `cashupExternalId(data)` / `monthlyPlExternalId(data)` — deterministic keys
  from `(business_id, date|month)`.

### Repositories

- `emergent-daily-cashup.repository.js` — `upsert(row)` on the unique key,
  org-scoped reads; `serviceClient` + explicit `organisation_id` filter (repo
  convention).
- `emergent-monthly-pl.repository.js` — same shape.
- Reuse `treatmentAcceptedRepository.upsert` for `patients[]`.

### Pull / backfill (`syncOrg`)

Extend `syncOrg` to pull all three feeds. Window policy mirrors the existing
treatments puller:
- manual `full` → all-time (`start_date=2020-01-01` / `start_month=2020-01`);
- first fill (`!last_sync_at`) → trailing 1 year;
- nightly incremental → trailing ~6 months (cheap overlap; upserts idempotent,
  catches late edits).

Cash-ups page by `start_date`/`end_date` (+`limit`); monthly-pl by
`start_month`/`end_month`. Paginate on `count`/`limit` when a window exceeds one
page. `business_id` param left unset (pull the whole org). Discover businesses
into `emergent_practice_map` on every pull (as the treatments feed already
does), so new businesses appear in the mapping UI immediately. `syncAllOrgs`
unchanged (still fans out over active emergent orgs).

### Webhook dispatch (`webhook.service.emergent`)

After the existing signature verification + `recordWebhookResult('verified')`,
dispatch on the full event string:
- `treatment.accepted|updated|deleted` → existing path, unchanged.
- `daily_cashup.saved` → `emergentDailyCashupRepository.upsert(mapCashup(...))`
  **and** upsert each `patients[]` row into `treatment_accepted`.
- `monthly_pl.saved` → `emergentMonthlyPlRepository.upsert(mapMonthlyPl(...))`.

Fault isolation is preserved: auth/token/signature failures stay hard 401/400;
a transient DB apply error is logged + acked (200) so Emergent does not
auto-disable the webhook — the nightly pull is the reconciliation backstop.

The `data.business_id == null` guard is kept (all three event types carry it).

## Config, auth, deploy

- No new integration row or secret: reuse the existing `emergent` `integrations`
  row (`config.base_url`, encrypted `apiKey`, `config.webhook_secret`).
- The new pull scopes (`daily-cashup.read`, `monthly-pl.read`) are granted to
  the same API key on Emergent's side — no code change needed for scopes.
- Migration `000110` is idempotent (`create table if not exists`, `add column
  if not exists`) and re-applies cleanly on `supabase db reset`. Apply on hosted
  via the Supabase MCP, then `NOTIFY pgrst, 'reload schema';` (PostgREST cache
  gotcha).
- Keep `db/01_schema.sql` in sync with the new tables (unmanaged source copy).

## Testing (vitest, `backend/test`)

1. `poundsToPence` — ints, floats, null/zero, rounding (`4500.0 → 450000`,
   `50.0 → 5000`).
2. `mapCashup` — every known field maps to its typed column; `source_referred`
   → `custom_sources.referred`; refunds → `refunds` jsonb with pence amounts.
3. `mapMonthlyPl` — known lines → typed columns; an unknown line → `custom_lines`;
   `*_notes` → `line_notes`; roll-up pence.
4. `patients[]` dedup — a `daily_cashup.saved` and a `treatment.accepted` for the
   same patient/day collapse to ONE `treatment_accepted` row (same `external_id`).
5. Webhook — signature verify accept/reject for the two new events; unknown
   event ignored; DB error acked not 5xx.
6. Idempotent re-save — same `id` twice updates in place (no dupe).
7. Cross-org isolation — a webhook/pull for org A never writes org B rows.

## Open questions (non-blocking)

- `variance_manager_vs_detail` exact semantics (row-count of mismatches vs flag).
  Stored verbatim; the cockpit spec will decide how to surface it.

## Rollout

1. Migration `000110` (local + hosted, `NOTIFY pgrst`).
2. Mappers + repositories + tests.
3. Extend `syncOrg` pull + `webhook.service.emergent` dispatch.
4. Manual `full` backfill for the GM org; verify counts against the Emergent
   `/summary` endpoints.
5. Confirm live webhook deliveries land (owner sets/keeps the signing secret).

Then proceed to spec #2 (the Cockpit).
