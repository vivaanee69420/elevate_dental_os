# Call Reporting v2 — one sheet per practice, real columns, 10 cards

**Date:** 2026-08-05 · **Status:** approved · **Supersedes** the practice-map +
five-column model in `2026-08-04-call-reporting-google-sheets-design.md`
(connection/OAuth/minimisation sections there still stand).

## Why

The shipped v1 assumed one spreadsheet per org with per-row practice / source /
first-call-timestamp columns. The client's real setup is different:

- **One Google Sheet per practice** (e.g. a "Barnet" spreadsheet), tab
  `Lead_Conversion_Tracking`.
- Columns: `Date (MM/DD/YYYY)` · `Lead Name` · `Email` · `Phone` ·
  `Created Time (BST)` · `Called Within 3 min` · `Called within 10 min` ·
  `Pipeline Name` · `Treatment intrested in` · `Assigned to`.
- No practice column, no source column; the call-response columns are
  pre-computed **Yes/No**, not timestamps.
- Wanted cards (10): Total Leads Today, Called Within 3 Min, Called Within
  10 Min, Efficiency %, Leads in Pipeline, Not Called, **Office Time Leads**,
  **Outside Office Time**, Facebook Ads Leads, Google Ads Leads.

## Decisions (confirmed with the owner)

1. **One spreadsheet per practice.** An org connects N sheets; each sheet IS a
   practice for this feature.
2. **Self-contained — no link to the app's `practices` records.** Each
   connected sheet gets a free-text `practice_label` typed at connect time
   (e.g. "Barnet"). The Call Reporting practice filter lists those labels.
   `sheet_practice_map` and per-row practice resolution are removed.
   (`organisation_id` scoping stays on every table — tenant isolation, rule 3.)
3. **Call columns are Yes/No buckets, not cumulative.** Demo numbers (6 total,
   2 called <3m, 0 called <10m, 4 not called) show "Called within 10 min"
   means *called between 3 and 10 minutes* — a separate bucket. So each card
   counts its own column's Yes; Not Called = neither Yes.
4. **Facebook/Google come from `Pipeline Name`** (regex match, as v1 did on
   `lead_source`).
5. **Office hours = Mon–Fri 09:00–17:00 Europe/London**, judged on the lead's
   created timestamp (Date + Created Time combined). Hardcoded in the RPC —
   per-practice hours are YAGNI until asked for.
6. **Efficiency % = called<3m ÷ total** (33.3% = 2/6 in the demo), computed in
   the service as today.

## Data model — migration `20260101000119_call_reporting_multi_sheet.sql`

All idempotent; `NOTIFY pgrst, 'reload schema';` at the end.

### `sheet_sources` (N per org, one per practice)
- Drop `unique (organisation_id)`; add `unique (organisation_id, spreadsheet_id)`.
- Add `practice_label text` (required by the app at connect time).
- Everything else (mapping/tab/status/sync bookkeeping columns) unchanged.

### `sheet_leads` (minimised: five mapped fields only)
- Add `called_3m boolean not null default false`,
  `called_10m boolean not null default false`, `pipeline_name text`.
- Drop `first_call_at`, `lead_source`, `pipeline_status`, `practice_value`,
  `practice_id` (and the two practice indexes; keep/recreate
  `(organisation_id, source_id, created_at)` + `(organisation_id, created_at)`).
- `delete from sheet_leads` — v1 rows don't fit the new shape; the feature
  shipped yesterday and a re-sync fully repopulates.

### Removals
- `drop table sheet_practice_map` and `drop function
  restamp_sheet_lead_practices(uuid)`.

### RPC `sheet_leads_dashboard(p_org uuid, p_date date, p_source uuid default null, p_tz text default 'Europe/London')`
Drop the old function first (return signature changes). Returns one row:

| column          | definition                                                            |
|-----------------|-----------------------------------------------------------------------|
| `total`         | rows where `(created_at at time zone p_tz)::date = p_date`            |
| `called_3m`     | `called_3m` is true                                                   |
| `called_10m`    | `called_10m` is true                                                  |
| `in_pipeline`   | `pipeline_name` non-blank                                             |
| `not_called`    | `not called_3m and not called_10m`                                    |
| `office_time`   | local dow Mon–Fri AND local time `>= 09:00` and `< 17:00`             |
| `outside_office`| `total - office_time` (computed as its own filter for clarity)        |
| `facebook`      | `pipeline_name ~* '(facebook|\mfb\M|meta)'`                           |
| `google`        | `pipeline_name ~* '(google|adwords|\mppc\M)'`                         |

Filter: `organisation_id = p_org`, date bucket in `p_tz`, and
`(p_source is null or source_id = p_source)`. `unmapped` is gone (practice is
now structural, not row-resolved).

## Sync — `google-sheets-sync.js`

`MAPPED_FIELDS = ['date', 'created_time', 'called_3m', 'called_10m',
'pipeline_name']` (still exactly five ranged columns per batchGet; Lead
Name/Email/Phone/Treatment/Assigned-to are never requested or stored).

New pure helpers (exported for tests):
- `combineDateTime(dateVal, timeVal, tz)` → ISO UTC.
  - date: serial number → whole days; text → ISO `yyyy-mm-dd`, else
    **`MM/DD/YYYY`** (the sheet's stated format — NOT the v1 dd/mm parser).
  - time: serial fraction of a day; text → `hh:mm[:ss]` with optional AM/PM;
    blank time → midnight.
  - Wall time in the sheet's timezone → UTC via the existing `tzOffsetMs`.
  - No parsable date → row skipped (counted in `skipped_rows`, as v1).
- `parseYesNo(v)` → boolean. True for boolean `true`, `'yes'`, `'y'`,
  `'true'`, `'1'` (case-insensitive, trimmed). Everything else — including
  blank — false.

`parsePage` builds `{created_at, called_3m, called_10m, pipeline_name}`;
`hashRow` hashes those four. `stampRows`/practice discovery is deleted.

`fullSync(orgId, sourceId)` and `topUp(orgId, source)` operate on ONE
source (debounce key `orgId:sourceId`); the nightly worker (`syncAllOrgs()`)
and the dashboard top-up (`topUpAll(orgId)`) iterate the org's configured
sources individually, isolating per-source failures. `syncAllOrgs()` still
retries `failed` ones.

## Backend service / routes

`sheet.repository.js`: `getSource(orgId)` → `listSources(orgId)` +
`getSourceById(orgId, id)`; `createSource` takes `practice_label`; practice-map
methods removed; `dashboard` passes `p_source`.

`sheet.service.js`:
- `status(orgId)` → `{connected, connectionStatus, connectionError,
  sources: safeSource[]}` (each source now includes `id` and
  `practice_label` — `id` is needed to address per-sheet actions).
- `addSource(orgId, {url, practice_label})` — label required (non-blank,
  trimmed); still validates reachability via `getMeta` before persisting;
  returns tabs for the mapping step.
- `preview` / `saveMapping` / `syncNow` take `sourceId`.
- `removeSource(orgId, sourceId)` — deletes that source's leads + row (new).
- `disconnect(orgId)` — everything + revoke tokens (unchanged semantics).
- `dashboard(orgId, {date, sourceId})` — top-up all sources (debounced
  per source), then one RPC call. Response: `configured` (any mapped source),
  10 card values, `sources: [{id, practice_label, status, last_synced_at}]`
  so the page can render the filter + sync health from one call.

Routes (same guards as v1 — owner for mutations, owner+PM for reads):
- `GET  /api/integrations/google-sheets/status`
- `POST /api/integrations/google-sheets/sources` `{url, practice_label}`
- `GET  /api/integrations/google-sheets/sources/:id/preview?tab=`
- `POST /api/integrations/google-sheets/sources/:id/mapping`
- `POST /api/integrations/google-sheets/sources/:id/sync`
- `DELETE /api/integrations/google-sheets/sources/:id`
- `POST /api/integrations/google-sheets/disconnect`
- `GET  /api/call-reporting/dashboard?date=&source=`
- Practice-map routes (`/practice-map`) removed. `docs/API.md` updated.

## Frontend

`GoogleSheetsPanel` (Integrations): multi-sheet manager.
- Connected state: table of sheets — practice label, spreadsheet title + tab,
  rows synced, status chip, last sync, per-row Refresh / Remove — plus an
  "Add sheet" button.
- Add-sheet wizard (per sheet): browse-with-Picker or paste URL → practice
  name input → tab select → 5-column mapping (Date, Created Time, Called
  Within 3 min, Called within 10 min, Pipeline Name) with the existing
  preview table → save kicks the first sync.
- Practice-value mapping table removed.

`features/call-reporting` page:
- Filter dropdown = "All practices" + the connected sheets' labels
  (value = source id, sent as `?source=`). Date picker unchanged.
- 10 cards in the demo's order: Total Leads Today · Called Within 3 Min ·
  Called Within 10 Min · Efficiency % (Called < 3m) · Leads in Pipeline ·
  Not Called · Office Time Leads · Outside Office Time · Facebook Ads Leads ·
  Google Ads Leads.
- Nav/permissions unchanged (`growth.view`, never Reception — rule 5).

## Testing

Rework the v1 backend suites (parse/repo/service):
- `combineDateTime`: serial+serial, serial+blank, MM/DD/YYYY text + `hh:mm`
  text, AM/PM, invalid → null; DST boundary (BST vs GMT).
- `parseYesNo`: yes/Yes/TRUE/1/y → true; no/blank/junk → false.
- `parsePage`: buckets + hash change detection with the new fields.
- Office-hours bucketing via the RPC path (mocked repo → service response
  shape) — Mon 09:00 in, Sat 10:00 out, Fri 16:59 in, Fri 17:00 out,
  22:00 weekday out.
- Multi-source: two sources, dashboard filtered by one; cross-org isolation
  (unchanged assertion, new shape); no-token-leak on status.
- Frontend: typecheck + lint (no test framework, unchanged).

## Rollout

1. Apply `000119` on hosted (wipes v1 `sheet_leads`; drops practice map);
   `NOTIFY pgrst, 'reload schema';`.
2. Deploy backend + frontend together (API shape changes are breaking).
3. Owner connects each practice's spreadsheet and maps columns once; nightly
   03:40 worker and on-view top-up carry on unchanged.

## Known limitations

- Text-format dates are parsed as `MM/DD/YYYY` (per the sheet's header). If a
  practice's sheet uses dd/mm text dates, cells must be real date values
  (serials) — which is also what Sheets produces by default.
- Office hours are global constants (Mon–Fri 9–5 London), not per practice.
- On-view top-up is append-only; in-place edits (e.g. a Yes filled in later
  that day) appear after the nightly full re-sync or a manual Refresh — same
  trade-off as v1.
