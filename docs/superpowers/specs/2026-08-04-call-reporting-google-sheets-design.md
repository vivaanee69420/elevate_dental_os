# Call Reporting — Google Sheets lead-response dashboard

**Date:** 2026-08-04
**Status:** Approved (user waived written-spec review; design approved in conversation)

## What this is

A new **Call Reporting** dashboard that replicates the client's existing Google Sheets
lead-response dashboard inside the app. An owner connects a Google Sheet containing raw
lead rows (one row per lead), maps its columns once, and the app renders per-practice,
per-date KPI cards:

1. Total Leads Today (leads created on the selected date)
2. Called Within 3 Min
3. Called Within 10 Min
4. Efficiency % (called < 3 min ÷ total)
5. Leads in Pipeline
6. Not Called
7. Facebook Ads Leads
8. Google Ads Leads

Filters: practice (the app's existing practice scope selector) + a single date.

Out of scope (explicitly dropped from an earlier generic design): any-sheet chart
builder, `sheet_charts` config table, AI chart suggestions. The connector is still built
as its own provider so generic charting could reuse it later.

## Why sync-to-Postgres (not live fetch)

The sheet will grow to a large number of rows. The Sheets API cannot filter rows
server-side — a no-storage design must download the whole tab on every page view, which
degrades linearly with sheet size. Instead we sync rows into Postgres and compute the
cards with one indexed SQL RPC, the same pattern as every other integration in this repo
(Dentally, GHL, QuickBooks, Emergent). The sheet remains the source of truth; the DB copy
is rebuildable at any time via full re-sync.

## Architecture

New provider `google_sheets` following the existing integration layout:

- `backend/src/lib/integrations/google-sheets-provider.js` — OAuth client + Sheets API
  reads (ranged `values.get` / paged reads). Mirrors the OAuth/token-refresh pattern of
  `google-ads-provider.js` (refresh with claim guard, 401 retry) but with **only** the
  `https://www.googleapis.com/auth/spreadsheets.readonly` scope (a "sensitive" scope —
  deliberately avoiding the "restricted" `drive.readonly`, so no sheet listing; the user
  pastes the sheet URL instead and we parse the spreadsheet ID).
- `backend/src/lib/integrations/google-sheets-sync.js` — full sync, incremental top-up,
  practice-value discovery, row parsing/hashing.
- Standard layering: `sheets.routes.js` → `sheets.controller.js` → `sheet.service.js` →
  `sheet.repository.js`, Zod schemas in `models/sheet.model.js`.
- OAuth start/callback wired into the existing `oauth.routes.js` flow with
  `oauth-state.js` signing, same as Google Ads / QuickBooks.

### Data model (one migration)

- `sheet_sources` — id, organisation_id, spreadsheet_id, spreadsheet_url, title,
  tab_name, column_mapping jsonb, header_row int, last_synced_row int, row_count int,
  status (`pending|active|failed`), last_error, last_synced_at, timestamps.
  One source per org for v1 (unique on organisation_id); schema doesn't preclude more.
- `sheet_practice_map` — organisation_id + sheet_value (unique together) → practice_id
  (nullable = intentionally unmapped). Same shape and lifecycle as
  `emergent_practice_map`: values auto-discovered on every sync, mapped explicitly in
  the UI, instant restamp of existing rows on mapping change. **Never match practices by
  name** (hard lesson from the Emergent integration).
- `sheet_leads` — id, organisation_id, source_id, practice_id (nullable until mapped),
  practice_value text (raw sheet value), created_at timestamptz, first_call_at
  timestamptz null, source text null, pipeline_status text null, sheet_row_index int,
  row_hash text, synced_at.
  Unique (source_id, sheet_row_index). Index (organisation_id, practice_id, created_at).
- RLS policies on all three tables (org isolation backstop per project rule 3);
  repositories still enforce explicit `organisation_id` filters per current convention.
- Aggregate RPC `sheet_leads_dashboard(p_org uuid, p_practice uuid, p_date date, p_tz text)`
  returning all eight numbers in one round trip:
  - total = rows where `created_at::date = p_date` (in the org's timezone, default
    Europe/London)
  - called_3m = total ∩ `first_call_at - created_at <= 3 min`
  - called_10m = total ∩ `first_call_at - created_at <= 10 min`
  - efficiency = called_3m / total (computed in the service; RPC returns counts)
  - in_pipeline = total ∩ pipeline_status non-empty (i.e. lead entered the pipeline)
  - not_called = total ∩ `first_call_at IS NULL`
  - facebook / google = total grouped by normalised source value (case-insensitive
    contains "facebook"/"fb" and "google" respectively; exact normalisation finalised
    against the real sheet's source values during implementation, kept in one SQL CASE)
  - `p_practice NULL` = all practices (group view). Rows with unmapped practice
    (`practice_id IS NULL`) count in the group view and in an "Unmapped" notice, never
    silently dropped.

### Column mapping (one-time setup)

After pasting the sheet URL the user picks the tab, we show a preview of the first rows,
pre-guess the mapping from headers, and the user confirms five fields:

- practice (text column)
- lead created timestamp
- first-call timestamp (blank = not yet called)
- lead source
- pipeline status

Only these five columns are ever read into the app (see Security). Mapping is stored on
`sheet_sources.column_mapping` as `{field: columnIndex}` plus the header row index.
Date/time parsing: values requested with `valueRenderOption=UNFORMATTED_VALUE` +
`dateTimeRenderOption=SERIAL_NUMBER`; serial numbers converted to timestamps in the
sheet's timezone (`spreadsheets.get` → `properties.timeZone`); text fallback parsed as
`dd/mm/yyyy` British format.

### Sync strategy — freshness for "Today"

A nightly-only sync would show 0 leads every morning, so three paths:

1. **On dashboard view — incremental top-up.** We store `last_synced_row`; on page load
   the backend fetches only `A{last+1}:…` (a tiny ranged request regardless of sheet
   size, valid because lead logs are append-only) before computing the cards. Debounced:
   skipped if a top-up ran within the last 60 seconds. Failures degrade gracefully —
   cards render from existing data with a "last synced …" note.
2. **Nightly full re-sync** (worker fan-out in `workers/index.js`, per-org failure
   isolation — one org's failure never freezes retries, per the GHL lesson). Catches
   *edits* to existing rows (e.g. `first_call_at` filled in later, so "Not Called"
   shrinks correctly). Reads in pages of 5,000 rows; rows diffed by `row_hash` so
   unchanged rows aren't rewritten; rows deleted from the sheet are deleted from
   `sheet_leads` (by `sheet_row_index` beyond the new row count, and hash mismatch
   handling for in-place edits).
3. **Manual "Refresh now"** button → full re-sync, with sync-status feedback.

### API endpoints (all under `/api`, documented in docs/API.md)

- `GET  /integrations/google-sheets/status` — connection + source + mapping state
  (owner, practice_manager)
- `GET  /integrations/google-sheets/oauth/start` + callback — owner only
- `POST /integrations/google-sheets/source` — paste URL, validate reachability via a
  metadata read before persisting (GHL PIT-check pattern) — owner only
- `GET  /integrations/google-sheets/source/preview` — tabs + first rows for mapping UI —
  owner only
- `PUT  /integrations/google-sheets/source/mapping` — save column mapping, triggers full
  sync — owner only
- `GET  /integrations/google-sheets/practice-map` / `PUT …/practice-map` — discovered
  values + explicit mapping; mapping change restamps `sheet_leads.practice_id`
  in-place — owner only
- `POST /integrations/google-sheets/sync` — manual full re-sync — owner only
- `DELETE /integrations/google-sheets` — disconnect + purge (see Security) — owner only
- `GET  /call-reporting/dashboard?practice=&date=` — runs the incremental top-up then the
  RPC; returns the eight numbers + last_synced_at + unmapped count — owner,
  practice_manager

### Frontend

- New dashboard page `app/(dashboard)/call-reporting` + feature slice
  `frontend/features/call-reporting/` (api, hooks, components).
- Layout per the reference screenshot, rendered in the app's design system (dataviz
  stat-tile conventions, `lib/format.ts`, British English, light mode only — not the
  sheet's look): practice selector (existing scope selector, UUID-guarded) + date picker
  defaulting to today, eight stat cards, "last synced" note, unmapped-practices notice
  linking to the mapping panel.
- Integrations page gains a **Google Sheets — Call Reporting** panel: connect OAuth →
  paste URL → pick tab → column mapping with preview → practice mapping table →
  refresh/disconnect. Follows the `GoHighLevelPanel` / Emergent mapping panel patterns.

## Security (data is sensitive — treated as a first-class requirement)

- **Data minimisation (primary control):** the dashboard needs zero personally
  identifiable data. Only the five mapped columns are ever requested from the Sheets API
  (ranged column reads, not whole-row reads where practical) and stored. Names, phones,
  emails, notes — never read, never stored. Can't leak what we don't hold.
- **Tenant isolation:** explicit `organisation_id` filter in every repository method
  (current convention) + RLS policies on all three tables as the hard backstop + the
  mandatory cross-org isolation test.
- **RBAC:** connect/mapping/sync/disconnect owner-only (`requireRole('owner')`);
  dashboard view owner + practice_manager. Reception remains CRM-only (project rule 5).
- **Token safety:** read-only Google scope (cannot write to or reshare the sheet);
  tokens encrypted at rest via `crypto.js`; never returned by any API (`SAFE_COLS`
  pattern); refresh handled server-side only.
- **No secondary leaks:** row values never logged (pino logs counts + statuses only);
  sheet-lead fields added to the Sentry scrub configuration; sheet data excluded from
  all AI context assembly (same exclusion list as appointment/lead notes); connect,
  mapping and disconnect mutations audited to `audit_log` via existing middleware.
- **Clean exit:** disconnect deletes the token, the source, the practice map, and all
  `sheet_leads` rows for the org in one transaction.
- At rest/in transit: Supabase encryption at rest + TLS (as for existing patient and
  financial data).

## Error handling

- OAuth token expiry → refresh with claim guard; hard refresh failure marks the
  connection `failed` and the panel + dashboard show a status-aware reconnect banner
  (QuickBooks-banner pattern).
- Sheet deleted / permission revoked → source `failed`, Google's error surfaced in the
  panel; cached cards stay viewable with a stale-data note.
- Ragged/short rows padded; rows with an unparseable created-timestamp are skipped and
  counted (skipped count surfaced in sync status, never silently dropped).
- Unmapped practice values → rows stored with `practice_id NULL`, surfaced as an
  "Unmapped" notice with a link to the mapping UI.
- Google 429/5xx → bounded retry with backoff in the provider (rate-limit lesson from
  Dentally: treat non-standard rate-limit signals as retryable).

## Testing

- Vitest (backend): URL→spreadsheet-ID parsing; serial-number and text timestamp
  parsing; row hashing + diff (edit/delete/append); incremental top-up range maths;
  practice restamp on mapping change; dashboard RPC service shape incl. efficiency %
  and source normalisation; cross-org isolation; disconnect purge; token never present
  in any API response.
- Frontend: typecheck/lint/build (no FE test framework, per repo state).

## Environment

Reuses the existing Google OAuth client (same `GOOGLE_ADS_CLIENT_ID`-family credentials
or a dedicated `GOOGLE_SHEETS_CLIENT_ID/SECRET` pair — decided at implementation time
based on how the Google Cloud project's consent screen is configured; the Sheets API must
be enabled on the project either way). Redirect URL derives from
`BACKEND_PUBLIC_URL`/`APP_URL` like the other OAuth providers.

## Known limitations (accepted)

- Incremental top-up assumes append-only rows; intraday *edits* (first-call time filled
  in hours later) are only picked up by the nightly full sync or a manual refresh. If
  this proves too stale in practice, a lightweight periodic full sync (e.g. hourly) can
  be added to the worker later.
- One connected sheet per org in v1.
- Sheet timezone and org timezone are assumed to be Europe/London for date bucketing;
  parameterised in the RPC for future flexibility.
