# ETL pipeline, rehearsal organisation and analyst-ready Data Room

**Date:** 2026-08-27 · **Status:** design, awaiting owner review · **Owner deadline:** data analyst starts **Monday 1 September 2026**

Builds on `2026-08-25-data-room-design.md` (Data Room + `analyst` role, shipped on `feat/data-room`).

## Why

Three goals came out of the design conversation with the owner, in priority order:

1. **The analyst must be productive on 1 September.** They need rows per practice, per period, downloadable as CSV *and* Excel, with the business rules already applied so their numbers reconcile to the app's cards, and a dictionary that explains every column.
2. **Store less patient data.** The hosted database was exposed (service-role key in the public repo; keys have since been rotated to secret keys in prod and local). The owner wants the re-pull to fetch only what reporting and the analyst need: no date of birth, address, clinical notes, message bodies or the raw Dentally patient JSON (which carries NHS/NI numbers and medical alerts). Names, emails and phones **stay** — the app's CRM screens need them.
3. **Every synced row traceable to the run that wrote it, and re-pulls that are one command, not a hand-written repair script.** Four past mapper bugs (Title-case DNA states, `updated_since`, revenue misclassification, NULL `practice_id` on treatment plans) each needed a bespoke re-sync.

And one hard constraint: **the existing organisation's data, integrations and mappings are not touched.** The new pipeline is proven on a *rehearsal organisation* that re-pulls through the same integrations; the owner compares old vs new before any cutover decision.

## Decisions taken with the owner

| Topic | Decision |
|---|---|
| Raw landing layer (untouched API JSON in a `raw` schema) | **Rejected** — the owner does not want a second copy of the data. `public.*` stays the single copy. |
| External warehouse (BigQuery/Snowflake) | Rejected — 1 GB of data, no need. |
| Separate `analytics` schema + read-only SQL login | **Deferred** — the Data Room, extended, is the analyst's space. SQL access can be added later if the analyst asks. |
| Analyst scope | Internal analyst on the owner's side, cross-tenant is irrelevant today (one real organisation). PII gate stays as shipped: PII columns only for an owner who explicitly asks. |
| Minimisation level | **Option 3**: keep name/email/phone; drop `date_of_birth` (→ `birth_year`), `address`, `postcode` (→ `postcode_district`), `notes` (contacts, appointments), `contacts.pms_patient`, `communications.body`. Consequence accepted: the Inbox shows who/when but not message text. |
| Re-pull window | **12 months for every source, payments included** (owner's decision 2026-08-27). The rehearsal org will therefore hold no pre-window cash history; cashflow trend screens that read the 2020→ payments feed will differ from the old org for that reason alone, and the comparison report treats that as expected. |
| Destructive steps | **None in this spec.** No truncate, no column drops. Cutover (promote the rehearsal org, or apply the same reset to the old org) is a separate decision after the comparison. |
| Rehearsal org outbound behaviour | Read-only towards the outside world: no Google Sheets *writer*, board-report emails, WhatsApp report, notifications or workflows are copied. |
| Webhooks | Stay pointed at the old org (Dentally's API key cannot register a second endpoint; GHL/Emergent push to one URL). The rehearsal org is nightly/manual-sync only. |

## Current state (facts the design relies on)

- 13 nightly sync jobs in `backend/src/workers/index.js` call per-provider connectors in `backend/src/lib/integrations/*-sync.js`. Each maps API JSON to typed rows inline and upserts into `public.*`. This *is* the ETL; what is missing is the framework around it.
- Every synced table has a unique key on the source identifier (`(organisation_id, source, pms_external_id)` for Dentally tables, `(organisation_id, ghl_opportunity_id)` for leads, `(organisation_id, external_id)` for communications/payments/invoices, `(org, provider, customer_id, campaign_id, metric_date)` for `ad_metrics`, …). Re-pulls therefore update in place — no duplicates.
- Integration secrets are AES-GCM encrypted with the global `INTEGRATIONS_SECRET_KEY` (`lib/crypto.js`), not per organisation → rows can be copied between organisations and still decrypt. Webhook tokens are signed per `orgId` (`lib/webhook-token.js`) → the rehearsal org gets its own.
- Connector windows today: Dentally on-connect 12 months (`RECENT_MONTHS`), nightly 6 (`BACKFILL_MONTHS`); QuickBooks/Xero first-fill 12, nightly 6; Google/Meta Ads `FULL_DAYS = 183`, `INCREMENTAL_DAYS = 90`; GHL contacts/opportunities full, conversations incremental since-window; Emergent and Sheets full.
- Data Room: registry `backend/src/lib/data-room/registry.js` (27 datasets, 5 sources), service `data-room.service.js` (PII gate: `role === 'owner' && query.pii === true`), repository keyset + offset paging, CSV streaming; frontend `frontend/features/data-room/` + pages `frontend/app/(dashboard)/data-{dentally,google-ads,meta-ads,gohighlevel,emergent}/page.tsx`; routes mounted at `/api/data-room` behind `requirePermission('data.export')`.
- Hosted volume: ~1.3 M rows / ~1 GB. `appointments` 228 k, `dentally_treatment_items` 481 k, `contacts` 96 k (58 k Dentally, 37 k GHL), `communications` 111 k (71 k with a body), `payments` 80 k (2020→), `treatment_plans` 91 k, `invoice_items` 84 k, `leads` 29 k, `ad_metrics` 20 k.
- Foreign keys into synced tables from non-synced tables: `tasks`, `workflow_runs`, `memberships` (0 rows referencing today), `sheet_export_queue` (339 contact refs, 322 appointment refs — go-forward state, re-enqueued from `export_since` automatically).
- App usage of the fields being minimised (verified by grep): `date_of_birth` read only by CSV import; `pms_patient`, `contacts.address/postcode/notes`, `appointments.notes` rendered nowhere; `communications.body` powers the Inbox only.

## Phases

| Phase | Deliverable | Target |
|---|---|---|
| 1 | Analyst-ready Data Room on the existing org | **before 1 Sep** |
| 2 | Pipeline framework: `etl_runs`, `etl_run_id`, run context, minimised mapper (per-org flag), runner CLI | week of 1 Sep |
| 3 | Rehearsal org: clone integrations + mappings, 12-month re-pull through the runner, comparison report | week of 8 Sep |
| 4 | Cutover | separate spec after the owner reviews the comparison |

Phase 1 has no dependency on 2 or 3; it ships on the current data. Phases 2 and 3 do not change what the analyst sees. Each phase gets its own implementation plan (`docs/superpowers/plans/`); Phase 1 is written and executed first.

---

## Phase 1 — Analyst-ready Data Room

Four additions to the shipped Data Room. No schema migration except the RPCs for summaries.

### 1.1 Derived columns

The registry gains `derived` column entries. PostgREST cannot compute expressions, so a dataset that carries derived columns is read through a per-dataset SQL view `public.data_room_<source>_<dataset>` (e.g. `public.data_room_dentally_appointments`) instead of the base table — the view must be in `public` because that is the only schema PostgREST exposes to the supabase-js repository. The registry's `table` points at the view; filtering is exactly as today (`organisation_id`, practice, period, keyset on `dateCol, id`). Views are plain (no storage), `security_invoker`, created in the Phase 1 migration, `SELECT` granted to `service_role` only (API roles stay locked out per 000129).

| Dataset | Derived columns | Rule (same as the app) |
|---|---|---|
| dentally/appointments | `is_patient_appointment`, `occurred`, `dna`, `cancelled`, `duration_mins`, `practitioner_name` | `pms_patient_id is not null`; `… and status='completed'`; `… and status='no_show'`; `status='cancelled'`; `ends_at-starts_at`; join `associates` on `pms_user_id`/`pms_external_id` (migration 000076 + practitioner-site attribution) |
| dentally/patients | `patient_key`, `birth_year`, `postcode_district` | `sha256(organisation_id‖pms_external_id)` hex; `extract(year from date_of_birth)`; `split_part(postcode,' ',1)` (from stored columns while they exist; from the new columns after Phase 2) |
| dentally/treatment_items | `counts_as_activity`, `practitioner_name` | `completed and not base_chart` (migration 000099) |
| dentally/invoice_items | `fee_total_pence` | `fee_pence * quantity` |
| dentally/payments | `is_settled` | `status = 'settled'` |
| dentally/treatment_plans | — (deferred to Phase 2) | per-plan billed/paid needs an `invoice_items (organisation_id, treatment_plan_id)` index first; the practice-level figures are in the `summaries` datasets via the plan-fees rules (000074/000101) |
| gohighlevel/opportunities | `pipeline_name`, `outcome` | pipeline id → name from `integration_accounts.config.pipelines`; `won` = `treatment_started|treatment_completed`, `lost` = `not_proceeding|failed_to_attend`, else `open` (RPC 000087) |
| gohighlevel/contacts | `contact_key` | `sha256(organisation_id‖ghl_contact_id)` |
| google-ads/meta-ads campaign_daily | `practice_name`, `cpl_pence` | via `ad_accounts.practice_id`; `spend_pence / nullif(conversions,0)` |

`patient_key` / `contact_key` are **not** PII (one-way hash) and are always visible; they let the analyst count unique patients and join patients → appointments → payments without identifiers. `id`, `contact_id` remain as today.

### 1.2 Summary datasets

New source `summaries` (label "Summaries") with two datasets, computed by SQL RPCs so the Data Room and the cards share one definition:

- `practice_day` — one row per practice per day: `appointments, occurred, dna, cancelled, new_patients, treatment_items, treatment_items_pence, billed_pence, settled_pence, leads_new, leads_won, ad_spend_pence`.
- `practice_month` — same columns per month plus `dna_pct`, `avg_fee_pence`, `cpl_pence`, and `financial_revenue_pence / financial_costs_pence` from `monthly_financials` with the synced-over-manual precedence (`monthlyFinancial.service.bucketsByPeriod` rule).

RPCs `data_room_practice_day(p_org, p_since, p_until, p_practice)` / `data_room_practice_month(…)` — `security definer`, `set search_path = public`, `EXECUTE` revoked from `anon, authenticated`, granted to `service_role` (the mandatory RPC revoke idiom). Registry entry uses `derived: 'rpc'` (like the existing `ghl_pipelines` in-memory derivation); paging is offset-only over the RPC result; CSV/Excel export the full result.

Reconciliation is enforced by tests (see Testing): `practice_month.occurred` must equal `appointments_rollup_by_practice().completed` and `settled_pence` must equal `settled_receipts_by_day` summed, for the same org/window.

### 1.3 Excel export

`GET /api/data-room/:source/:dataset/export.xlsx` — same gate, filters and filename convention as `export.csv` (`.xlsx` suffix). Implementation: `exceljs` streaming workbook writer (`stream.xlsx.WorkbookWriter`) piped to the response; header row bold + frozen; money columns written as numbers (pence) with a second `£` column formatted `#,##0.00` where the registry marks a column `money: true`; dates as real Excel dates. When `scope=all`, one worksheet **per practice** (tab named after the practice, "Unassigned" for null practice) plus a "All practices" tab; when a practice is selected, a single tab. The CSV path is unchanged. Row cap for Excel: 500 000 rows per export (Excel's own limit is 1 048 576); the service returns 413 with a message to narrow the period beyond that. Export events are already audited by the `audit` middleware.

Frontend: the export button becomes a split button (CSV / Excel) in `DataRoomScreen.tsx`; `api.ts` gains `exportUrl(source, dataset, params, format)`.

### 1.4 Data dictionary and freshness

- Registry columns gain `description` (one sentence, British English) and `unit` (`pence`, `date`, `timestamptz`, `count`, `flag`, `text`, `id`, `hash`). `GET /api/data-room/datasets` already returns the registry to the client; it now includes these.
- Frontend: a "Dictionary" drawer on every dataset page listing column, unit, description, and whether it is PII-gated. Sources page gains a short "How the numbers are defined" section for the derived columns and summaries (occurred/DNA, treatment activity, settled cash, won/lost).
- Freshness badge per source page: "Data as of <last_sync_at, London time>" from `integrations.last_sync_at` (per GHL subaccount: the latest `integration_accounts.last_sync_at`). After Phase 2 the badge also shows the latest `etl_runs` row (`run id · trigger · finished_at`).
- `docs/DATA_ROOM_DICTIONARY.md` is generated from the registry by `npm run data-room:dictionary` and committed, so the analyst has an offline copy.

### 1.5 Analyst onboarding

No code: the owner invites the analyst from Team with role `analyst` (invite → set password → active). The role already lands on the Data Room and nowhere else.

---

## Phase 2 — Pipeline framework

### 2.1 `etl_runs` ledger

Migration `20260101000132_etl_runs.sql` (`000131` is taken by the Phase 1 Data Room views/RPCs):

```sql
create table if not exists public.etl_runs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  source           text not null,                      -- dentally | gohighlevel | xero | quickbooks | google_ads | meta_ads | emergent | google_sheets | reviews
  account_id       uuid null,                          -- integration_accounts.id when the source is per-account (GHL, QBO)
  trigger          text not null check (trigger in ('cron','manual','webhook','repull','connect')),
  window_from      timestamptz null,
  window_to        timestamptz null,
  phase            text null,                          -- last phase started (checkpoint)
  phases_done      text[] not null default '{}',       -- phases completed (resume skips these)
  status           text not null default 'running' check (status in ('running','succeeded','failed','cancelled')),
  rows_read        integer not null default 0,
  rows_upserted    integer not null default 0,
  rows_skipped     integer not null default 0,
  rows_deleted     integer not null default 0,
  error            text null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz null,
  created_by       uuid null references users(id) on delete set null
);
create index if not exists idx_etl_runs_org_source_started on etl_runs (organisation_id, source, started_at desc);
alter table etl_runs enable row level security;   -- service_role only, like every other table after 000130
```

`etl_run_id uuid null` is added to the 19 synced tables: `contacts, appointments, leads, communications, payments, invoices, invoice_items, dentally_treatment_items, treatment_plans, ghl_appointments, ad_metrics, monthly_financials, sheet_leads, treatment_accepted, emergent_daily_cashup, emergent_monthly_pl, associates, staff, bank_transactions`. No index (it is never a query predicate except in the sweep, which filters on the window first). Existing rows stay `NULL` — that is the "did not come through the pipeline" marker.

Webhooks stamp rows too: `applyWebhookEvent` get-or-creates one `trigger='webhook'` run per org+source+day (so the ledger stays a few rows a day, not one per event) and increments its counters.

### 2.2 Run context

New module `backend/src/lib/etl/run.js`:

```js
startRun({ orgId, source, accountId, trigger, window, createdBy }) → run   // inserts the row
run.phase(name)                                                            // updates phase, returns skip=true if in phases_done
run.count({ read, upserted, skipped, deleted })                            // accumulates
run.phaseDone(name)                                                        // appends to phases_done
run.finish({ status, error })                                              // sets finished_at
getOrCreateWebhookRun(orgId, source)                                       // per-day row
```

Connectors accept `run` in their options object (`syncOneOrg(orgId, integration, onProgress, { full, recent, resources, run })`, `syncAccount(orgId, accountId, onProgress, { full, recent, run })`, and equivalents). `upsertChunked` (Dentally) and the per-connector upsert helpers stamp `etl_run_id: run.id` on every row and report counts to the run. `syncAllOrgs()` in every connector starts a `trigger='cron'` run per org (or per account) so the nightly jobs are ledgered without touching the worker file.

Overlap guard: `startRun` takes `pg_try_advisory_xact_lock(hashtext(orgId||source))` via a tiny RPC `etl_try_lock(p_org, p_source)`; a second concurrent run for the same org+source fails fast with `etl_run_in_progress` (this is the class of contention that produced the `ad_metrics` statement-timeout incident).

### 2.3 Minimised mapper (per-organisation flag)

Schema changes are per table, not per org, so during the rehearsal **no columns are dropped**. Instead:

- Migration adds `contacts.birth_year smallint`, `contacts.postcode_district text`, `contacts.email_hash text`, `contacts.phone_hash text` and `organisations.minimise_pii boolean not null default false`.
- Connector mappers (`patientRow`, `contactRow`, `appointmentRow`, GHL conversations message row) consult `org.minimise_pii`:
  - `true` → write `birth_year`, `postcode_district`, `email_hash`, `phone_hash`; write `NULL` for `date_of_birth`, `address`, `postcode`, `notes`, `pms_patient`, `communications.body`.
  - `false` → today's behaviour, **plus** `birth_year`/`postcode_district`/hashes (harmless, and they make the derived columns cheaper).
- Hashes: `sha256(lower(trim(email)))`, `sha256(normalizePhone(phone))` (the GHL `normalizePhone` — E.164 UK). The sheet-export matcher (`sheet-export-match.service.js`) switches to comparing hashes, which works identically in both modes.
- The rehearsal org is created with `minimise_pii = true`; the existing org stays `false` until cutover. Nothing about the old org's rows changes.

### 2.4 Runner CLI

`backend/src/etl/cli.js`, exposed as `npm run etl -- <args>`:

```
npm run etl -- --org <uuid> --source dentally  --months 12 [--resume <run_id>] [--sweep] [--dry-run]
npm run etl -- --org <uuid> --source gohighlevel [--account <uuid>] --months 12
npm run etl -- --org <uuid> --source all --months 12          # sequential: dentally → gohighlevel → quickbooks → xero → google_ads → meta_ads → emergent → google_sheets → reviews
npm run etl -- --list [--org <uuid>]                            # ledger view
```

Behaviour:
- One `etl_runs` row per source (per account for GHL/QBO), `trigger='repull'`.
- Phases per source are the connector's existing phases (Dentally: `sites → practitioners → staff → patients → appointments → invoices → payments → treatment_plans → treatment_items → linking`). Each phase is wrapped in `run.phase()`; on `--resume` phases in `phases_done` are skipped and the connector's cursor (`updated_after` / page) restarts from the phase boundary.
- Rate limits: reuses the connector's `isRateLimited()` + backoff; the runner additionally sleeps between phases (`ETL_PHASE_PAUSE_MS`, default 2 000) and caps concurrency at 1 per org+source (the advisory lock).
- `--sweep`: after a successful run, delete rows in the run's window whose `etl_run_id <> run.id` and `organisation_id = org` for the tables the run covered (= records the source no longer returned). Prints counts per table; requires `--confirm` above 1 000 rows per table. Not used in Phase 3 (fresh org), available for future re-pulls.
- `--dry-run`: fetches and maps, reports counts, writes nothing.
- Windows: `--months N` sets `window_from = now() - N months` for every entity of the source, payments included (no per-entity exceptions); Ads honour their own `FULL_DAYS` unless `--months` is smaller.
- Progress: pino logs per phase + a final table; exit code 0/1; Sentry breadcrumbs, no cron monitor (manual).

Worker change: `workers/index.js` is untouched except that each connector's `syncAllOrgs` now skips an org whose ledger shows a `running` `repull` run for that source (so the nightly cron does not fight a long re-pull).

---

## Phase 3 — Rehearsal organisation

### 3.1 Create

Platform console (`POST /api/platform/orgs`) → organisation "Plan4growth (pipeline rehearsal)", owner login = the owner's own email plus a `+rehearsal` suffix, temp password returned once. Then `update organisations set minimise_pii = true where id = <new>` (a `--minimise` flag on the clone script does this).

### 3.2 Clone integrations and mappings

`scripts/etl-clone-org-integrations.js --from <old> --to <new> [--minimise] [--dry-run]` (service-role, runs locally against hosted like the other one-off scripts):

Copied, with new ids and `organisation_id = new`:

| Table | Notes |
|---|---|
| `practices` | same `name`, `pms_site_id`, `chairs`, `kind`, opening hours; builds `practiceMap: oldPracticeId → newPracticeId` |
| `integrations` (providers `dentally, gohighlevel, xero, quickbooks, google_ads, meta_ads, emergent, google_sheets, google_places/reviews, gocardless`) | encrypted `secrets` copied verbatim (global key); `config` JSON copied with every practice id remapped through `practiceMap` (Dentally `site_map`, Emergent, Ads); `last_sync_at`, `history_backfilled`, `treatment_items_backfilled` reset so the connect-bootstrap path runs; `webhook_secret` copied (harmless — no events arrive); `status = 'active'` |
| `integration_accounts` (GHL subaccounts, QBO companies) | `practice_id` remapped; **new random `webhook_token`**; `config.pipelines` copied; `last_sync_at` reset |
| `emergent_practice_map`, `ad_accounts` (`practice_id` remapped), `xero_account_map`, `sheet_sources` (+`practice_label`), `review_sources`, `bank_accounts` (GoCardless requisition metadata; balances/transactions are synced) | |
| `role_permissions` | seeded by `seed_role_permissions(new_org)` (existing) |

**Not copied**: `google_sheets_writer` integration, `board_report_schedules`, `whatsapp_report_settings`, `notification_preferences`, `org_email_aliases`, `workflows`, `crm_templates`, `users` other than the owner, all business-health/manual-input tables, LMS enrolments. The script prints a manifest of what it created and refuses to run if `--to` already has any integration row.

### 3.3 Re-pull

```
npm run etl -- --org <new> --source all --months 12
```

Run from the owner's machine (or a Railway one-off job) in daytime. Expected order and rough durations at today's volumes: Dentally 2–4 h (rate-limited; treatment items dominate), GHL 30–60 min (conversations), QuickBooks/Xero minutes, Ads minutes, Emergent/Sheets seconds. The old org's 03:00 nightly is unaffected; the ledger guard prevents the nightly from double-running the rehearsal org while the re-pull is live.

### 3.4 Comparison report

`scripts/etl-compare.js --old <id> --new <id> --months 12 [--out docs/etl/compare-2026-09-10.md]`:

Per practice (matched by `pms_site_id`, then name) per month, old vs new vs diff:

- appointments (patient), occurred, DNA, cancelled (from `appointments`)
- treatment items counted as activity, £ (from `dentally_treatment_items`)
- invoice lines £ billed; settled payments £
- treatment plans closed / paid £
- GHL contacts, opportunities, won, lost
- ad spend £, conversions (per provider)
- monthly financial lines (count, revenue £, costs £) per company
- communications (count only)

Plus the golden numbers: Ashford May 2026 patient appointments (any status) = **801**, treatment activity **421 / £79 757.72**, Plan Fees Collected ≈ **96 %**. Any cell with |diff| > 0.5 % is flagged; the report ends with a list of rows present in one org only (source-deleted or window-edge records). Output is Markdown + CSV; it is the artefact the owner reviews before Phase 4.

---

## Phase 4 — Cutover (out of scope; recorded for orientation)

Two options, decided after the comparison:

- **A. Apply the pipeline to the old org in place** (expected): set `minimise_pii = true`, run the runner with `--sweep` over 12 months, then a one-off migration nulls/derives the minimised fields on remaining rows and drops `date_of_birth`, `address`, `postcode`, `contacts.notes`, `appointments.notes`, `pms_patient`, `communications.body`. Webhooks, users, history and mappings stay where they are. The rehearsal org is deleted.
- **B. Promote the rehearsal org**: re-point Dentally/GHL/Emergent webhook secrets and URLs, move users, copy manual inputs, delete the old org. More moving parts; only if A shows a problem.

Either way the column drops and the truncate happen in that spec, not this one.

---

## Security and privacy

- PII gate unchanged: PII columns (`PII_COLUMNS`) are selected only for `role === 'owner' && query.pii === true`; the analyst can never see them in rows, CSV or Excel. `FORBIDDEN_COLUMNS` gains `body`, `email_hash`, `phone_hash`, `etl_run_id` is allowed (not PII).
- Hashes are SHA-256 of normalised values — not reversible, but they are *linkable*; they are excluded from the Data Room and used only server-side for matching.
- `etl_runs` and the new RPCs follow the lockdown rules from 000129/000130: RLS on, `EXECUTE` revoked from `anon, authenticated`.
- Rehearsal org holds a second copy of ~1 GB (less with minimisation) for the comparison period only; it is deleted at cutover. The owner accepted this explicitly.
- No new external services. `exceljs` is the only new dependency.
- The runner and clone script run with the service-role secret key from the operator's environment; they never print secrets (the clone manifest lists providers, not tokens).

## Error handling

- Runner: a phase failure marks the run `failed` with the error, leaves `phases_done` intact, exits 1; `--resume <run_id>` continues. A 401 from a copied token (refresh-claim guard) is reported per provider with "reconnect in the rehearsal org" guidance; other providers continue.
- Clone script: transactional per table group; on any error rolls back and prints what was created so far; refuses to run twice.
- Excel export: streaming, so a mid-export error ends the response; the client shows the existing "export failed" toast. Row cap → 413 with a clear message.
- Summary RPCs: if a source has no data the row set is empty, never an error; the UI shows the existing empty state.

## Testing

Backend (vitest, existing harness):

- `etl-run.test.mjs` — ledger lifecycle, phase checkpoint/resume, advisory-lock rejection, webhook get-or-create per day, counters.
- `etl-mapper-minimise.test.mjs` — `patientRow`/`contactRow`/message row in both `minimise_pii` modes; hashes stable and normalised; no forbidden field written in minimise mode.
- `etl-cli.test.mjs` — arg parsing, `--dry-run` writes nothing, `--sweep` deletes only in-window rows with a different `etl_run_id`, refuses without `--confirm` above threshold.
- `etl-clone.test.mjs` — practice id remapping inside `config` JSON, new webhook tokens, excluded tables never copied, refuses on non-empty target.
- `data-room-derived.test.mjs` — every derived column rule against fixture rows; PII guard: no `PII_COLUMNS`/`FORBIDDEN_COLUMNS` in any registry column list for non-owner; summaries RPC reconciles with `appointments_rollup_by_practice` and `settled_receipts_by_day` on seeded data.
- `data-room-xlsx.test.mjs` — workbook has one tab per practice for `scope=all`, header row, numeric money, 413 above cap, PII gate identical to CSV.
- Existing cross-org isolation tests extended to `etl_runs` and the summary RPCs.

Frontend: `npm run typecheck && npm run lint && npm run build` (no test framework). Manual QA on the Data Room: Excel download opens in Excel/Numbers, dictionary drawer, freshness badge.

Operational verification (Phase 3): the comparison report; golden numbers; `select count(*) filter (where etl_run_id is null)` = 0 on every synced table in the rehearsal org.

## Documentation

- `docs/API.md`: `export.xlsx`, `summaries` source, dictionary fields on `/datasets`.
- `docs/DATA_ROOM_DICTIONARY.md` (generated).
- `docs/runbooks/etl-repull.md`: runner usage, resume, sweep, clone script, comparison.
- `CLAUDE.md` current-state entry once shipped.

## Out of scope

Raw landing layer; `analytics` SQL schema and read-only Postgres login; column drops and truncation (Phase 4); retiring the legacy GHL `syncOneOrg` path; changes to the app's dashboards.
