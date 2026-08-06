# GHL → Dentally conversion export to Google Sheets — Design

**Date:** 2026-08-06
**Status:** Approved (brainstormed with owner)
**Migration:** `20260101000121_sheet_export_queue.sql`

## What this is

When a patient gets their **first-ever Dentally appointment**, check whether they
also exist as a **GoHighLevel contact with a lead in a pipeline**. If they do,
append one row to an owner-connected Google Sheet recording the conversion:
name, email, phone, source (GHL pipeline name), appointment date, and lead
incoming date. This is lead-conversion tracking: "lead came in via GHL →
converted to a booking", visible to the group in a spreadsheet they control.

## Decisions made (with the owner)

| Question | Decision |
|---|---|
| Trigger | **First-ever appointment per patient** (not per-appointment, not state-transition). One row per converted patient, ever. |
| Matching | **Email OR phone**, normalised, exact equality only. Email first, phone fallback. |
| Destination | **One spreadsheet, one tab per practice**, auto-created. Owner connects a single write-scoped sheet. |
| History | **Go-forward only.** No backfill on connect. (Outage windows are NOT lost — see error handling.) |
| Architecture | **Outbox queue + drainer** (Approach B). Webhook and nightly sync both enqueue; a drainer matches and writes. |
| Write scope | **Separate connection** (`google_sheets_writer` provider row, full `spreadsheets` scope). The shipped read-only Call Reporting connection is untouched. |

## Architecture

```
Dentally webhook ─┐                       ┌─> match vs GHL contacts ─> values.append ─> mark exported
                  ├─> sheet_export_queue ─┤
Nightly Dentally  ┘   (ON CONFLICT        └─> no pipeline lead ─> status no_match (revisitable 30d)
sync                   DO NOTHING)
                          ▲
        drainer: kicked by webhook (fire-and-forget, after 200)
                 + periodic sweep (retries, catches sync-path inserts)
```

Both ingest paths do one cheap, idempotent thing in the hot path: insert a queue
row. All external I/O (Google) happens in the drainer, never in the webhook
request path.

## Data model — migration `000121`

### `sheet_export_queue` (the outbox)

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `organisation_id` | uuid NOT NULL → organisations | tenancy |
| `practice_id` | uuid → practices | from the triggering appointment |
| `contact_id` | uuid NOT NULL → contacts | the Dentally patient contact |
| `appointment_id` | uuid → appointments | the triggering first appointment |
| `appointment_starts_at` | timestamptz | denormalised for the sheet row |
| `status` | text | `pending` \| `processing` \| `exported` \| `no_match` \| `failed` (CHECK) |
| `claimed_at` | timestamptz | set when a drainer claims the row; stale (>10 min) claims are reclaimable |
| `matched_contact_id` | uuid → contacts | audit: which GHL contact matched |
| `matched_lead_id` | uuid → leads | audit: which lead supplied pipeline + date |
| `attempts` | int default 0 | retry bookkeeping |
| `last_error` | text | last failure reason (never contains tokens) |
| `exported_at` | timestamptz | set only after Google confirms the append |
| `created_at` / `updated_at` | timestamptz | |

**Constraints & integrity:**
- `UNIQUE (organisation_id, contact_id)` — enforces first-appointment-only AND
  dedup in one constraint. Second appointments hit `ON CONFLICT DO NOTHING`.
- FKs: `contact_id` / `matched_contact_id` `ON DELETE CASCADE` (a merged/deleted
  contact takes its queue row with it); `appointment_id` `ON DELETE SET NULL`.
- RLS enabled, org-isolation policy, same shape as sibling tables.
- Index on `(organisation_id, status)` for the drainer's claim query.

### Write connection

New `integrations` provider row: **`google_sheets_writer`**.
- OAuth scope: `https://www.googleapis.com/auth/spreadsheets` (read/write).
- Tokens AES-GCM encrypted via `crypto.js`, decrypted only inside the provider
  module. `SAFE_COLS` on every read path — secrets never leave the repository
  layer, never appear in API responses or logs.
- `config.spreadsheet_id` — owner pastes the sheet URL; `parseSpreadsheetId`
  (reused from Call Reporting) extracts the ID. No Drive scope; we never list
  the user's files.
- Refresh flow with claim guard (Dentally OAuth pattern). Revoked grant →
  integration status `failed` + "reconnect" banner; queue rows stay `pending`.

### Enqueue rule (one SQL source of truth)

The enqueue rule lives in ONE place: RPC `sheet_export_enqueue(p_org, p_since)`
— an `INSERT … SELECT … ON CONFLICT DO NOTHING` that finds Dentally patients
(`contacts.pms_external_id IS NOT NULL`) whose **first-ever non-cancelled
appointment** was created at/after `p_since` (the writer connection's
`config.export_since`, stamped when the destination is set), and inserts one
queue row per patient pointing at that earliest appointment. Patients with any
appointment created before `p_since` never enqueue (go-forward-only); the
unique `(organisation_id, contact_id)` constraint makes re-runs no-ops.

Both paths invoke it: the Dentally webhook kicks a debounced fire-and-forget
drain (which starts with the enqueue RPC) after appointment/patient events, and
the periodic worker sweep runs enqueue+drain for every org with a writer row.
This also catches appointments whose `contact_id` was null at ingest and
relinked later — a per-row ingest hook would miss those. Runs only when the org
has a `google_sheets_writer` integration row in ANY non-disconnected state —
including `failed` (outage windows keep queueing). No row at all → no enqueue.

## The matcher (drainer, per queue row, pure read)

**Candidates:** contacts in the SAME `organisation_id` with
`ghl_contact_id IS NOT NULL`. A Dentally contact never matches itself or
another Dentally-sourced row (guards against the known Dentally duplicate
contacts producing garbage).

**Normalisation (exact equality after normalising — no fuzzy matching):**
- Email: trim + lowercase.
- Phone: strip spaces/dashes/parens; canonicalise UK forms
  (`07…` ↔ `+447…` ↔ `447…` → one shape). Discard numbers with fewer than
  10 digits (too ambiguous to trust).

**Order & tiebreaks:**
1. Email match wins.
2. Else phone match.
3. Multiple GHL contacts share the matched email/phone (family accounts are
   real): prefer the one holding a pipeline lead; still ambiguous → most
   recently created. Choice recorded in `matched_contact_id` — auditable,
   never silent.

**Pipeline requirement:** the matched GHL contact must have ≥1 `leads` row with
`ghl_pipeline_id IS NOT NULL`. None → `no_match`, nothing written. Several →
use the **earliest** lead (`created_at` asc): its `created_at` is the "lead
incoming date", its `ghl_pipeline_id` resolves to a name via the subaccount's
cached pipeline definitions (`integration_accounts.config.pipelines`, fallback
legacy `integrations.config.pipelines`); unresolvable id → raw id as source,
never a blank.

**`no_match` is revisitable:** the sweep retries `no_match` rows younger than
30 days, because GHL sync is nightly — a lead can land AFTER the appointment
enqueued. After 30 days, `no_match` is terminal.

**Integrity:** every matcher query is org-scoped (`organisation_id` filter, house
convention — cross-tenant matching structurally impossible). The matcher's only
writes are to the queue row's own status columns.

## Sheet layout & the drainer

**Tabs:** one per practice, auto-created on first write with a header row.
Tab identity is the practice UUID stored in developer metadata (not the display
name), so renaming a practice in the app does not fork a new tab.

**Row shape (exactly six fields — data minimisation):**

| Name | Email | Phone | Source (Pipeline) | Appointment Date | Lead Incoming Date |
|---|---|---|---|---|---|

Plus a narrow trailing column holding the queue row UUID (the idempotency key).
Dates `dd/mm/yyyy`, Europe/London. No clinical data, no notes, no values ever
leave the app.

**Drainer:**
- Lives in `workers/`; also exported as a function the webhook kicks
  fire-and-forget AFTER responding 200 to Dentally. Periodic sweep (cron)
  retries failures and catches sync-path inserts.
- Claims rows via RPC `sheet_export_claim(p_org, p_limit, p_include_no_match)`:
  an atomic `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`
  flipping `pending` → `processing`. Concurrent drains (webhook-kick vs cron
  sweep, separate processes) get disjoint row sets — no advisory locks, which
  are unreliable across pooled PostgREST connections when the work spans an
  external HTTP call. Stale `processing` rows (`claimed_at` > 10 min old, a
  crashed drainer) are reclaimable. The sweep passes `p_include_no_match=true`
  to revisit young `no_match` rows.
- Batches appends into one `values.append` per practice tab per run.
- **Exactly-once:** `exported` is set only after Google confirms. On retry after
  a crash between append and mark, the drainer re-reads the tab's UUID column
  and skips queue-row UUIDs already present.

## Routes & permissions

Under `/api/integrations/google-sheets-writer/` (static routes before any
`/:provider/*` catch-alls):
- Connect (OAuth start/callback), set destination URL, disconnect —
  `requireRole('owner')`.
- Status (connection health, queue counts: pending/exported/no_match/failed) —
  owner + practice manager.
- Nothing visible to Reception (rule 5). All mutations audit-logged (rule 9).

Frontend: a panel on the Integrations page (Call Reporting `GoogleSheetsPanel`
wizard pattern): connect → paste destination URL → live status card. No new
nav entry.

## Error handling

- **Google 5xx / rate limit / expired token:** row stays `pending`, `attempts`++,
  `last_error` set. Exponential backoff via the sweep. After 10 attempts →
  `failed`, surfaced in the status panel. Nothing dropped silently.
- **Destination sheet deleted / access revoked:** integration → `failed` with a
  distinct "sheet not accessible" status + Integrations banner. Queue keeps
  accumulating `pending`; reconnect drains the backlog automatically. Outage
  windows never lose conversions (go-forward-only applies to connect time, not
  outages).
- **No email AND no phone on the Dentally contact:** immediate `no_match` —
  never an exception or retry loop.
- **Webhook isolation:** a Google outage can never block appointment ingestion
  or cause Dentally webhook retries; the drainer kick is after the 200.

## Testing (TDD, `backend/test/`, Call Reporting style)

- **Normaliser:** email casing/whitespace; UK phone variants
  (`07…`/`+447…`/`447…`/spaced/dashed); short-number rejection.
- **Matcher:** email hit; phone-only hit; ambiguity tiebreak (pipeline-lead
  preferred); Dentally-self-match excluded; no-pipeline-lead → `no_match`;
  earliest-lead selection.
- **Queue:** second appointment no-op (unique constraint); cancelled
  appointments don't enqueue; both webhook and sync paths enqueue; no enqueue
  when writer integration absent.
- **Cross-org isolation (house standard):** org A's patient never matches
  org B's GHL contact; org A's drainer never touches org B's queue.
- **Drainer (Google mocked):** batch append shape; exported-only-after-confirm;
  UUID dedup on retry-after-crash; backoff on failure; no token leakage in any
  error or log line.
- **Routes:** owner-only guards; PM reads status; Reception 403.

## Explicitly out of scope (YAGNI)

- Backfill of historical conversions.
- Per-appointment rows / repeat-visit tracking.
- Any write from the sheet back into the app (one-way export only).
- Non-UK phone canonicalisation beyond the UK forms above.
- Editing/updating previously written rows (append-only).

## Deploy notes

- Migration `000121` must be applied on hosted (then `NOTIFY pgrst, 'reload
  schema';` — recurring gotcha).
- Env: reuses `GOOGLE_SHEETS_CLIENT_ID/SECRET`; the OAuth consent screen must
  have the `spreadsheets` (write) scope added in Google Cloud Console before
  the owner can connect.
- Backend-only + one Integrations-page panel; no breaking API changes; can ship
  independently of other work.
