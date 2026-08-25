# Data Room — raw source data for the data analyst

**Date:** 2026-08-25
**Status:** approved design, awaiting implementation plan

## Why

The group is bringing in a data analyst who must not be given logins to Dentally,
Google Ads, Meta Ads, GoHighLevel or Emergent. Everything we already pull from
those systems lives in our Postgres. The Data Room exposes that stored data —
and only that data — inside the app, one page per source, filterable by
practice and date, with a CSV export of the filtered set.

## Decisions taken with the owner

| Decision | Choice |
|---|---|
| Access model | New fourth role `analyst`, locked to the Data Room only. Owner also sees the Data Room (owner holds every permission key). |
| Patient PII | Pseudonymised by default. PII columns are omitted (not blanked); rows still join on `contact_id` / `pms_patient_id` / `pms_external_id`. Only an **owner** may request PII (`pii=1`). |
| Sources | Five pages: Dentally, Google Ads, Meta Ads, GoHighLevel, Emergent. |
| Export size | Date range required for event datasets; the export streams **every** row matching the filter. No row cap. |
| Leads from Google/Meta | Not available as individual records — the ad syncs store per-campaign-per-day `conversions` counts only. Per-lead attribution lives in GoHighLevel (pipeline name); a Pipelines dataset is included so the analyst can join `ghl_pipeline_id` → name. |

## Architecture

One declarative **dataset registry** drives everything. Adding a dataset is one
registry entry; no per-source services.

```
backend/src/lib/data-room/registry.js          ← the registry (pure data + validators)
backend/src/lib/data-room/csv.js               ← CSV encoder (pure)
backend/src/lib/data-room/cursor.js            ← keyset cursor encode/decode (pure)
backend/src/repositories/data-room.repository.js  ← generic page/stream reads (serviceClient, org-filtered)
backend/src/services/data-room.service.js      ← practice resolution, PII gate, audit, orchestration
backend/src/controllers/data-room.controller.js
backend/src/routes/data-room.routes.js         ← mounted at /api/data-room
frontend/features/data-room/                   ← api.ts, hooks.ts, components/DataRoomScreen.tsx
frontend/app/(dashboard)/data-{dentally,google-ads,meta-ads,gohighlevel,emergent}/page.tsx
```

### Registry shape

```js
{
  source: 'dentally',                 // page key
  key: 'appointments',                // dataset key (pill)
  label: 'Appointments',
  table: 'appointments',
  where: { source: 'dentally' },      // static predicates: `col: value` (eq) or `col: { not: null }` (is not null);
                                      // a `->>` key (e.g. 'metadata->>provider') targets a jsonb text field
  practice: { col: 'practice_id' }    // OR { via: { table: 'ad_accounts', key: 'customer_id', col: 'customer_id' } }
  dateCol: 'starts_at',               // null = roster dataset (ignores period)
  columns: [
    { col: 'id' }, { col: 'practice_id' }, { col: 'contact_id' },
    { col: 'first_name', pii: true }, …
  ],
}
```

Rules enforced by a unit test over the registry:

- every entry has `table`, `columns` (non-empty), and either `practice.col` or `practice.via`;
- `dateCol`, when set, is one of `columns`;
- forbidden columns never appear: `raw`, `notes`, `pms_patient`, `secrets`,
  `webhook_token`, `hourly_rate_pence`, `weekly_hours`, `pay_pct`,
  `lab_split_pct`, `crm_system_notes`, `line_notes`;
- `subject`, `body`, `from_address`, `to_address`, `first_name`, `last_name`,
  `email`, `phone`, `date_of_birth`, `address`, `postcode`, `patient_name` must
  carry `pii: true` (except `email`/`phone` on `associates` and `staff`, which
  are staff business contacts, not patients).

`organisation_id` is always applied by the repository, never listed in a
registry entry.

## Datasets

Money columns stay as integer `*_pence` in the CSV (exact). Timestamps are ISO
8601 UTC. Dates are `YYYY-MM-DD`. JSONB columns (`custom_sources`, `refunds`,
`custom_lines`) are emitted as JSON text.

### Dentally

| Dataset | Table / predicate | Practice | Date | Columns |
|---|---|---|---|---|
| Patients | `contacts` where `source='dentally'` | `practice_id` | roster | id, practice_id, pms_external_id, **first_name, last_name, email, phone, date_of_birth, address, postcode**, marketing_consent, sms_consent, next_recall_date, last_visit_date, pms_registered_at, created_at |
| Appointments | `appointments` where `source='dentally'` | `practice_id` | `starts_at` | id, practice_id, contact_id, associate_id, pms_external_id, pms_patient_id, pms_practitioner_id, starts_at, ends_at, status, appointment_type |
| Payments | `payments` where `source='dentally'` | `practice_id` | `processed_at` | id, practice_id, contact_id, external_id, amount_pence, method, status, processed_at |
| Invoices | `invoices` where `source='dentally'` | `practice_id` | `dated_on` | id, practice_id, contact_id, external_id, amount_pence, amount_outstanding_pence, dated_on, due_on, paid, treatment, **patient_name** |
| Invoice items | `invoice_items` where `source='dentally'` | `practice_id` | `invoiced_on` | id, practice_id, contact_id, associate_id, pms_external_id, pms_invoice_id, pms_practitioner_id, treatment_plan_id, treatment_name, unit_price_pence, fee_pence, quantity, nhs_charge, invoiced_on, invoice_paid |
| Treatment plans | `treatment_plans` where `source='dentally'` | `practice_id` | `start_date` | id, practice_id, contact_id, associate_id, pms_external_id, pms_patient_id, pms_practitioner_id, private_value_pence, nhs_uda_value, nhs_completed_uda_value, completed, completed_at, start_date, end_date |
| Treatment items | `dentally_treatment_items` | `practice_id` | `completed_at` | id, practice_id, contact_id, associate_id, pms_external_id, pms_patient_id, pms_practitioner_id, treatment_plan_id, treatment_appointment_id, pms_invoice_id, treatment_name, price_pence, duration, completed, completed_at, base_chart, charged, appear_on_invoice |
| Practitioners | `associates` where `pms_external_id is not null` | `primary_practice_id` | roster | id, primary_practice_id, pms_external_id, pms_user_id, full_name, email, gdc_number, nhs_number, dentally_role, specialty, active, uda_target, uoa_target |
| Staff | `staff` where `source='dentally'` | `practice_id` | roster | id, practice_id, pms_external_id, full_name, role, pms_role, title, email, phone, active, last_login_at |

Bold = PII-flagged.

### Google Ads

| Dataset | Table / predicate | Practice | Date | Columns |
|---|---|---|---|---|
| Accounts | `ad_accounts` where `provider='google_ads'` | `practice_id` | roster | id, customer_id, name, currency, status, practice_id, is_selected |
| Campaign daily | `ad_metrics` where `provider='google_ads'` | via `ad_accounts.customer_id → practice_id` | `metric_date` | id, customer_id, campaign_id, campaign_name, metric_date, spend_pence, impressions, clicks, conversions, campaign_status, objective |

### Meta Ads

| Dataset | Table / predicate | Practice | Date | Columns |
|---|---|---|---|---|
| Accounts | `ad_accounts` where `provider='meta_ads'` | `practice_id` | roster | id, customer_id, name, currency, status, practice_id, is_selected, period_reach, period_frequency, period_impressions, period_clicks, period_spend_pence, period_conversions, period_window_start, period_window_end, period_synced_at |
| Campaign daily | `ad_metrics` where `provider='meta_ads'` | via `ad_accounts.customer_id → practice_id` | `metric_date` | id, customer_id, campaign_id, campaign_name, metric_date, spend_pence, impressions, clicks, conversions, reach, frequency, campaign_status, objective |

### GoHighLevel

| Dataset | Table / predicate | Practice | Date | Columns |
|---|---|---|---|---|
| Subaccounts | `integration_accounts` where `provider='gohighlevel'` | `practice_id` | roster | id, external_account_id, label, practice_id, status, last_sync_at |
| Pipelines | derived from `integration_accounts.config.pipelines` (one row per stage) | `practice_id` of the subaccount | roster | integration_account_id, practice_id, pipeline_id, pipeline_name, stage_id, stage_name |
| Contacts | `contacts` where `source='gohighlevel'` | `practice_id` | `created_at` | id, practice_id, integration_account_id, ghl_contact_id, **first_name, last_name, email, phone**, created_at |
| Opportunities | `leads` where `source='gohighlevel'` | `practice_id` | `created_at` | id, practice_id, integration_account_id, contact_id, ghl_opportunity_id, ghl_pipeline_id, ghl_pipeline_stage_id, ghl_stage_name, treatment, estimated_value_pence, status, created_at, updated_at |
| Conversations | `communications` where `metadata->>provider='gohighlevel'` | via `integration_accounts.id → practice_id` | `created_at` | id, integration_account_id, contact_id, lead_id, channel, direction, delivery_status, external_id, created_at, **subject, body** |
| Appointments | `ghl_appointments` | `practice_id` | `starts_at` | id, practice_id, integration_account_id, contact_id, ghl_event_id, ghl_calendar_id, calendar_name, title, status, starts_at, ends_at |

Pipelines is the one non-table dataset: the repository reads the subaccount
rows and flattens `config.pipelines[].stages[]` in memory (tens of rows). It
is served through the same page/export interface; the cursor is a row offset.

### Emergent

| Dataset | Table / predicate | Practice | Date | Columns |
|---|---|---|---|---|
| Treatments accepted | `treatment_accepted` where `source='emergent'` | `practice_id` | `accepted_date` | id, practice_id, business_id, external_id, accepted_date, treatment_name, practitioner_name, value_pence, quantity, status, ext_source, ext_campaign, **patient_name, phone, email** |
| Daily cash-ups | `emergent_daily_cashup` | `practice_id` | `cashup_date` | id, practice_id, business_id, business_name, cashup_date, treatments_accepted, tx_plans_given, tx_plan_given_value_pence, cash_up_money_taken_pence, num_bookings, num_new_leads, num_follow_ups, num_attended, total_chairs, chairs_used, chair_utilisation, reviews_collected, before_after_pictures, video_testimonials, practice_plan_signups, total_refunds_pence, source_google, source_facebook, source_walk_in, source_friends_family, source_wl_website, source_dentist_referral, source_instagram, source_youtube, source_other, custom_sources, refunds, appointment_booked_for, detail_patient_rows_count, detail_patient_money_total_pence, variance_manager_vs_detail, emergent_created_at, emergent_created_by |
| Monthly P&L | `emergent_monthly_pl` | `practice_id` | `period_month` | id, practice_id, business_id, business_name, period_month, revenue_pence, gross_profit_pence, net_profit_pence, total_cost_of_sales_pence, total_operating_expenses_pence, cash_collected_pence, tx_accepted_amount_pence, bank_balance_pence, average_wait_time, principal_fees_pence, hygienist_therapist_pence, lab_fees_pence, materials_pence, sedation_services_pence, advertising_marketing_pence, bank_charges_pence, business_rates_rent_pence, salaries_staff_cost_pence, telephone_wifi_pence, utilities_pence, insurance_pence, management_fees_pence, subscriptions_pence, it_expenses_pence, card_machine_charges_pence, custom_lines, emergent_created_at, last_updated_at, last_updated_by |

## Access control

### Role `analyst`

- **Migration `20260101000126_analyst_role.sql`** (idempotent):
  - widen `users.role` and `role_permissions.role` CHECK constraints to
    `('owner','practice_manager','reception','analyst')` — drop by name and
    re-add;
  - `CREATE OR REPLACE FUNCTION seed_role_permissions` with the existing
    defaults plus `data.export` for every role (`owner t`, `practice_manager f`,
    `reception f`, `analyst t`) and `analyst f` for every other key;
  - re-run the backfill loop over `organisations` (`ON CONFLICT DO NOTHING`, so
    owner-edited rows are untouched);
  - `NOTIFY pgrst, 'reload schema'`.
  - Mirror the CHECK change in `db/01_schema.sql`.
- **Catalog** (`backend/src/lib/permissions.js`): add
  `'data.export': 'View & export raw source data (Data Room)'`;
  `DEFAULT_ROLE_PERMISSIONS.analyst = { 'data.export': true }`. Owner inherits
  it through the all-keys reduce.
- **Role enums**: `auth.model.js` (`inviteSchema`, `provisionMemberSchema`),
  `permissions.controller.js`, `permissions.service.js` (`getMatrix` roles map +
  `setRoleDefault` validation), `auth.service.js` `ROLE_RANK.analyst = 1`
  (peer of reception: PM may invite/manage analysts; analysts manage nobody).
- **Frontend**: `features/system/api.ts` role unions + `EditableRole`;
  `TeamPermissionsScreen` role label "Data Analyst", role select option, matrix
  column. `lib/permissions.ts` `PermissionKey` gains `'data.export'`.

### Lock-out (analyst sees nothing else)

Overview routes have no permission key and render for every signed-in role, so
a key alone does not confine the analyst. Three layers:

1. **Nav**: `lib/permissions.ts` gains `visibleNavSections(role, permissions)`.
   For `role === 'analyst'` it returns only the Data Room section; for every
   other role it is the existing per-item `canAccessRoute` filter. Sidebar and
   `SectionTabs` both use it.
2. **Route guard**: a client component `RoleHomeGuard` mounted in
   `app/(dashboard)/layout.tsx`. When `useMe()` resolves to `role === 'analyst'`
   and the first path segment is not one of the five `data-*` ids, it
   `router.replace('/data-dentally')`. The login route keeps redirecting to
   `/business-hub`; the guard bounces analysts from there.
3. **API**: every Data Room route is `requirePermission('data.export')`. All
   other `/api/*` routes keep their existing permission/role guards; an analyst
   holds no other key, so they 403. Endpoints that are intentionally unkeyed
   (`GET /api/practices`, `/auth/me`, notifications) remain reachable — the
   practices list is what feeds the practice pills. This matches how Reception
   is confined today.

## API

Mounted at `/api/data-room`, all behind `authenticate` + `requirePermission('data.export')`.
Documented in `docs/API.md`.

### `GET /api/data-room/datasets`

Returns the registry for the UI: `{ sources: [{ key, label, datasets: [{ key, label, roster, columns: [{ col, pii }] }] }] }`.
The frontend never hard-codes column lists.

### `GET /api/data-room/:source/:dataset`

Query: `scope` (`all` | practiceId), `since`, `until` (ISO; required unless
roster), `cursor` (opaque), `limit` (1–500, default 100), `pii` (`1` only).

Response: `{ rows: object[], next_cursor: string|null, total: number }`.

- `total` is a PostgREST `count: 'exact'` head request with the same filters.
- Rows contain only registry columns; PII-flagged columns are absent unless
  `pii=1` **and** `req.user.role === 'owner'`. A non-owner sending `pii=1`
  gets `403 { error: 'PII export is owner-only' }`.
- Ordering: `(dateCol asc, id asc)` for event datasets; `(id asc)` for roster.
- Pagination is **keyset**: the cursor encodes `{ d: lastDate, id: lastId }`
  (base64url JSON). The next page filters
  `or=(dateCol.gt.d, and(dateCol.eq.d, id.gt.id))`. This never trips the
  PostgREST 1000-row cap and stays O(page) on 450k-row tables.
- Practice filter: `practice.col` → `.eq(col, practiceId)`; `practice.via` →
  resolve the parent keys once (`select key from via.table where org and
  practice_id = scope`) then `.in(col, keys)`; an empty key list short-circuits
  to zero rows without a query.
- Validation: unknown `source`/`dataset` → 404; `since >= until` or missing on
  an event dataset → 400; `scope` must be `all` or a UUID → 400.

### `GET /api/data-room/:source/:dataset/export.csv`

Same query params minus `cursor`/`limit`.

- Headers: `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="<source>-<dataset>_<since>_<until>.csv"`
  (roster: `<source>-<dataset>_<today>.csv`), `Cache-Control: no-store`.
- Body: UTF-8 BOM, header row of column names, then rows, CRLF line endings.
  Fields quoted when they contain `"`, `,`, `\r` or `\n`; `"` doubled. `null`
  → empty field. Written with `res.write` per 1000-row batch pulled through the
  same keyset iterator; `res.end()` after the last batch. Memory is one batch.
- A client disconnect (`req.on('close')`) stops the iterator.
- On completion the service inserts one `audit_log` row:
  `{ organisation_id, user_id, action: 'export', entity_type: 'data_room',
  diff: { source, dataset, scope, since, until, pii, rows }, ip_address,
  user_agent }`. The audit middleware only logs mutations, so this is explicit.
  A failed/aborted export is logged with `rows` at the point of failure and
  `diff.aborted = true`.

### Frontend proxy

`app/api/backend/[...path]/route.ts` currently buffers `await res.text()`. Add:
when the upstream `content-type` starts with `text/csv`, return
`new NextResponse(res.body, …)` and forward `Content-Disposition` and
`Cache-Control`. All other responses are unchanged.

### Indexes

Keyset order `(dateCol, id)` under an `organisation_id` filter needs a
`(organisation_id, dateCol, id)` btree on the event tables. The migration adds
`CREATE INDEX IF NOT EXISTS` for each event dataset table whose existing
indexes don't already cover `(organisation_id, dateCol)` — verified against
`pg_indexes` on hosted before writing the migration, so only the missing ones
are created.

## Frontend

- `lib/nav.ts`: new section `{ label: 'Data Room', items: [ data-dentally
  "Dentally", data-google-ads "Google Ads", data-meta-ads "Meta Ads",
  data-gohighlevel "GoHighLevel", data-emergent "Emergent" ] }` placed last.
  `lib/permissions.ts` `ROUTE_PERMISSION` maps all five to `data.export`.
  Flat ids keep the existing `SectionTabs` pill bar working (it lists the five
  sources).
- Pages are one-line re-exports of `DataRoomScreen` with a `source` prop.
- `features/data-room/`
  - `api.ts`: `fetchDatasets()`, `fetchPage(source, dataset, params)`,
    `exportUrl(source, dataset, params)` (builds the `/api/backend/api/data-room/…/export.csv?…` href).
  - `hooks.ts`: `useDatasets()`, `useDataRoomPage(source, dataset, params)`
    (React Query `useInfiniteQuery` keyed on all params).
  - `components/DataRoomScreen.tsx`: `PageHeader` (source title + one-line
    "what this is" subtitle) → `ScopePeriodBar` (practice pills + period pills;
    hidden period row when the active dataset is roster) → dataset pill row
    (same `Pill` styling as ScopePeriodBar) → toolbar: "N rows" total, owner-only
    "Include patient PII" toggle, **Export CSV** button (`<a download href=exportUrl>`)
    → `DataTable` with columns from the registry (`*_pence` rendered as £ via
    `lib/format.ts`, timestamps as `en-GB` local, booleans Yes/No, JSON as
    compact text) → "Load more" until `next_cursor` is null → `EmptyState` when
    zero rows ("No <dataset> for this practice and period").
  - Dataset selection is kept in the URL (`?dataset=`) so a link is shareable.
- `RoleHomeGuard` in `components/layout/`.
- British English throughout; light theme only; no emojis.

## Error handling

- Backend: Zod schema `dataRoomQuerySchema` in `models/data-room.model.js`;
  registry lookups 404; PII 403; Supabase errors propagate as 500 through the
  existing `asyncHandler`/error middleware. During CSV streaming an upstream
  error after headers are sent ends the response early (client sees a truncated
  file); the audit row records `aborted: true` and the error is logged via
  `req.log.error`.
- Frontend: query errors render the existing `AlertRow` error tone with the
  message; a failed download shows the browser's own failure.

## Testing

Backend (vitest, `backend/test/data-room-*.test.mjs`):

1. `registry.test` — invariants listed under *Registry shape*; every
   `practice.via` target is a known table; no duplicate `(source,key)`.
2. `csv.test` — escaping, CRLF, BOM, null → empty, JSON columns stringified.
3. `cursor.test` — encode/decode round-trip; tampered cursor → 400.
4. `service.test` — PII stripped for analyst/PM; `pii=1` non-owner → 403;
   owner `pii=1` includes PII columns; roster ignores since/until; event
   dataset without since/until → 400; `practice.via` resolves keys and
   short-circuits on empty; every query carries `organisation_id` (cross-org
   isolation: org B never sees org A rows via the mocked client).
5. `routes.test` — analyst can hit `/api/data-room/*` and is 403 on
   `/api/analytics/business-hub`; reception is 403 on `/api/data-room/*`;
   export sets `text/csv` + `Content-Disposition` and writes an audit row.
6. `permissions` — existing matrix tests extended for the `analyst` role and
   `data.export` key.

Frontend: `npm run typecheck`, `npm run lint`, `npm run build`.

Manual on hosted after deploy: create an analyst via Team → log in → confirm
only Data Room renders, `/business-hub` bounces to `/data-dentally`, a
90-day Dentally appointments export downloads and opens in Excel with correct
headers, and an owner export with PII contains the name columns.

## Out of scope

- Per-lead attribution from Google/Meta lead forms (no such pull exists).
- Column picking, saved views, scheduled exports, XLSX.
- Exposing QuickBooks/Xero, Google Sheets, reviews or Open Banking data.
- Moving Overview behind a permission key for other roles.
