# API Reference — Elevate Dental OS

Base URL: `https://api.elevate.app` (production) · `https://staging-api.elevate.app` (staging)

All authenticated endpoints require `Authorization: Bearer <supabase_jwt>` header.

## Health check

### `GET /healthcheck`
Returns `{ status: 'ok', timestamp, version }`. No auth required.

## Authentication

### `POST /auth/signup`
Public self-registration. Creates organisation + owner user, but the owner is
created **`pending`** and CANNOT log in until a platform admin approves them
(see `POST /api/platform/signups/:id/approve`). Rate-limited 5/min/IP.
```json
Request:
{
  "email": "owner@example.com",
  "password": "...",
  "full_name": "Owner Name",
  "organisation_name": "My Dental Group"
}

Response:
{ "success": true, "organisation_id": "uuid", "status": "pending",
  "message": "Account created. Awaiting approval before you can log in." }
```

### `POST /auth/login`
Validates credentials + the provisioning/approval gate, returns a Supabase
session. Rate-limited 5/min/IP.
```json
Request:  { "email": "...", "password": "..." }
Response: { "access_token": "...", "refresh_token": "...", "expires_at": 0 }
```
Gate responses (403): `pending` → "Your account is awaiting approval.";
`rejected` → "Your account was not approved."; no `users` row → "Account not
provisioned."

> **Unified login (frontend):** the single `/login` page posts to the Next
> route `POST /auth/login`, which calls this endpoint first; on a plain `401`
> it falls back to `POST /api/platform/login` and, on success, sets the
> separate `platform_token` cookie. Tenants land on `/dashboard`, platform
> superadmins on `/platform/overview`. The two token systems stay isolated.

### `GET /auth/me`
Returns current user info (used by sidebar).
```json
Response:
{
  "id": "uuid",
  "email": "...",
  "role": "owner" | "practice_manager" | "reception",
  "organisation_id": "uuid",
  "organisation_name": "...",
  "features": ["data_room", "call_reporting"]
}
```
- **`features`** — enabled org-level feature keys. Catalog in `backend/src/lib/features.js`. Internal features default off; product modules default on.

### `POST /auth/invite` *(owner-only)*
Invites a team member.
```json
Request:
{
  "email": "...",
  "full_name": "...",
  "role": "owner" | "practice_manager" | "reception"
}
```

## Feature-gated endpoints

The following endpoint families are feature-gated and return 403 if the feature is not enabled for the organisation:

- **Data Room** (`/api/data-room/*`) — analyst-ready dataset registry and export
- **Call Reporting** (`/api/call-reporting/*`, `/api/integrations/google-sheets/*`) — Google Sheets lead-response dashboard
- **Emergent Integration** (`/api/integrations/emergent/*`) — real-time webhook and practice mapping
- **Google Sheets Writer** (`/api/integrations/google-sheets-writer/*`) — GHL→Dentally conversion export

All feature-gated 403 responses share the error body:
```json
{
  "error": "Feature not enabled",
  "code": "FEATURE_DISABLED"
}
```

The generic multi-provider integration routes (`POST /api/integrations/connect`, `/api/integrations/:provider/{callback,refresh,sync,sync-progress,webhook-info,webhook-secret}`) enforce the same 403 at runtime when `:provider` is one of the three feature-bound providers (`emergent`, `google_sheets`, `google_sheets_writer`). `POST /api/integrations/:provider/revoke` is deliberately **not** gated — an organisation whose feature is switched off can always disconnect the provider.

## Agency (A2)

Agency access is a **per-user grant**: `users.is_agency_admin`. It is NOT implied by owning an org — an agency org holds both agency staff and client users, so the org flag alone would hand sub-account creation, practice mapping and production logs to clients. `organisations.is_agency` now only marks the single org that **owns** the sub-accounts; an agency admin may sit in a different org and still administer it (the acting org is resolved server-side in `authenticate`, never taken from the caller).

Grant or revoke with `PATCH /api/platform/users/:id/agency-admin` — body `{ "enabled": true|false }`, **superadmin-only**, audited as `set_agency_admin`.

**Sub-accounts** are organisations with `parent_organisation_id` set to the agency org. All routes below require an agency admin (they keep working while switched into a sub-account). Callers without the grant get 403:

```json
{ "error": "Agency access required", "code": "AGENCY_ONLY" }
```

- `GET /api/agency/subaccounts` — `{ subaccounts: [{ id, name, created_at, integrations: [{provider,status}], features: {key:bool} }] }`.
- `POST /api/agency/subaccounts` — `{ organisation_name }` → 201 `{ organisation_id, name }`. Creates the **organisation only** — no owner and no temporary password. Users are added separately (below) with a permanent password the agency sets. Slug collisions retry once with a suffix.
- `GET /api/agency/subaccounts/:id/users` — `{ users: [{ id, email, full_name, role, status }] }`.
- `POST /api/agency/subaccounts/:id/users` — `{ email, full_name, password, role }` (role: `owner` | `practice_manager` | `reception`) → 201. Reuses `provisionMember` against the sub-account org, so the user is an ordinary member of exactly one organisation and is isolated from every other account by `users.organisation_id`. The password is permanent; there is no forced change.
- `DELETE /api/agency/subaccounts/:id` — `{ confirm_name }` must equal the organisation's name (case/whitespace-insensitive). **Irreversible**: `organisations` cascades every business table, and the Supabase auth identities are deleted explicitly so none are orphaned.
- `GET /api/agency/subaccounts/:id/features` — `{ features, overrides }` (effective map + raw `org_features` rows).
- `PATCH /api/agency/subaccounts/:id/features` — `{ feature, enabled }` (key must exist in the catalog; target must be a child org) → `{ features }`.
- `POST /api/agency/switch` — `{ orgId }` → `{ token, expires_at, organisation }`. The token is HMAC-signed (secret `AGENCY_SWITCH_SECRET`, falling back to `OAUTH_STATE_SECRET`), bound to the calling user, ~12h expiry.

**Account picker (multi-org membership)**: a login may belong to several organisations via `user_organisations` (migration `000136`). `GET /auth/me` returns `accounts: [{id,name,role}]` + `active_organisation_id`; `POST /auth/switch-org {orgId}` confirms a membership (403 otherwise). The frontend stores the choice in an httpOnly `active_org` cookie (Next route `/api/active-org`) and the proxy replays it as `x-active-org`, which `authenticate` re-validates against the membership table on EVERY request — the header is never authorisation by itself, and an unbacked value silently falls back to the home org. The membership's own role/permissions apply while acting there. Adding an existing email to a sub-account creates a membership rather than failing. Agency context takes precedence when both are present.

**Switch transport**: the frontend stores the token in an httpOnly `agency_switch` cookie (set by the Next route `/api/agency-switch`; `DELETE` clears it) and the generic backend proxy re-injects it as an `x-agency-switch` header on every request. `authenticate` re-validates it per request (token user = caller, home org is an agency, target's parent = home org) and then acts as the target org's owner with `req.agencyContext = { actorUserId, homeOrgId }`; any invalid/stale token is silently ignored (home context). Switched mutations audit with the acting org + real actor plus `diff.via_agency`. `/auth/me` gains `agency: { is_agency_actor, switched, home_org }`.

**Agency-actor-only mapping mutations** (403 `AGENCY_ONLY` otherwise): `PUT /api/ad-attribution/pipelines/:accountId/:pipelineId`, `PATCH /api/ad-attribution/subaccounts/:id`, `PATCH /api/ad-attribution/ad-accounts/:id`, `PATCH /api/practices/:id/pms-site-id`, `POST /api/integrations/emergent/practices`, and the `practice_id` field of `PATCH /api/integrations/gohighlevel/accounts/:id`. Reads stay owner/PM.

## Business Health

### `GET /api/health`
Returns current org's business health record.

### `PUT /api/health` *(owner-only)*
Saves partial wizard data. Merges with existing baseline/targets.
```json
Request (any subset):
{
  "setup_step": 3,
  "setup_completed": false,
  "baseline": { "revenue": 4590000, "profit": 459000 },
  "targets": { "years": 3, "profit_multiple": 2 }
}
```

### `GET /api/health/insights` *(owner-only)*
AI-generated 5-insight analysis using Claude Sonnet 4.6.
```json
Response:
{
  "insights": [
    {
      "title": "Conversion below benchmark",
      "severity": "warning",
      "finding": "11.5% lead-to-treatment vs 18% top-quartile",
      "impact": "+£35k/month",
      "action": "TCO training + treatment plan script"
    }
  ]
}
```

### `GET /api/health/progress`
Returns baseline → current → target for 8 metrics with progress %.
Optional `?asOf=YYYY-MM-DD` rewinds the manual baseline/targets to what they were on that date (000054 history) and windows live actuals to the same upper bound.

### `GET /api/health/snapshots`
Historical snapshots ordered chronologically.

### `POST /api/health/snapshots` *(owner-only)*
Manually capture a snapshot.

### `GET /api/health/metrics`
Returns the unified business-health metric array. Each item:
`{ key, label, cat, unit, better, sourceType, source, asof, needsInput, baseline, current, target, progressPct, deltaFromBaselinePct }`.
`current` is live-computed for `sourceType: auto` (revenue/profit/margin/cash from analytics actuals; conversion/no-show from rollups) and read from the manual store for `sourceType: manual`. Reception receives `{ metrics: [] }`.
"Hybrid" metrics (new/active/retention/recall patients, avg case value, production/associate, chair utilisation, lead response — catalog `computed: true`, migration 000056) are computed live from the Dentally-synced tables / chair grid / leads; when a live value exists it WINS over any manual entry and the item is returned with `sourceType: auto` and `source` set to its origin (`dentally` | `grid` | `ghl`). When the source has no data, the item falls back to `sourceType: manual` (owner-editable). Live computation runs only for the live view, not for `?asOf` history.
Optional `?asOf=YYYY-MM-DD` returns the manual baseline/targets/KPIs as they were on that date (000054 history); the UI treats an as-of view as read-only.

### `PATCH /api/health/metrics/:key` *(owner-only)*
Body `{ value: number }`. Sets a manual metric value (`business_health.manual[key] = { value, asof }`). 400 if the key is unknown or auto-sourced; 403 for non-owners. Audited.

## Leads

### `GET /api/leads?status=new&practice_id=...&limit=100`
List leads with filters.

### `POST /api/leads`
Create new lead. Either provide `contact_id` or new `contact` data.
```json
{
  "contact_id": "uuid",
  "treatment": "Single tooth implant",
  "estimated_value_pence": 285000,
  "source": "instagram",
  "utm_campaign": "all-on-4-spring"
}
```

### `PATCH /api/leads/:id`
Update lead. Common: status changes, reassign.

### `GET /api/leads/funnel`
Returns counts + £ values per status (for pipeline header).

### `GET /api/leads/pipelines?integration_account_id=...`
GoHighLevel pipeline definitions (id, name, ordered stages) that drive the
Pipeline board's columns and selector, each with its `lead_count` /
`value_pence`, busiest pipeline first.

Pipeline ids belong to a single GHL Location, so this is scoped to one
subaccount: pass `integration_account_id` for that subaccount's pipelines, or
omit it for the union across every connected subaccount ("All subaccounts").
Orgs with no `integration_accounts` row fall back to the legacy org-level
`integrations` config.

## Contacts

### `GET /api/contacts?type=patient&search=smith&limit=200&practice_id=`
Optional `practice_id` (UUID) scopes to one practice; omitted = org-wide (incl. unassigned).
### `GET /api/contacts/:id` — full contact with related leads/comms/appointments
### `POST /api/contacts` — create
### `PATCH /api/contacts/:id` — update

## Communications

### `GET /api/comms?contact_id=...&channel=email`
### `POST /api/comms/send` — send email/SMS
```json
{
  "contact_id": "uuid",
  "channel": "email" | "sms",
  "to": "patient@example.com",
  "subject": "...",
  "body": "..."
}
```

## Appointments

### `GET /api/appointments?from=...&to=...&page=1&per_page=25`
Paginated (default 25/page, max 100), ordered by `starts_at` asc. Returns `{ appointments, total, page, per_page }`. Optional `practice_id` / `associate_id` filters. Defaults to real patient appointments only — patient-less Dentally diary blocks (lunch / not-working / nurse-cover / empty slots, no `pms_patient_id`) are excluded; pass `patients_only=false` to include them. Each appointment includes joined `contact` (`id`, `first_name`, `last_name`, `email`, `phone`) / `practice` / `associate`.

Optional `search=<3-80 chars>` filters by **patient name, email or phone** in one term (matched against a `contacts.search_blob` trigram index, migration `…000147`). A search **ignores `from`/`to` entirely** — it answers "find this patient's appointments", so running it from a date-bounded view must not hide their other visits — and returns `starts_at` **desc** (newest first) rather than asc. `practice_id` / `associate_id` / `patients_only` still apply.

**Match rule:** text matches at **word starts only** — `smi` finds Smith and Smithson, `ann` finds Ann and Annabel but not Joanne or Hannah. This is a deliberate speed/precision trade: on the worst-case term it is 414 matching contacts instead of 1,559 and 27ms instead of 46ms. Searching the middle of a word (`mith` for Smith) therefore does not match. **Phone fragments are the exception and match anywhere**, since people quote the tail of a number: any run of 4+ digits is reduced to its last 10 and matched as a substring, so a contact stored as `+447700900123` is found by `07700 900123`, `900123`, or `+44 7700 900123` alike.

`%` and `_` in the term are literal, not wildcards. Terms under **3** characters are rejected (400) — a trigram is three characters, so a shorter term cannot use the index and degrades to a full scan of the org's contacts (258ms); an empty/whitespace term reads as "no search". Served by the `appointments_search` RPC rather than a PostgREST embed filter — the embed plans as a nested loop over the org's appointments and measured 1,473ms/page against 27ms for the RPC.
### `POST /api/appointments` — create
### `PATCH /api/appointments/:id` — reschedule/cancel

## Chair utilisation (manual)  — owner / practice_manager

- `GET  /api/chair-utilisation?practice_id=<uuid>` — list manual records.
- `GET  /api/chair-utilisation/grid?practice_id=<uuid>` — aggregated weekday×slot heatmap. Optional `&asOf=YYYY-MM-DD` (with `practice_id`) replays the historical grid as it was on that date (000055 history)
  `{ days:[1..7], slots:['morning','midday','afternoon','evening'], grid, kpis }`.
- `POST /api/chair-utilisation` — body `{ practice_id, chair_name, weekday(1-7), slot, booked_minutes, available_minutes, notes? }`.
- `PATCH /api/chair-utilisation/:id` — partial update (practice_id immutable).
- `DELETE /api/chair-utilisation/:id`.

## Associates  — owner / practice_manager

- `GET /api/associates?practice_id=<uuid>&weeks=52` — roster merged with Dentally
  appointment stats. Each row: `{ id, full_name, practice, pay_pct, joined_date, active,
  treatments, appointments_total, no_shows, completion_pct, no_show_pct, status }`.
  `ttm_production`, `ttm_uda`, `conversion` are always `null` (not in the Dentally feed).
  Associates are created/linked by the Dentally sync (`/practitioners` → `associates`,
  `practitioner_id` → `appointments.associate_id`). A full re-sync backfills `associate_id`
  on historical appointments.

## Staff  — owner / practice_manager

- `GET /api/staff?practice_id=<uuid>` — team roster, sourced from the Dentally
  `/users` sync. Returns `{ staff: [{ id, full_name, role, practice, email, phone,
  last_login_at, recently_active }], total_staff, distinct_roles, practices_covered,
  active_count }`, sorted by name. `role` is the raw Dentally label ("Dentist",
  "Receptionist", …); `recently_active` / `active_count` = logged in within 90 days.
  HR data (hourly rate, weekly hours, scheduled hours, attendance) is **not in
  Dentally** and is intentionally absent. Staff are created/linked by the Dentally
  sync (`/users` → `staff`, upsert on `organisation_id,source,pms_external_id`).

## Treatments  — owner / practice_manager

- `GET /api/treatments?practice_id=<uuid>&weeks=52` — Treatment Mix: appointment
  **volume** grouped by `appointment_type` over the window. Returns
  `{ treatments: [{ type, volume, share_pct }], total_volume, distinct_types,
  top_treatment, window_weeks }`, sorted by volume desc. This is volume only —
  Dentally appointments carry no price, so there is no revenue/margin here.
  NULL `appointment_type` collapses to `"Unspecified"`. Backed by the
  `treatment_mix_stats` RPC with a paginated fallback scan.

## Payments

### `GET /api/payments?status=settled&since=2026-01-01&until=2026-03-31&page=1&limit=25&practice_id=`
Paginated. Returns `{ payments, total, page, limit, pages }`. `limit` max 100, default 25. Filters: `status` (settled|pending|processing|failed|refunded|disputed), `since`/`until` (created_at date range, YYYY-MM-DD), `practice_id` (UUID). All optional; omitted = org-wide / all.
### `GET /api/payments/summary?practice_id=`
Aggregate stat cards over ALL payments (not the current page): `{ today, week, month, outstanding }` in pence (settled for today/week/month, pending for outstanding). Optional `practice_id` (UUID) scopes to one practice.
### `POST /api/payments/create-payment-link` — generates Stripe link
```json
Request:
{ "amount_pence": 28500, "description": "Consultation deposit", "contact_id": "uuid" }

Response:
{ "url": "https://buy.stripe.com/..." }
```

## Debt Recovery

### `GET /api/debt?practice_id=`
Aged debt view from unpaid Dentally invoices (`invoices` where `amount_outstanding_pence > 0`). Auth required; org-scoped. Optional `practice_id` (UUID) filters to one practice; omitted = org-wide. No route-level role gate (matches `/api/payments`); finance/Reception visibility is enforced at the frontend nav layer. Aging is days since `due_on` (falling back to `dated_on`); not-yet-due invoices count as 0 days.
```json
Response:
{
  "outstanding_pence": 605000,
  "overdue90_pence": 425000,
  "bands": [
    { "key": "0-30", "label": "0-30 days", "count": 1, "total_pence": 180000 }
  ],
  "debtors": [
    { "name": "R Sutton", "practice": "Warwick Lodge", "treatment": "All-on-4", "amount_pence": 425000, "age_days": 176 }
  ]
}
```
`bands` always has the five fixed keys (`0-30`, `31-60`, `61-90`, `91-120`, `120+`). `debtors` is sorted oldest-first; `name` falls back to the invoice `patient_name`, then "Unknown patient", when no contact is linked. Money in integer pence.

## Pay Runs *(owner-only)*

### `GET /api/pay-runs`
### `GET /api/pay-runs/draft?period_start=2026-05-01&period_end=2026-05-31`
Draft preview (not persisted). Production per active associate is summed from
completed `treatment_plans` for the period and run through `calculateAssociatePay`.
Dates are `YYYY-MM-DD`. Returns
`{ period_start, period_end, status: "draft", rows: [{ associate_id, full_name,
practice, pay_pct, lab_split_pct, production_pence, lab_cost_pence, gross_pence,
lab_deduction_pence, prev_balance_pence, net_pence }], totals: { production, gross,
lab, net }, pct_of_production }`. Lab cost is `0` (no lab-invoice feed yet) so
`net == gross`; NHS UDA production is excluded. Backed by the `associate_production`
RPC with a paginated fallback scan. See `docs/FORMULAS.md` §3.
### `POST /api/pay-runs/calculate`
```json
{
  "period_start": "2026-04-01",
  "period_end": "2026-04-30",
  "lines": [
    { "associate_id": "uuid", "production_pence": 4500000, "lab_cost_pence": 320000 }
  ]
}
```
Returns calculated gross/lab deduction/net per line.

### `POST /api/pay-runs/:id/approve`

## Plan4Growth AI (AI)

### `POST /api/p4g-ai/chat`
```json
Request:
{
  "message": "What should I focus on this month?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}

Response:
{
  "reply": "...",
  "usage": { "input_tokens": 234, "output_tokens": 567 }
}
```
**Note (Phase B — drill-down tools):** response shapes for all 5 AI surfaces (chat coach, analyst, board report, insights, task generation) are unchanged. Internally the model may now invoke a `get_metrics` tool to fetch figures for other periods or date ranges before composing its final reply; `usage` reflects the sum of all tool-loop turns. JSON-contract surfaces (board report, tasks) enforce output shape via a final schema-formatting turn.

## Analytics

### `GET /api/analytics/dashboard` — main dashboard rollup
### `GET /api/analytics/pl` — Profit & Loss using formulas.calculatePL()
### `GET /api/analytics/pl-benchmark?practice_id=<uuid>` — Profit Benchmarking (Intelligence OS — CoA→P&L). Actual cost/profit ratios vs the UK dental group benchmarks (Dentist 45 · Staff 18 · Lab+Material 15 · Other Fixed 12 · Profit 10), from `formulas.calculateProfitBenchmark`. Returns `{ rows:[{key,label,benchmarkPct,benchmarkPence,actualPence,actualPct,variancePts,good,severity,verdict}], overspendPence, dentistStaffSeparable, marginPct, netProfit, totalCosts, costsAvailable, basis, periodsCovered }`. **Real `monthly_financials` actuals only — never the baseline** (Finance screen, FORMULAS §1a/§1b); no cost source ⇒ `costsAvailable:false`, no rows. `dentistStaffSeparable:false` flags Xero folding associate pay into staff. finance.view.
### `GET /api/analytics/valuation` — 3-model valuation
### `GET /api/analytics/kpis` — 23-metric scorecard with traffic lights
### `GET /api/analytics/business-hub?days=90` — group + per-practice rollup (Business Hub): revenue (settled payments), appointments/no-show (appointments), conversion (leads), group margin/target from business_health baseline. finance.view.
### `GET /api/analytics/treatments-completed-lines?scope&since&until&label&limit&offset` — drill-down behind the "Treatments Completed" card (shown on the Clinicians page). One row per completed Dentally treatment in the window (`treatments_completed_lines` RPC, migration 000109) — same filter as `treatments_completed_by_practice` (completed, non-base_chart, by `completed_at`) so it reconciles to the card. Each row: patient (via `contact_id`, null when unlinked), clinician (`associates.full_name` via `associate_id`), treatment, and `value_pence` (the treatment's price = revenue). Same `scope`/period params as `/clinicians` (a practice scope filters to that practice; academy/lab return empty). **Paginated** — `limit` (default 100, max 500) + `offset`; the Clinicians page loads the first page then back-fills. `totals` (whole-window count + revenue, from the aggregate) is returned only on the first page (`offset=0`) and is `null` thereafter. Returns `{ window:{since,until,label}, totals:{count,valuePence}|null, lines:[{id,completedAt,practiceId,practiceName,patientName,clinicianName,treatmentName,valuePence}], limit, offset, basis:'dentally_treatment_items', note }`. All money integer pence. finance.view.
### `GET /api/analytics/plan-fees-lines?since&until&label&practice_id=<uuid>` — drill-down behind the "Plan Fees Collected" card (Group Performance). Every Dentally treatment-plan invoice line in the window (`plan_fees_collected_lines` RPC, migration 000107): one row per `invoice_items` line with `treatment_plan_id` set. `collected_pence` = each line's share of its invoice's actual payments (invoice gross − outstanding, pro-rata; rounded to the penny). Same window rules as `business-hub` (explicit `[since,until]` else trailing `days`); optional `practice_id` (UUID) scopes lines + totals to one practice (group buckets pass no filter). Returns `{ window:{since,until,label}, totals:{billedPence,collectedPence,lineCount}, lines:[{id,invoicedOn,practiceId,practiceName,patientName,treatmentName,treatmentPlanId,invoiceId,billedPence,collectedPence,invoiceAmountPence,invoiceOutstandingPence}], basis:'invoice_items', note }`. **Totals are canonical** (from `treatments_closed_revenue_by_practice`, which rounds the summed products once) so they reconcile to the tile exactly — the per-line rounded `collected_pence` can total a few pence off. All money integer pence. finance.view.
### `GET /api/analytics/decision-lens?surface=group&scope&since&until&label[&refresh=1]` — AI "Decision Lens" cards for a surface (`group|marketing|clinicians|day`). Assembles that surface's aggregated rollups server-side (businessHub / marketingRoi / clinicians), hands them to Gemini (`generateDecisionLens`, with the `get_metrics` tool), and returns `{ basis:'ai'|'unavailable', cached, generatedAt, items:[{tone,title,body,value?}] }` (3-4 items, tone `good|warn|bad|info`). Cached per org+surface+scope+window for 6h in `ai_decision_lens` (migration 000078); `refresh=1` forces a rebuild. On any AI failure returns `basis:'unavailable'` so the frontend renders its deterministic rule-based lens (never blank). `aiLimiter` + finance.view.
### `GET /api/analytics/leakage?days=90&since&until&rate_plans&rate_fta&rate_recall&rate_lapsed&rate_collect` — Revenue Leakage (DentaCFO gap module). Five recoverable pools (lost plans / FTA / unbooked recalls / lapsed patients / uncollected balances) from `formulas.calculateRevenueLeakage`, driven by REAL rollups: settled turnover, appointment no-shows, treatment-plan value (presented vs accepted), banked receipts. Window total annualised by window length. Optional `rate_*` (0-100 per pool) tune the recoverable share (clamped). Returns `{ windowDays, since, until, rates, ftaRatePct, windowTotalPence, annualTotalPence, monthlyTotalPence, asPctOfRevenue, inputs, lines:[{key,label,sub,owner,windowPence,annualPence,monthlyPence}] }` — all pence. recall+lapsed are modelled shares of revenue until patient-level Dentally cohorts land. finance.view.
### `GET /api/analytics/data-quality` — Data Quality Engine (DentaCFO gap module). Per-practice cleanliness score + connector health + a prioritised alert list, computed from data already in the warehouse (appointments / invoices / integrations) — no new integration. Score (0-100) is a weighted, dimension-renormalised blend of: appointments coded (`appointment_type` set, w0.30), patient identity linked (`contact_id` or `pms_patient_id`, w0.30), invoices patient-matched (`contact_id`, w0.20), collection rate (1 − outstanding/invoiced, w0.20); a dimension is dropped when it has no records. RAG: green ≥90, amber ≥70, else red. Org score is record-volume-weighted. `associate_id` (clinician) is surfaced as a low-severity flag, NOT scored (null on every synced Dentally appt — data wall). Connectors classified `ok|stale|never|disconnected|expired|error` against a per-provider staleness budget (Dentally/GHL 36h, Xero/QB 48h). Returns `{ orgScore, rag, practices:[{practiceId,name,score,rag,records,unassignedAppts,dims:[{key,label,weight,ratePct,defects,of}],raw}], totals, connectors:[{provider,label,status,lastSyncedAt,ageHours,staleAfterHours,lastError,health}], alerts:[{severity,area,key,text}], generatedAt }`. Powers the Data Hub panel. **system.manage** (matches the Data Hub page gate, not finance.view).
### `GET /api/analytics/retention?scope=all&rate=0.25` — Attrition & Retention (DentaCFO gap Phase 6). Per-practice patient cohorts by last-visit recency + the recoverable reactivation revenue pool, from data already in the warehouse (appointments + settled receipts) — no new integration. Cohorts come from `patient_retention_by_practice(p_org, p_now)` RPC: distinct patients keyed by `COALESCE(contact_id, pms_patient_id)`, bucketed by their most recent non-cancelled past visit into **active** (<12mo), **lapsed** (12–24mo), **dormant** (>24mo); each patient attributed to the practice of that visit. `scope` = all|practices|<practiceUUID> (academy/lab → `{applicable:false}`). Optional `rate` (0–1) overrides the recall win-back rate (default 0.25). Avg patient value = trailing-12mo settled receipts ÷ active patients per practice (org-blended fallback). Reactivation pool = `lapsed × avgValue × rate` via `formulas.calculateRetention` — **lapsed only** (dormant treated as gone). Appointments with no patient identity (neither id) are the linkage data wall — surfaced as `unlinkedAppts`, never counted in a cohort. Returns `{ applicable, scope, hasData, reactivationRate, org:{activePatients,lapsedPatients,dormantPatients,knownPatients,retentionRatePct,attritionRatePct,reactivationRate,avgPatientValuePence,reactivatablePatients,reactivationValuePence,rag,unlinkedAppts,revenue12mPence}, practices:[{practiceId,name,unlinkedAppts,revenue12mPence,rag,...sameCohortFields}], insights:[{tone,title,body,value}], generatedAt, note }` — money in integer PENCE, counts are integers. Powers the Retention panel on the Loyalty page. **growth.view** (recall/marketing metric — same gate as the Loyalty page, not finance.view).
### `GET /api/analytics/compute/treatment-models` — seed workbench models (fullarch/implant/invisalign), pence. finance.view. Pure read.
### `POST /api/analytics/compute/treatment-economics` — Treatment Economics Workbench (Intelligence OS). Body = a treatment model (`treatmentModelSchema`, all money pence). Returns the full money flow from `formulas.computeServiceEconomics`: gross/clinician/practice/group profit, marginPct, target-price solver, max-ad/CAC, monthly+annual, principal-vs-associate. **Pure compute — no persistence, audit-exempt** (`/compute/` path), so debounced slider recompute (Arch #3) doesn't spam audit_log. finance.view.
### `POST /api/analytics/compute/valuation` — Group Valuation (Intelligence OS — Value & Growth). Body = the driver state (`valuationStateSchema`: `reportedEbitdaPence`, `addBacksPence`, `principalSalaryPence`, the three multiples, `regionFactor`, `growthRatePct`). Returns `{ result, levers }` from `formulas.computeGroupValuation` + `valueUpliftLevers`: the three buyer valuations (principal/associate/dso), midpoint, strategic, EBITDA build-up, and six ranked value-uplift levers — all pence. Server-authoritative successor to `GET /valuation` (legacy §2 left untouched; EBITDA reconciled — explicit add-backs, no fabrication; FORMULAS.md §13). **Pure compute — no persistence, audit-exempt** (`/compute/` path). valuation.view.
### `POST /api/analytics/compute/valuation/exit-plan` — Sale Planner (Intelligence OS — Value & Growth). Body = `valuationExitPlanSchema` (`base`, `baselinePence`, `principalSalaryPence`, `plan`). Returns `formulas.planExitTrajectory`: projected exit value, gap, required CAGR, EBITDA needed, current/future margins, and a year-by-year revenue/EBITDA/sites/value trajectory — all pence. Per-year advisory copy is computed client-side. **Pure compute — audit-exempt** (`/compute/` path). valuation.view.
### `POST /api/analytics/compute/acquisition` — M&A Acquisition Modeller (buy-side, DentaCFO gap Phase 3). Model a practice you're considering BUYING, alongside the sell-side valuation. Body (`acquisitionSchema`): `targetRevenuePence`, `marginPct`, `multiple` (EV/EBITDA), `growthPct`, `horizonYears`, `discountPct`, `leverageMultiple` (default 3.5), optional `askingPricePence`. Returns `formulas.calculateAcquisition`: `{ ebitdaPence, evPence, debtCapacityPence, equityRequiredPence, terminalPence, npvPence, irrPct, paybackYears, premiumPence, premiumPct, horizonYears, leverageMultiple, benchmarks, flags:[{key,severity,message}] }` — money pence, IRR/payback/premium null when undefined. Buy-side red flags: negative NPV, IRR below hurdle, slow payback, rich multiple, over-leverage, thin margin, asking-price premium. **Pure compute — audit-exempt** (`/compute/` path). FORMULAS.md §M&A. valuation.view.
### `GET /api/analytics/treatment-matrix?scope=all&period=month&pk=2026-05` — Treatment Mix heat matrix (Intelligence OS, Phase 2). Appointment VOLUME by treatment type × practice for the selected scope + period (`treatment_mix_matrix` RPC; paginated JS fallback when absent). `scope` = all|practices|academy|lab|<practiceUUID> (resolveScope; academy/lab → `{applicable:false}`). `period`/`pk` give the window: `month`+`YYYY-MM` = whole calendar month; `day`+`YYYY-MM-DD` = one day (defaults to current month). Returns `{ applicable, scope, period, window:{since,until,label}, practices:[{id,name,total}] (columns, vol desc), types:[{type,total,sharePct,isOther,cells[]}] (rows: top-12 + one 'Other treatment types' tail), distinctTypes, grandTotal, maxCell, insights:[{tone,title,body}], note }`. `cells[]` align to `practices` order; `maxCell` (excludes the Other tail) drives HeatCell intensity. **VOLUME ONLY — Dentally appointments carry no price (data wall), so there is no £/revenue here; insights are volume-framed (top treatment, single-site concentration, busiest practice, Pareto breadth).** finance.view.

### `GET /api/analytics/treatment-fee-benchmarks?months=12` — Real case-fee benchmarks for the Treatment Economics Workbench (Intelligence OS). Per workbench category (`fullarch`/`implant`/`invisalign`), the mean INVOICE total for invoices that contain that procedure, from `invoice_items` over a trailing window (`invoice_case_rollup` RPC + `formulas.classifyCaseFees`). A dental case is billed across many line items, so the honest case fee is the invoice-level total, not a single line. Returns `{ windowMonths, invoicesAnalysed, benchmarks: { fullarch|implant|invisalign: { feePence, sampleSize } | null } }` — `null` per category when no matching invoices (the workbench then keeps its hardcoded default). **Patient FEE only — lab/CBCT/component COST is never in the Dentally feed and stays owner-entered.** finance.view.

### `GET /api/analytics/treatment-revenue?scope=all&period=month&pk=2026-05` — Treatment REVENUE heat matrix (Intelligence OS, Phase 2). The £ counterpart to `treatment-matrix`: real invoiced FEE by treatment name × practice, from `invoice_items` (`treatment_revenue_matrix` RPC; paginated fallback). Same window/scope semantics + response shape as `treatment-matrix`, but `grandTotal`/`maxCell`/`types[].total`/`cells[]` are integer PENCE, rows keyed by `treatment_name`, plus `basis:'invoice_items'` and `hasData`. Insights are money-framed (top earner, single-site revenue concentration, busiest biller, revenue Pareto). `invoice_items` is populated by the Dentally sync (`/invoices` + `/invoice_items` pull). **This is the patient FEE (retail), NOT cost — lab/material cost is never in the Dentally feed and stays owner-entered in the Workbench.** finance.view.

### `GET /api/analytics/treatment-breakdown?limit=24&since=&until=` — Flat "by treatment" breakdown for the CRM Reports card. Real invoiced FEE + distinct PATIENT count grouped by `treatment_name` ALONE (no practice split), from `invoice_items` (`treatment_breakdown` RPC, migration `000058`; paginated JS fallback). Org-wide; `since`/`until` (any Date.parse-able ISO; optional, NULL = all time) window on `invoiced_on`; `limit` 1–100 (default 24). Returns `{ treatments:[{treatment_name, fee_pence, item_count, patient_count}] (fee desc, top `limit`), grandTotal (all treatments, pence), basis:'invoice_items', hasData, note }`. Replaces the old CRM Reports grouping that mis-used `leads.treatment` (= GHL `opp.name`, junk like "New Lead || 22/03/2026") as the treatment key. Patient fee/retail, not cost. finance.view.

### `POST /api/analytics/ai-ask` — AI Analyst (Intelligence OS). Body `{ scope, period, pk, question? }` (scope/period as elsewhere; `question` ≤500 chars, optional). £-ranked findings over the group's LIVE scope/period numbers, aggregated from the REAL Decision-Lens insights of the P&L / Marketing / Clinicians / Cash rollups (NO fabrication) plus cross-cutting headline facts (group margin, blended ROAS, cash). With a `question` AND `ANTHROPIC_API_KEY` set, Claude (sonnet-4-5) writes a natural-language `answer` grounded ONLY in a compact real summary; without a key it falls back to keyword-matched findings (`basis:'rollups'`, `note`). Returns `{ scope, period, question, answer:string|null, findings:[{sev:'good'|'warn'|'bad'|'info',t,d,v}] (ranked bad→info, ≤8), answerFindings?, basis:'rollups'|'claude', model, note? }`. Money in integer PENCE within findings text. finance.view.

### `GET /api/analytics/clinicians?scope=all&period=month&pk=2026-05` — Clinicians (Intelligence OS, T2). Per-clinician production, pay splits and NHS/UDA from REAL data: associate roster (names/`pay_pct`/`lab_split_pct`, basis points→%), per-associate completed production (`associate_production` RPC over `treatment_plans`), appointment activity (`associate_appointment_stats`), owner-entered NHS contract (`practices.nhs_contract_uda`/`nhs_uda_rate_pence`). `scope` = all|practices|<practiceUUID> (academy/lab → `{applicable:false}`); period→window. **HONEST DATA WALLS (no revenue-share fabrication):** `productionAvailable` false when treatment_plans aren't synced; `appointmentsAvailable` false when appointments lack a resolved associate_id; `nhs.completedAvailable` always false until the UDA treatment-plan feed lands; lab cost / OCPSPD per clinician have no real per-clinician source and are omitted. Returns `{ applicable, scope, period, window, productionAvailable, appointmentsAvailable, clinicians:[{id,name,role,practiceId,practiceName,active,payPct,labSplitPct,productionPence,feesPence,netToPracticePence,appointments,completed,noShows}], totalProductionPence, totalFeesPence, totalNetPence, nhs:{available,completedAvailable,practices:[{id,name,contractUda,udaRatePence}]}, insights:[{tone,title,body,value}], note }`. Money in integer PENCE. finance.view.

### `GET /api/analytics/marketing-roi?scope=all&period=month&pk=2026-05&account_ids=` — Marketing & ROI (Intelligence OS, T11). Adds the dynamic, org-isolated ad-account filter: `?account_ids=a,b` restricts spend to those `customer_id`s; absent → the org's SELECTED accounts; no `ad_accounts` rows → all (back-compat). Response adds `accountFilter` (ids|null) + `byAccount:[{provider,customerId,name,currency,status,spendPence,impressions,clicks,reach,conversions,cpaPence,cpcPence}]`. Per-channel acquisition economics from REAL sources: ad spend from `ad_metrics` (paid providers google_ads/meta_ads), channel attribution + conversions from CRM `leads`, revenue from settled payments. **HONEST DATA WALL: revenue is NOT attributable per channel (no per-touch attribution) — there is NO per-channel ROAS/revenue, only a business-level blended paid ROAS = settled revenue ÷ paid spend.** Per-channel ranks on spend → leads → CPL → patients → CPA. Conversions use ONE consistent definition across all channels: a CRM lead reaching `treatment_started`/`treatment_completed`. `scope`/`period`/`pk` per resolveScope + window. Returns `{ applicable, scope, period, window, connected (any ad rows), hasLeads, channels:[{key,label,color,paid,group,spendPence,impressions,clicks,leads,conversions,cplPence,cpaPence,leadSharePct,convRatePct}], paidSpendPence, totalLeads, totalConversions, settledRevenuePence, blendedRoas|null, blendedRoiPct|null, google, meta, revenuePerChannelAvailable:false, byPracticeAvailable, adSpendPerPracticeAvailable, byPractice:[{id,name,leads,conversions,convRatePct,revenuePence,spendPence,cpaPence,roas|null}], insights:[{tone,title,body,value}], note }`. Money in integer PENCE. `ad_metrics.practice_id` is usually NULL (one ad account per group) → an entity scope sees no paid spend (honest); per-practice ROAS only when ad spend is practice-tagged. finance.view.

### `GET /api/analytics/pl-margin?scope=all&period=month&pk=2026-05` — P&L & Margin (Intelligence OS, T11). Scope/period-aware group P&L statement + per-entity breakdown from REAL `monthly_financials` actuals (Xero/QuickBooks override manual per `bucketsByPeriod`). A FINANCE screen → real actuals or an honest empty state, NEVER a projection. Honest CoA bucket granularity: revenue, lab+materials (direct), staff (incl. associate/clinician pay — `dentistStaffSeparable:false`), other opex (overhead+other); `tax` is below the operating line and excluded. Period = the selected month's actuals when present, else trailing ≤12mo annual (basis flags which). Per-entity precedence resolved PER ENTITY (one practice's synced row never suppresses another's manual). Returns `{ applicable, scope, period, monthKey, basis:'none'|'actuals-month'|'actuals-annual'|'actuals-mixed', hasData, costsAvailable, periodsCovered, statement:{revPence,labMaterialsPence,grossPence,staffPence,otherOpexPence,netPence,marginPct}, dentistStaffSeparable, perEntityAvailable, entityBasisMixed, entities:[{id,name,kind,region,basis,periodsCovered,...PLLine}], note }`. Money in integer PENCE. Per-entity rows appear only when `monthly_financials` carries `practice_id`; org-level-only data → `perEntityAvailable:false`. finance.view.

### `GET /api/analytics/cash-by-day?scope=all&period=month&pk=2026-05` — Day · Cash Collected (Intelligence OS, T9). REAL settled receipts banked by working day across the month in scope (always month-framed; `period=day`+`pk=YYYY-MM-DD` additionally highlights the selected day), plus a composite collection index (each day vs the average working day = 100). Source: `settled_receipts_by_day` RPC by `processed_at` date; `scope` = all|practices|academy|lab|<practiceUUID> (resolveScope — applicable to ALL scopes incl. academy/lab, which take payments; whole-group/practices query the org, a specific entity filters to its id). Returns `{ applicable, scope, period, window:{since,until,label}, monthLabel, basis:'settled_receipts', hasData, totalPence, avgPerDayPence, workingDays, days:[{date,label,dow,pence,index}] (Mon–Sat; empty Sundays excluded), peak, selected, insights:[{tone,title,body,value}], note }`. Money in integer PENCE. **CASH RECEIPTS, NOT billed production (decision A2)** — Decision Lens insights are data-derived (peak day, Saturday softness, strongest weekday). finance.view.

### `GET /api/analytics/chair?scope=all&recover=10` — Chair Efficiency (Intelligence OS). Per-practice + group chair economics from `formulas.calculateChairStats`/`chairRecovery`: capacity vs booked hours, cost-of-empty-chairs, recoverable-to-benchmark, recovery projection. `scope` = all|practices|academy|lab|<practiceUUID> (resolveScope; academy/lab → `{applicable:false}`). Revenue = trailing-12mo settled receipts per practice (real); `utilPct` = `practices.assumed_util_pct` owner assumption (default 80, `utilAssumed:true` when unset). Capacity uses the per-org `chair_config` (open hours/weeks/days/benchmarks) when saved, else the `CHAIR_CONFIG` code defaults; the resolved `config` is echoed in the response. OCPSPD + profit-per-chair-hour deferred (`null`, pending opex/treatment-minute sourcing). finance.view.

## Analytics — Phase 3 persistence (T12/T13)

Per-org persisted config + editable scenario sheets. **Edits are owner-toggled (rule 5): GET uses the matching `*.view` permission, but every mutation requires the `*.edit` permission and is written to `audit_log`.** Money is integer PENCE throughout.

### `GET /api/analytics/valuation-inputs` — saved valuation drivers (Value & Growth, T12). Returns the persisted `valuationStateSchema` shape (`reportedEbitdaPence`, `addBacksPence`, `principalSalaryPence`, three multiples, `regionFactor`, `growthRatePct`, `updatedAt`) so the saved row round-trips straight into `POST /compute/valuation`, or `null` when never configured (the UI then seeds itself). valuation.view.
### `PUT /api/analytics/valuation-inputs` — upsert the single per-org valuation drivers row (`valuationInputsSchema`, body = the driver state). Audited. valuation.**edit**.
### `GET /api/analytics/chair-config` — saved surgery-capacity config: `{ openHrs, weeksYr, daysWk, benchOccPct, benchRevHrPence, isDefault, updatedAt? }`. Always full (saved row overlaid on the `CHAIR_CONFIG` defaults; `isDefault:true` when never configured). finance.view.
### `PUT /api/analytics/chair-config` — upsert the per-org chair config (`chairConfigSchema`; bounded so it can't produce div-by-zero/absurd capacity). Feeds `GET /chair` capacity. Audited. finance.**edit**.

### `GET /api/analytics/pl-sheets` — list editable P&L scenario sheets (lightweight: `[{id,name,type,updated_at,updated_by}]`, no cell payload). finance.view.
### `GET /api/analytics/pl-sheets/:id` — one full sheet `{ id,name,type,cols,lines,cells,created_at,updated_at,created_by,updated_by }` (404 when not found in this org). finance.view.
### `POST /api/analytics/pl-sheets` — create a sheet (`plSheetCreateSchema`: `name`, `type` scenario|budget|forecast, `cols[]`, `lines[]`, `cells{}` — cells map `"<lineId>:<colId>" → pence`, may be negative). Returns the created row (201). finance.**edit**. Audited.
### `PUT /api/analytics/pl-sheets/:id` — partial update of name/type/grid (`plSheetUpdateSchema`; ≥1 field). 404 when not in this org. finance.**edit**. Audited.
### `DELETE /api/analytics/pl-sheets/:id` — delete a sheet (204). finance.**edit**. Audited.
### `GET /api/analytics/pl-sheets/:id/csv` — CSV export of a sheet (lines × cols, £ with 2dp from integer pence; `Content-Disposition` attachment). finance.view.

#### Board Report Generator (DentaCFO gap module, Phase 2)
The pack is assembled LIVE from the same rollups as Business Hub + Revenue Leakage (no stored snapshot). Claude writes the executive summary + RAG-coded priorities; a deterministic, data-driven pack is the fallback when there is no API key or the call fails (HTTP 200 always). Money is integer pence.
### `POST /api/analytics/board-report` — generate the pack (token cost — never on page load). Body (`boardReportSchema`): optional `since`/`until`/`label` window. Returns `{ generatedAt, period:{since,until,label,days}, metrics:{ revenuePence, revenueAnnualisedPence, revenueTargetPence, marginPct, ebitdaWindowPence, appointments, noShows, noShowRate, noShowTracked, leads, conversionRate, newPatients, cashCollectedPence, practiceCount, leakageAnnualPence, leakageMonthlyPence, leakagePctOfRevenue, topPractice, weakPractice, biggestLeak }, summary:[string], priorities:[{rag:'red'|'amber'|'green',text}], basis:'ai'|'deterministic', empty }`. finance.view.
### `POST /api/analytics/board-report/email` — generate + email the pack now to one address via SES. Body (`boardReportEmailSchema`): `recipient_email` + optional window. Returns `{ report, delivery:{ sent, messageId?, error?, to } }` — `sent:false` (NOT an error) when SES is unconfigured; the UI falls back to a mailto draft. finance.**edit**. Audited.
### `GET /api/analytics/board-report/schedules` — list recurring delivery schedules `[{id,organisation_id,frequency,recipient_email,report_type,active,last_sent_at,created_by,created_at}]`. finance.view.
### `POST /api/analytics/board-report/schedules` — create a schedule (`boardScheduleCreateSchema`: `frequency` daily|weekly|monthly, `recipient_email`, `report_type` board|financial|operational). Returns the row (201). finance.**edit**. Audited. The workers cron (daily 06:30 Europe/London) sends due schedules (daily once/day, weekly >7d, monthly >28d) and stamps `last_sent_at`.
### `PATCH /api/analytics/board-report/schedules/:id` — partial update (`boardScheduleUpdateSchema`: toggle `active`, change cadence/recipient/type; ≥1 field). 404 when not in this org. finance.**edit**. Audited.
### `DELETE /api/analytics/board-report/schedules/:id` — delete a schedule (204). finance.**edit**. Audited.

## Wealth — personal Exit Plan / FIRE (DentaCFO gap Phase 4)

Owner-only section (rule 5 / nav `ownerOnly`). Reads gated `wealth.view`; the persisted balance-sheet write is owner-only; `/compute/` endpoints are pure recompute (slider-driven) and audit-exempt. Persists in `wealth_inputs` (migration 000061, one row/org). Money INTEGER PENCE.

### `GET /api/wealth/inputs` — the saved personal balance sheet + Exit Plan, or sane empties when never configured. Returns `{ assets:[{name,valuePence,type,growthPct,liquid}], liabilities:[{name,valuePence,ratePct}], pensions:[{name,balancePence,contributionsYtdPence,type}], properties:[{name,address,valuePence,mortgagePence,monthlyIncomePence,monthlyCostPence,yieldPct,type}], exit:{incomePence,incomePer,people:[{name,share}],currentAge,retireAge,freeholds:[{name,valuePence,rentPence}],withdrawPct,returnPct,currentValuePence,useLiveValuation,agentPct,cgtPct,baseCostPence,existingInvestPence,targetSalePence}, updatedAt }`. The Exit Plan state persists in the `wealth_inputs.fire` JSONB column (exposed as `exit`; the legacy `sale` column is unused). wealth.view.
### `PUT /api/wealth/inputs` — replace the saved blob (`wealthInputsSchema`: every section optional, defaults applied). Returns the read-back. **Owner-only.** Audited.
### `GET /api/wealth/net` — personal balance sheet for the Net Worth screen: `{ assets, liabilities, byType:{<type>:pence}, totalAssetsPence, totalLiabilitiesPence, netWorthPence }` (book net worth = assets − liabilities). wealth.view.
### `GET /api/wealth/fire` — the assembled live **Exit Plan** (canonical GM `exitCalc` model; rebuilt). Resolves the group value today from the **live valuation midpoint** (`exit.useLiveValuation`, else the manual `currentValuePence`), seeds existing investments from liquid (non-business) assets + pension balances and freeholds from buy-to-let / income properties when not entered, then runs `formulas.calculateExitPlan`. Returns `{ valuation:{currentValuePence,source:'live'|'manual'}, plan:{annualNetPence,years,exitYear,people:[{name,netPence,grossPence,taxPence}],grossRequiredPence,singleGrossPence,taxSavingPence,totalRentPence,totalFreeholdPence,portfolioGrossPence,potNeededPence,requiredNetPence,requiredSalePence,reqGrowthPct,targetSalePence,agentFeePence,cgtPence,netProceedsPence,investablePence,gapPence,targetGrowthPct,onTrack,withdrawPct,returnPct,projection:[{year,age,startPence,growthPence,incomePence,endPence}]}, inputs:{…resolved exit input incl. baseYear}, seeds:{liquidAssetsPence,pensionPence,existingInvestSeeded,freeholdsSeeded} }`. FORMULAS.md §Exit Plan. wealth.view.
### `POST /api/wealth/compute/exit-plan` — pure slider recompute of `formulas.calculateExitPlan` (`exitPlanComputeSchema` = the full Exit Plan input; the screen passes the `currentValuePence` it seeded from `/fire`). Drives the live Exit Plan sliders. **Audit-exempt.** wealth.view.
### `POST /api/wealth/compute/sale-waterfall` — *(legacy)* pure recompute of `formulas.calculateSaleWaterfall` (`saleWaterfallSchema`: `enterpriseValuePence,businessDebtPence,ownerSharePct,acquisitionCostPence,freeholdEquityPence,badrLifetimeUsedPence`). UK CGT: BADR 18% to the £1m lifetime cap, 24% above. Retained for back-compat; the Exit Plan now uses `/compute/exit-plan`. **Audit-exempt.** wealth.view.
### `POST /api/wealth/compute/fire` — *(legacy)* pure recompute of `formulas.calculateFirePlan` (`firePlanSchema`). Retained for back-compat. **Audit-exempt.** wealth.view.

> **Precedence (TODO1, resolved):** `pl_sheets` are a **scenario overlay only**. They are standalone planning/budget grids — they NEVER override the real actuals P&L (`pl`/`pl-margin` stay Xero > manual > zero) and NEVER feed EBITDA or the valuation. This preserves the "finance screen = real actuals or honest empty, never fabricated" guarantee. See FORMULAS.md §16.

**Real-data read path (exact, or zero — never estimated):**
- Revenue is **exact**, summed in Postgres via the `settled_receipts_by_day` RPC
  (avoids PostgREST's 1000-row cap that undercounts orgs with >1000 payments).
- `finance-series` — monthly revenue = exact settled payments (or
  `monthly_financials` revenue actual). Costs/profit = `monthly_financials`
  actuals when present, else **0** (not estimated). Per-month `costsAvailable`;
  response `costsAvailable`. `basis`: `actuals` | `mixed` | `revenue-only`.
  Returns up to 24 months (window capped at 24). Additional query parameters:
  - `accounting_method` — `accrual` | `cash`, default `accrual`. Selects the
    accounting basis for cost lines. `accrual` includes manual + Xero + accrual
    QuickBooks rows (rows without the column are treated as accrual). `cash`
    returns only rows sourced from the QuickBooks Cash-basis ProfitAndLoss pull.
  - `integration_account_id` — UUID, optional. Filters cost rows to one
    connected QuickBooks company (an `integration_accounts` row). Omit for
    org-wide costs across all connected companies.
- `financial` — revenue = `monthly_financials` actual else exact settled-payment
  TTM. Margins are real only when a cost source exists, else **0** (not 100%).
  Balance sheet = real bank cash only; every other line **0**. Nothing flagged
  `estimated`. Response carries `costsAvailable` + `revenuePence`. `basis`:
  `actuals` | `revenue-only`.
- `cashflow` — **real backward 13-week view**: each week = exact settled payments
  received that week (RPC); opening = real bank balance; closing = running
  balance. No projection, no baseline comparison. `basis:'actuals'`. Also returns a
  `runway` block (Intelligence OS — Cashflow & Runway, `formulas.calculateRunway`,
  FORMULAS.md §14): `freeCashPence` (bank balance), `monthlyReceiptsPence` (window
  rate), `monthlyCostsPence` (P&L cost base — actuals or baseline), `monthlyNetPence`,
  `monthlyBurnPence`, `runwayMonths` (null when cash-positive), `cashPositive`,
  `status`, `costsAvailable`/`costsBasis`, and `billsToPlanPence:null` (no payables source).
- `pl` — annual P&L from `monthly_financials` actuals; baseline fallback when none.
- `cashflow-outlook` — `?months=4&forward=2` — Cashflow & Runway OUTLOOK (Intelligence
  OS): month-by-month `months[]` (in = real settled receipts, out = P&L cost base,
  net, opening/closing), forward months `projected:true`, balances anchored to today's
  real bank (`balancesReconstructed` flags reconstructed historicals), `lowestProjectedPence`,
  `runway` (FORMULAS §14), `bills` (corp-tax estimate, FORMULAS §15) + `billsNote`,
  `decision` (free-cash, FORMULAS §15). `costsAvailable`/`costsBasis` flag the OUT source.

Xero overrides manual for the same period+bucket (see FORMULAS.md §1a).

**Custom date range:** `finance-series`, `financial`, and `cashflow` accept
optional `from`/`to` (YYYY-MM-DD). When both are set they override the rolling
window — finance-series returns the months in range, cashflow the weeks spanning
it (capped 53), financial sums the range. A single day = `from==to`.

**Per-practice filtering:** `finance-series`, `financial`, and `cashflow` accept
an optional `practice_id` (UUID) scoping to one practice's real data. `financial`
returns `{ "error": "No data for this practice" }` when a practice has no real
revenue/actuals; `finance-series` returns its 12-month window with zero-revenue
months. Omitted = org-wide. Business Hub returns per-practice rows in
`practices[]`, so its per-practice view is client-side (no param).

## Growth

Read-only aggregator over existing tables (mounted at `/api/growth`). The
practice / booking / patient endpoints are Dentally-sourced (contacts,
appointments, settled payments); 30-day windows. Loyalty reads `memberships`;
`benchmark` is a placeholder until a benchmarking partner integrates.

All three take optional `?from=YYYY-MM-DD&to=YYYY-MM-DD&practice_id=` filters (mirrors finance). `from`/`to` override the rolling 30-day window only when **both** are set (`to` = inclusive end of day); `practice_id` scopes to one practice.

### `GET /api/growth/practice-performance?from=&to=&practice_id=`
Per-practice rollup over the window. `{ practices: [{ practice_id, name, new_patients_30d, appts_30d, completed_30d, no_show_30d, revenue_pence_30d }] }`. Consults / lead-conversion are intentionally absent — those are CRM/lead concepts, not PMS data.

### `GET /api/growth/practice-patients?practice_id=&page=1&per_page=10&search=`
Paginated patient roster for one practice (`contacts` of type `patient`, most-recent first). NOT window-scoped — the practice's full roster. `{ patients: [{ id, name, email, phone, created_at }], total, page, per_page }`. `practice_id` required (empty → empty result). Optional `search` matches name/email/phone. Backs the expandable list under each card on the Practices & Patients screen.

### `GET /api/growth/practice-patients/:id`
Single patient detail (org-scoped, type-gated to `patient`). Returns the typed contact columns plus `detail` — the curated full Dentally patient blob (`contacts.pms_patient`, migration 000082): title, gender, full address, NHS/NI numbers, dentist/hygienist recall dates + intervals, emergency contact, consents, medical alert. `detail` is `null` for non-Dentally contacts and for patients not yet re-synced since 000082 landed (falls back to typed columns). Backs the patient detail dialog opened by clicking a row on the Practices & Patients screen. `404` if no such patient in the org.

### `GET /api/growth/booking?from=&to=&practice_id=`
Appointment-derived booking KPIs over the window. `{ booked_30d, completed_30d, no_show_30d, today, this_week, this_month, no_show_rate }`. `today` = calendar today (00:00–23:59), `this_week` = current Mon–Sun — both bounded BOTH ends and intersected with the window, so future-dated appts can't inflate them. `this_month`/`booked_30d` = the full window total.

### `GET /api/growth/recent-bookings?from=&to=&practice_id=&page=1&per_page=10`
Paginated appointments in the window (most-recent `starts_at` first). `{ bookings: [{ id, starts_at, status, service, deposit_pence, deposit_paid, patient, practice }], total, page, per_page }`. `service` (appointment_type), `deposit_pence`/`deposit_paid` are null/0/false for Dentally-synced rows (the PMS sends none). `patient` is null when the appointment has no linked contact.

### `GET /api/growth/patients`
`{ new_patients_30d, new_leads_30d, by_source }`.

### `GET /api/growth/marketing`
`{ leads_30d, revenue_pence_30d, by_provider }` (revenue = settled payments).

### `GET /api/growth/marketing/ad-spend?from=&to=&account_ids=`
Live ad spend & performance from connected marketing providers (Google Ads and
Meta Ads — both live), read from `ad_metrics`. Org-scoped; window-aware via `from`/`to`
(else 30-day rolling). Account-level — `practice_id` is intentionally ignored
(ad spend isn't practice-attributed). All money in integer pence.
**Account filter (dynamic, org-isolated):** `?account_ids=a,b` restricts to those
ad-account `customer_id`s; absent → the org's SELECTED accounts (see
`/integrations/:provider/ad-accounts/selection`); when the org has no `ad_accounts`
rows yet → all accounts (back-compat).
`{ connected, window:{from,to}, account_filter (ids|null), totals, channels[],
accounts[], campaigns[], daily[] }` — each aggregate carries `{ spend_pence,
impressions, clicks, reach, leads, conversions, ctr, cpc_pence, cpl_pence,
cpa_pence, cpm_pence, frequency, conversion_rate }`; `channels` add `provider`;
`accounts` add `provider/customer_id/name/currency/status` (per-account
breakdown); `campaigns` add `provider/customer_id/campaign_id/campaign_name/
campaign_status/objective`; `daily` is a per-date spend series. `connected:false`
when no rows in window.

### `GET /api/growth/marketing/roi?from=&to=&practice_id=&account_ids=`
Marketing ROI cross-cut feeding the Business Hub Marketing Snapshot. Same dynamic
`account_ids` filter as ad-spend. Returns the existing ROI fields plus
`account_filter` (ids|null), `by_provider[]` (now incl. `reach`) and `by_account[]`
(`provider/customer_id/name/currency/status/spend_pence/impressions/clicks/reach/
conversions/leads/cpl_pence/cpa_pence/cpc_pence`). All money in integer pence.

### `GET /api/growth/loyalty`
`{ active, total }` over `memberships`.

### `GET /api/growth/benchmark`
Placeholder industry medians. `{ industry_median_conversion, industry_median_response_min, ... }`.

## Monthly financials (manual P&L actuals)

All `finance.view`. Money in integer pence. Mutations audited.

### `GET /api/monthly-financials?from=YYYY-MM&to=YYYY-MM&practice_id=`
List financial line items for the org (manual + synced). `{ rows: [...] }`.

### `POST /api/monthly-financials`
Enter/overwrite a manual P&L line. `source='manual'` set server-side; re-posting
the same period+account_code(+practice) updates the amount in place.
```json
Request:
{ "period": "2026-04", "dental_bucket": "revenue", "amount_pence": 4250000,
  "account_code": "revenue", "practice_id": null }
```
`dental_bucket` ∈ `revenue|staff|lab|materials|overhead|tax|other`.

### `DELETE /api/monthly-financials/:id`
Delete a manual row (synced rows are not user-deletable).

## Files

### `POST /api/files/presign`
Returns S3 presigned upload URL (5min expiry, KMS encrypted).
```json
Request:
{ "filename": "lab-invoice-may.pdf", "content_type": "application/pdf" }

Response:
{ "uploadUrl": "https://s3.eu-west-2.amazonaws.com/...", "key": "...", "file": {...} }
```

## Training (tenant)

Mounted at `/api/training`. Tenant auth. Reads from the **global** published course catalogue; enrolment and progress are per-org/user.

- `GET  /api/training/library` — published catalogue for this org (mentorship-gated) with per-user enrolment + progress. Returns `{ courses: [...], mentorship_active }`.
- `GET  /api/training/courses/:id` — one published course, full content (modules → lessons), per-lesson progress and access gate. 403 when org lacks the required `access` tier. Resources include `category` (`marking-rubrics` | `additional-resources`) and `created_at`; lesson files include `created_at` (used by the Materials folder view).
- `POST /api/training/courses/:id/enrol` — enrol the current user in a published course (idempotent). Returns `{ enrolment }`.
- `POST /api/training/lessons/:lessonId/complete` — mark a lesson complete (default) or incomplete (`{ completed: false }`). Returns `{ progress }`.
- `GET  /api/training/lessons/:lessonId/attachment` — presigned S3 GET for a lesson's single legacy attachment (mentorship-gated). Returns `{ url }`.
- `GET  /api/training/lesson-files/:fileId/download` — presigned S3 GET for a categorised lesson file from the `lesson_files` table (gated like the lesson). Returns `{ url }`.
- `GET  /api/training/resources/:resourceId/download` — presigned S3 GET for a course-level resource (gated like the course detail). Returns `{ url }`.
- `GET  /api/training/my` — enrolled published courses with per-course progress for the current user. Returns `{ courses: [...] }`.
- `GET  /api/training/mentorship` — stub (separate slice). Returns `{ programmes: [] }`.
- `GET  /api/training/one-to-one` — stub (separate slice). Returns `{ user_id, sessions: [] }`.

## Memberships

### `GET /api/memberships/plans` — list plans
### `GET /api/memberships` — list active memberships
### `POST /api/memberships` — enrol new member

## Reviews

### `GET /api/reviews` — aggregated from Google/Trustpilot
### `POST /api/reviews/:id/respond`

## Workflows

### `GET /api/workflows`
### `POST /api/workflows`
### `PATCH /api/workflows/:id`
### `DELETE /api/workflows/:id`

## Tasks

Read is open to every authenticated role; **all mutations are Owner-only**
(`requireRole('owner')`) — non-owners get 403. The Task Manager UI hides write
controls for non-owners accordingly.

### `GET /api/tasks?status=open&assigned_to=...`
Lists the org's tasks (joins assignee `full_name`). Any role.
### `POST /api/tasks` *(owner-only)*
Create. Body: `title`, `description?`, `assigned_to?`, `due_date?`, `priority?`.
### `PATCH /api/tasks/:id` *(owner-only)*
Update. Bounded fields: `title`, `description`, `assigned_to`, `due_date`,
`priority`, `status`. `status=done` stamps `completed_at`.
### `DELETE /api/tasks/:id` *(owner-only)*
Delete a task.
### `POST /api/tasks/:id/remind` *(owner-only)*
Email the assignee a reminder (cc owner); bumps `reminder_count`/`last_reminded_at`.
### `POST /api/tasks/remind-overdue` *(owner-only)*
Bulk-remind every overdue task. Returns `{ reminded, total, results }`.
Auto-reminders also fire nightly at 08:00 UK via the worker cron.

## Billing *(owner-only)*

### `POST /api/billing/portal`
Returns Stripe Customer Portal URL.

## Webhooks (public — signed)

### `POST /webhooks/stripe`
Validates `stripe-signature` header. Handles:
- `payment_intent.succeeded` → update payment status
- `customer.subscription.updated` → sync subscription_plan
- `customer.subscription.deleted` → mark cancelled

### `POST /webhooks/dentally/:token`
Real-time Dentally events. `:token` is a stable HMAC-signed encoding of the org
(no auth on this public route). Body HMAC-verified with the org's
`integrations.config.webhook_secret` via `x-dentally-signature` (raw hex or
`sha256=` prefixed). Maps `patient` / `appointment` / `payment` events through
the same row builders as the poller (idempotent upsert). Unknown event types →
`{received:true, ignored:true}`. The daily 03:00 poll reconciles missed
deliveries. 401 on bad token/signature or unset secret.

### `POST /webhooks/emergent/:token`
Real-time events from the Emergent ops app. `:token` is the stable HMAC-signed
org encoding (resolves the org; 401 on bad token). Body HMAC-verified via
`X-Webhook-Signature: sha256=<hmac-hex>` computed over the **raw** request body
with the org's `integrations.config.webhook_secret` (byte-identical scheme to
the Dentally webhook) — 401 if the secret isn't set or the signature doesn't
match. The event name arrives in the body (`event`) or the `X-Webhook-Event`
header. Handles:
- `treatment.accepted` / `treatment.updated` → upsert `treatment_accepted`
  (`mapRecord`; `updated` on a hashed field mints a new `external_id` since
  Emergent sends no stable record id — see `treatmentaccepted.md`).
- `treatment.deleted` → delete by derived `external_id`.
- `daily_cashup.saved` → upsert `emergent_daily_cashup`, plus upsert each row
  in the payload's `patients[]` array into `treatment_accepted` (converges on
  the shared `external_id` derivation, so it does not double-count against
  `treatment.accepted` deliveries for the same patient).
- `monthly_pl.saved` → upsert `emergent_monthly_pl`.

Unrecognised events with no usable `data.business_id` ack
`{received:true, ignored:true, reason:'no_data'}` rather than erroring — a
transient DB error on apply also acks (fault isolation: the provider
auto-disables a webhook after sustained failures, and the pull endpoints below
are the reconciliation backstop). Business is auto-discovered into
`emergent_practice_map` on every delivery so it shows up in the mapping UI
immediately.

### `POST /webhooks/postmark/inbound`
Records inbound email as communication.

### `POST /webhooks/twilio/inbound`
Records inbound SMS as communication.

### `POST /webhooks/ses-events`
Receives AWS SNS-wrapped SES delivery, bounce, and complaint event notifications. No tenant auth — secured by SNS signature verification and a topic-ARN allowlist.

Behaviour:
- **SubscriptionConfirmation** — the endpoint auto-confirms the SNS subscription by fetching the `SubscribeURL` supplied in the message body; no manual confirmation step is required.
- **Bounce (permanent)** and **Complaint** — the affected address is added to the global `suppression_list` table so subsequent sends are blocked.
- **Delivery** — the event is logged to `provider_events` for auditing.
- Returns `403` when the SNS signature is invalid or the `TopicArn` in the message does not match `SNS_TOPIC_ARN` (when that env var is set).
- Returns `200` for all accepted and successfully processed events.

## Public OAuth callbacks (no auth — signed state)

### `GET /oauth/:provider/callback`
OAuth redirect target for integration providers. Public (mounted outside `/api`)
because the browser redirect carries no JWT. The org is recovered from the
HMAC-signed `state` param (`lib/oauth-state.js`), never `req.user`. On success
exchanges the `code` for tokens and redirects to `${FRONTEND_URL}/integrations?connected=<provider>`;
on failure redirects with `?error=<message>&provider=<provider>`. Used by GoHighLevel
(`gohighlevel`) and the OAuth provider stubs.

Requires env: `OAUTH_STATE_SECRET`, `BACKEND_PUBLIC_URL`, plus per-provider
`GHL_CLIENT_ID` / `GHL_CLIENT_SECRET`.

## Integrations (authenticated — owner only)

### `POST /api/integrations/connect`
Body `{ provider }`. For OAuth providers returns `{ redirectUrl }` (frontend
sends the browser there). GoHighLevel → `marketplace.leadconnectorhq.com/oauth/chooselocation`.

#### Dentally — OAuth2 or API key (hybrid)
Dentally accepts both connect methods, selected by `method` on the body:
- `{ provider: 'dentally', method: 'oauth' }` (default when `method` omitted) → `{ redirectUrl }` to `https://api.dentally.co/oauth/authorize`. The browser returns to the public `GET /oauth/dentally/callback` (no auth; org from signed state), which exchanges the code, stores the rotating `{access_token, refresh_token}` (encrypted) with `expires_at`, and redirects to `${FRONTEND_URL}/integrations?connected=dentally`. First connect then runs the Dentally bootstrap (detect sites → map practices → pull).
- `{ provider: 'dentally', method: 'key' }` → `{ requiresKeyPaste: true, pasteHint }`. Post the token to `POST /api/integrations/dentally/callback` with `{ apiKey }` (stored encrypted, `expires_at: null` — long-lived, never refreshed).

Token refresh is automatic in the sync path: `resolveDentallyAuth` refreshes a near-expiry OAuth access token (5-min skew) under a single-use-refresh-token claim guard, and the long backfill pagers retry once on a 401 by refreshing. API-key rows never refresh. `POST /api/integrations/dentally/refresh` forces a manual refresh. Env: `DENTALLY_CLIENT_ID`/`DENTALLY_CLIENT_SECRET`, optional `DENTALLY_AUTH_BASE` (default `https://api.dentally.co`) / `DENTALLY_SCOPES`; prod `BACKEND_PUBLIC_URL` must equal the host registered as the Dentally redirect URI (exact match) or OAuth is rejected.

### Emergent (Treatments Accepted / Daily Cash-Up / Monthly P&L)
- `GET /api/integrations/emergent` (owner | practice_manager) → `{ connected, status, baseUrl, keyHint, webhookUrl, lastSyncAt }`. `keyHint` is the API key's last 4; `webhookUrl` is the org's signed `/webhooks/emergent/:token` to paste into Emergent.
- `POST /api/integrations/emergent` (owner) — body `{ baseUrl, apiKey }`. Stores `base_url` + `key_hint` in config and the API key **encrypted** in `secrets`; status `active`. A connect/sync then pulls from Emergent's public API (below).
- `DELETE /api/integrations/emergent` (owner) — disconnect: status `revoked`, secret cleared.

Pull side (`lib/integrations/emergent-sync.js`, used by connect + `POST
/api/integrations/emergent/sync` + the nightly backfill), all against
`{baseUrl}` with header `X-API-Key: <apiKey>`:
- `GET /api/public/treatments-accepted?start_date=YYYY-MM-DD` → `{ count, manager_reported_count, rows: [...], sheets: [...] }`. Maps to `treatment_accepted`.
- `GET /api/public/daily-cashups` → maps to `emergent_daily_cashup` (+ the
  payload's `patients[]` rows into `treatment_accepted`, same convergence as
  the `daily_cashup.saved` webhook above).
- `GET /api/public/monthly-pl` → maps to `emergent_monthly_pl`.

Emergent records carry no stable id; `external_id` is derived deterministically
from immutable fields (business/date/patient/treatment/amount), so the pull and
the webhook upsert to the same row on `(organisation_id, source, external_id)`.

### Google Sheets (Call Reporting)
Multiple sheets per org (one per practice), connected via one org-level Google
OAuth grant with the read-only `spreadsheets.readonly` scope (no Drive scope —
the owner pastes each sheet URL). When no dedicated `GOOGLE_SHEETS_CLIENT_ID`
is set the flow borrows the Google Ads OAuth client AND its already-registered
`/oauth/google_ads/callback` redirect URI (no Google Cloud Console change
needed); the public OAuth callback routes on the HMAC-signed state's provider,
not the URL path.
Only the five mapped columns are ever read or stored (data minimisation: no
names/phones/emails). Tokens are encrypted at rest and never surface in any
response. Each sheet is registered with a free-text `practice_label`
(self-contained — deliberately NOT linked to the `practices` table; there is
no practice-map endpoint). Migration `000118` + the v2 multi-sheet migration.
- `GET /api/integrations/google-sheets/status` (owner | practice_manager) → `{ connected, connectionStatus, connectionError, sources }`. `sources` = one entry per connected sheet, safe fields only (`id, practice_label, spreadsheet_id/url, title, tab_name, sheet_timezone, column_mapping, header_row, row_count, skipped_rows, status, last_error, last_synced_at, mapped`).
- `GET /api/integrations/google-sheets/picker-config` (owner) → `{ enabled }` or `{ enabled: true, apiKey, appId, accessToken }` — Google Picker bootstrap for the browse-and-pick flow (scope `drive.file`). Disabled until `GOOGLE_PICKER_API_KEY` is set (browser key, Picker API enabled on the Google project; `GOOGLE_CLOUD_PROJECT_NUMBER` = appId). The short-lived access token is deliberately handed to the OWNER's browser (their own account's read-only token) so Google's picker can render their Drive; the refresh token never leaves the server.
- `POST /api/integrations/google-sheets/sources` (owner) — body `{ url, practice_label }` (full URL or bare spreadsheet id; `practice_label` is a free-text label, one source row per practice). The SAME spreadsheet may be added once per practice (tab-per-practice layouts) — upsert is on `(organisation_id, practice_label)`, so re-posting an existing label updates that practice's row. Validates reachability with a metadata read before persisting; returns `{ ok, id, title, tabs }`.
- `GET /api/integrations/google-sheets/sources/:id/preview?tab=` (owner) → `{ tab, rows }` — first rows, formatted, for the mapping UI; ephemeral, never stored.
- `PUT /api/integrations/google-sheets/sources/:id/mapping` (owner) — body `{ tab_name, header_row, columns: { date, created_time, called_3m, called_10m, pipeline_name } }` (0-based column indexes, distinct). Saves the mapping, resets that source's sync cursor and fires a full sync (fire-and-forget → poll status).
- `POST /api/integrations/google-sheets/sources/:id/sync` (owner) — manual full re-sync of one sheet (fire-and-forget). 409 before that sheet's mapping is saved.
- `DELETE /api/integrations/google-sheets/sources/:id` (owner) — removes one sheet: purges its `sheet_leads` then the source row. The other sheets stay connected.
- `DELETE /api/integrations/google-sheets` (owner) — full disconnect: purges all `sheet_leads` and every source, then revokes the integration (secrets nulled).

Practice-map endpoints (`GET`/`PUT /api/integrations/google-sheets/practice-map`) are REMOVED — practice is now the `practice_label` set at source creation, not a mapped sheet value.

### Google Sheets (Conversion Export, GHL → Dentally)
A SEPARATE connection from Call Reporting's `google_sheets` provider above —
provider id `google_sheets_writer`, full `https://www.googleapis.com/auth/spreadsheets`
scope (read/write), one destination spreadsheet with a tab auto-created per
practice. When a patient's **first-ever** Dentally appointment lands (webhook
or nightly sync) and they also exist as a GoHighLevel contact with a lead in a
pipeline (matched by normalised email or UK phone, exact equality), one row is
appended recording the conversion. Connect via the generic
`POST /api/integrations/connect` with `{ provider: 'google_sheets_writer' }`
(same OAuth dance as any other Google provider — reuses `GOOGLE_SHEETS_CLIENT_ID`/
`SECRET`, falling back to the Google Ads pair; requires the
`https://www.googleapis.com/auth/spreadsheets` scope to be enabled on that
OAuth client's Google Cloud consent screen). Migration `000121`
(`sheet_export_queue` outbox table + enqueue/claim/phone-candidate RPCs).
- `GET /api/integrations/google-sheets-writer/status` (owner | practice_manager) → `{ connected, status, spreadsheetId, exportSince, lastError, counts }`. `status` mirrors the integration row (`not_connected|active|failed|revoked`); `counts` is `null` until connected (per-status queue row counts once available). `exportSince` is the go-forward-only cutoff ISO timestamp (see below), `null` before a destination is set.
- `POST /api/integrations/google-sheets-writer/destination` (owner) — body `{ url }` (full Google Sheets URL or bare spreadsheet id). 409 if `google_sheets_writer` hasn't been connected (OAuth) yet. Verifies the write-scoped token can reach the sheet before persisting. **`export_since` is stamped ONCE**, on the first successful call, to "now" — go-forward only, no backfill of pre-existing appointments; re-posting a new URL later does not re-stamp it. Returns `{ spreadsheetId, exportSince }`.
- `POST /api/integrations/google-sheets-writer/drain` (owner) — manually runs one drain pass for the org (enqueue due rows since `export_since`, claim up to 50, match, append, mark exported/no-match/retry). Same logic the webhook kick and the `*/15` worker sweep run automatically; useful to force an export without waiting. Returns `{ exported, noMatch, retried }` or `{ skipped: 'not_connected' | 'no_destination' }`.
- `DELETE /api/integrations/google-sheets-writer` (owner) — revokes the connection (`status: 'revoked'`, secrets cleared). Queued rows and already-exported sheet rows are left as-is.

Outbox mechanics (not separately routed): a Dentally webhook or the nightly
sync inserts a `sheet_export_queue` row per first-ever appointment
(`ON CONFLICT DO NOTHING`, idempotent); the webhook path fire-and-forget kicks
a drain after responding 200 (60s in-process debounce per org) and a `*/15`
cron sweep (`workers/index.js`, job `sheet-export-drain`) retries
pending/retry rows and catches sync-path inserts. No pipeline lead found → row marked `no_match`, revisited for 30
days. A destination sheet that goes 403/404 (deleted, access revoked) flips
the whole integration to `failed` with a specific `lastError` instead of
retrying forever. Export-id dedup on the sheet itself (a trailing Export ID
column) makes the sheet append idempotent even across overlapping drains.

### `GET /api/call-reporting/dashboard`
(owner | practice_manager) Query `?date=YYYY-MM-DD` (default today,
Europe/London) `&source=<sourceId>` (optional; omitted = all connected
sheets). Runs a cheap append-only top-up of new rows on every configured
sheet first (60s-debounced per source; failure degrades to cached data), then
ONE aggregate RPC (`sheet_leads_dashboard`). Returns `{ configured, date,
sourceId, totalLeads, calledWithin3m, calledWithin10m, efficiencyPct,
leadsInPipeline, notCalled, officeTimeLeads, outsideOfficeTime, facebookLeads,
googleLeads, sources, syncFailed, lastSyncedAt, topUpOk }`. `officeTimeLeads`/
`outsideOfficeTime` split leads by UK office hours (Mon–Fri 09:00–17:00,
Europe/London). `sources` lists every connected sheet
(`id, practice_label, status, last_synced_at, mapped`); `syncFailed` is true
if any source is in a failed state. `{ configured: false }` until at least one
sheet has a saved column mapping. Nightly full re-sync (worker
`google-sheets-sync`, 03:40) catches in-place row edits on every source.

### `POST /api/integrations/:provider/refresh`
Forces an OAuth token refresh. For `gohighlevel`, guarded against concurrent
refresh (single-use token) via the `refresh_in_progress_at` claim; a non-claiming
caller returns `{ skipped: 'refresh_in_progress' }`.

### `POST /api/integrations/:provider/sync`
On-demand data pull for a connected provider (`dentally` | `xero` | `gohighlevel`).
Runs the provider's `syncOneOrg` now and returns its counts. The same pull also
fires automatically on connect (`finishConnect`), so a freshly-connected provider
has data without a manual refresh. 409 if the provider is not connected.

Query `?full=true` (or body `{ full: true }`) re-pulls the full window (backfill).
Body `{ resources: [...] }` (Dentally only) scopes the pull to specific
collections — any of `patients` | `appointments` | `payments` | `treatment_plans`
| `invoices` (`invoices` bundles invoice_items). Omitted/empty pulls everything.
Use it to skip the heavy payments/invoices phases when only, say, patients are
needed. A scoped run also skips the practitioner pull + relink RPCs whose inputs
weren't fetched, and bypasses the full-backfill resume checkpoint (the explicit
pick is honoured every time).

### `GET /api/integrations/:provider/webhook-info`
Returns `{ provider, url, configured }` — the per-org Dentally webhook URL to
paste into the provider, and whether a verifying secret is set. Owner only.

### `POST /api/integrations/:provider/webhook-secret`
Body `{ secret }` (min 8 chars) → stores the HMAC signing secret in
`integrations.config.webhook_secret`. Owner only. (Currently plaintext in config
— hardening candidate; the API token itself is AES-encrypted.)

### `POST /api/integrations/:provider/refresh`
Forces an OAuth token refresh. For `gohighlevel`, guarded against concurrent
refresh (single-use token) via the `refresh_in_progress_at` claim; a non-claiming
caller returns `{ skipped: 'refresh_in_progress' }`.

### `POST /api/integrations/:provider/revoke`
Marks the integration `revoked` and clears stored secrets.

### `GET /api/integrations/:provider/ad-accounts`
Owner only. `provider` ∈ `google_ads | meta_ads` (else 400). Lists the org's
discovered ad accounts from `ad_accounts`:
`[{ provider, customer_id, name, currency, status, is_selected }]`. The syncs
discover ALL reachable accounts and upsert them here; this drives the selector UI.

### `POST /api/integrations/:provider/ad-accounts/selection`
Owner only. Body `{ selected_ids: string[] }` → marks those `customer_id`s
`is_selected=true`, the rest `false` (scoped to the one provider). Empty array =
select none. Selection is the default account filter for the marketing views
(pull-all, filter-on-read: deselecting never deletes synced history). Returns
`{ ok, accounts }`.

### `GET /api/integrations/gohighlevel/accounts`
Owner only. Lists all GHL subaccounts for the org. Returns `{ accounts: [{ id, label, external_account_id, practice_id, config, last_sync_at, last_error, created_at }] }`.

### `POST /api/integrations/gohighlevel/accounts`
Owner only. Body `{ token, locationId, practiceId?, label? }`. Adds a new GHL subaccount (encrypts the token, upserts the row). Returns the created account row.

### `PATCH /api/integrations/gohighlevel/accounts/:id`
Owner only. Body `{ practiceId?, label? }`. Updates the practice mapping or display label for the subaccount. Returns the updated account row.

### `DELETE /api/integrations/gohighlevel/accounts/:id`
Owner only. Removes the subaccount row (and its encrypted secrets) for the org. Returns `{ ok: true }`.

### `POST /api/integrations/gohighlevel/accounts/:id/sync?full=true`
Owner only. Fires a background sync for the specified subaccount. Query `?full=true` re-pulls the full window. Fire-and-forget — returns immediately `{ started: true, accountId, full }`.

### `GET /api/integrations/gohighlevel/accounts/:id/pipelines`
Owner only. Fetches GHL pipelines + stages for the subaccount using its stored token. Returns `{ pipelines: [{ id, name, stages: [{ id, name }] }] }`. Returns `{ pipelines: [], error: 'no_auth' }` if no credentials are stored.

### `POST /api/integrations/gohighlevel/accounts/:id/stage-mappings`
Owner only. Body `{ mappings: { [stageId]: status } }`. Persists the GHL stage → Elevate status mapping into `integration_accounts.config.stage_mappings`. Returns `{ ok: true, stage_mappings }`.

### `GET /api/integrations/quickbooks/accounts`
Owner only. Lists every connected QuickBooks company (one `integration_accounts` row per QBO realm; **no practice mapping** — each company is an independent entity). Returns `{ accounts: [{ id, realm_id, company_name, label, status, last_sync_at, last_error, created_at }] }` (secrets never returned).

### `POST /api/integrations/quickbooks/accounts/connect`
Owner only. Begins connecting another QuickBooks company. Returns `{ redirectUrl }` (the Intuit OAuth URL); the browser hands off there. The public callback `/oauth/quickbooks/callback` exchanges the code, captures `realmId`, fetches the company name, upserts the `integration_accounts` row, and fires a first full sync.

### `POST /api/integrations/quickbooks/accounts/:id/sync?full=true`
Owner only. Fires a background sync for one company. `?full=true` re-pulls the 12-month backfill. Fire-and-forget — returns `{ started: true, accountId, full }`.

### `DELETE /api/integrations/quickbooks/accounts/:id`
Owner only. Disconnects a company: revokes the credential row and purges that company's rows from `monthly_financials` / `bank_accounts` / `invoices` / `payments` (all stamped with `integration_account_id`). Returns `{ ok: true }`.

### `GET /api/finance/quickbooks?accountId=&period=YYYY-MM&from=&to=`
finance.view. Finance > QuickBooks dashboard data, summed across all companies (`accountId` omitted) or scoped to one. `period` pins a month; `from`/`to` (date or month) window it; default = trailing 12 months. Returns `{ window:{fromPeriod,toPeriod}, summary:{revenuePence,expensesPence,netProfitPence,netMarginPct,cashAtBankPence,receivablesPence,receiptsPence}, byBucket:{revenue,staff,lab,materials,overhead,tax,other}, trend:[{period,revenuePence,expensesPence,netProfitPence}], companies:[{accountId,companyName,revenuePence,expensesPence,netProfitPence,netMarginPct,cashAtBankPence,receivablesPence,receiptsPence}] (only in the summed view), accounts:[{id,companyName,status}] }`. Money in integer PENCE. Cash/receivables are point-in-time snapshots; revenue/expenses/receipts are windowed.

### `GET /api/integrations/gohighlevel/dashboard`
Auth: `owner` or `practice_manager`. Consolidated GoHighLevel metrics aggregated across all connected subaccounts for the org (or scoped to one via `accountId`).

Query params:
- `accountId` (uuid, optional) — scope to a single subaccount.
- `practiceId` (uuid, optional) — scope to a specific practice.
- `since` / `until` (ISO datetime strings, optional) — window for new/recent counts; defaults to trailing 30 days.

Response shape:
```json
{
  "period": { "since": "2026-05-13T00:00:00Z", "until": "2026-06-12T23:59:59Z" },
  "totals": {
    "contacts": {
      "total": 0,
      "new": 0,
      "bySource": [{ "source": "string", "count": 0 }]
    },
    "leads": {
      "total": 0,
      "new": 0,
      "open": 0,
      "won": 0,
      "lost": 0,
      "pipelineValuePence": 0,
      "conversionPct": 0,
      "byStage": [{ "stage": "string", "count": 0 }]
    },
    "conversations": {
      "total": 0,
      "inbound": 0,
      "outbound": 0,
      "last7d": 0
    },
    "sync": {
      "accounts": 0,
      "active": 0,
      "failed": 0,
      "lastSyncAt": "2026-06-12T22:00:00Z"
    }
  },
  "perAccount": [
    {
      "accountId": "uuid | null",
      "label": "string",
      "practiceId": "uuid | null",
      "status": "active | error | pending",
      "lastSyncAt": "2026-06-12T22:00:00Z",
      "lastError": "string | null",
      "contacts": 0,
      "leads": 0,
      "pipelineValuePence": 0,
      "conversionPct": 0,
      "conversations": 0
    }
  ]
}
```

`perAccount` includes an `accountId: null` "Unmapped" row when GHL contacts/leads exist without a practice mapping. All money fields (`pipelineValuePence`) are integer pence. Backed by Postgres RPC `ghl_dashboard_aggregate` (migration `20260101000087_ghl_dashboard_rpc.sql`; applied on hosted).

`totals` also carries an `appointments` block (GHL calendar bookings, synced into `ghl_appointments`): `{ total, inWindow, upcoming, showed, noshow, cancelled, booked, byCalendar:[{calendar,count}] }`; each `perAccount` entry adds `appointments` + `appointmentsUpcoming`. Backed by RPC `ghl_appointments_aggregate` (migration `20260101000088_ghl_appointments.sql`; applied on hosted). `noshow`/`showed`/`cancelled`/`booked` are windowed by `starts_at`; `upcoming` = `starts_at >= now()`.

**Connect styles.** `dentally` (and `soe`) are `broker_key`: connect returns
`{ requiresKeyPaste, pasteHint }`; the owner pastes the Dentally Bearer token
(encrypted at rest). Dentally is pull-only — the token authenticates our polling
(`GET /v1/patients|appointments|payments`); Dentally does not push. Poll cadence:
every 2h in `workers/index.js`, plus first-pull-on-connect and on-demand `/sync`.

> GoHighLevel inbound sync (opportunities + contacts → leads/contacts) runs
> hourly in `workers/index.js`; not an HTTP endpoint.

### Daily WhatsApp report

Owner-only settings, preview and manual-send endpoints for the daily
WhatsApp digest (sent to a GHL inbound webhook). The stored webhook URL is a
send-anything credential — `GET` never returns it in the clear, only a
masked form.

### `GET /api/integrations/gohighlevel/daily-report`
Owner only. Returns `{ settings: { webhookUrlMasked, configured, enabled, lastSentAt, lastStatus, lastError } | null }`. `settings` is `null` when nothing has been configured yet.

### `PUT /api/integrations/gohighlevel/daily-report`
Owner only. Body `{ webhookUrl, enabled }` — `webhookUrl` must be `https://` (plain `http://` is rejected, 400). Upserts the org's settings row (URL encrypted at rest). Returns `{ settings }` (masked, as above).

### `POST /api/integrations/gohighlevel/daily-report/preview`
Owner only. Builds the report for the previous full day in Europe/London — the
same day the 18:00 cron would report on — without sending it. Returns
`{ line, length, payload }`.

### `POST /api/integrations/gohighlevel/daily-report/send`
Owner only. Triggers an immediate manual send to the configured webhook. Rate-limited in-memory to 6 sends/hour/org (429 `{ error }` beyond that — a double-click guard, not a security control). Returns `{ sent, status, reason? }`.

## Notifications

In-app notification inbox and delivery-preference management for the current authenticated user. All endpoints under `/api/notifications` require tenant auth (JWT cookie via the same-origin proxy). Notifications are scoped to the calling user within their organisation.

`category` is one of `account | team | integration | digest | system`.

### `GET /api/notifications?unread=<true|false>`
List the current user's in-app notifications, most recent first (max 50). Optional `unread` query param filters to unread-only (`true`) or read-only (`false`); omitted returns all.
```json
Response:
{
  "notifications": [
    {
      "id": "uuid",
      "organisation_id": "uuid",
      "category": "integration",
      "title": "Dentally sync complete",
      "body": "329,412 appointments imported successfully.",
      "link_url": "/integrations",
      "read_at": null,
      "created_at": "2026-06-06T09:00:00Z"
    }
  ]
}
```

### `GET /api/notifications/unread-count`
Returns the count of unread notifications for the current user.
```json
Response:
{ "count": 3 }
```

### `POST /api/notifications/:id/read`
Mark a single notification as read. Returns 404 if the notification does not belong to the current user.
```json
Response:
{ "ok": true }
```

### `POST /api/notifications/read-all`
Mark all of the current user's notifications as read.
```json
Response:
{ "ok": true }
```

### `GET /api/notifications/preferences`
Returns only the categories for which the user has explicitly set preferences. Categories not present in the response use the defaults: `in_app=true`, `email=true`, `sms=true` for `integration` only (all other categories default `sms=false`).
```json
Response:
{
  "preferences": [
    { "category": "integration", "in_app": true, "email": true, "sms": false }
  ]
}
```

### `PUT /api/notifications/preferences`
Upsert delivery preferences for one or more categories. Missing categories are left unchanged.
```json
Request:
{ "preferences": [{ "category": "digest", "in_app": true, "email": false, "sms": false }] }

Response:
{ "ok": true }
```

## Error responses

All errors return:
```json
{ "error": "Human readable message" }
```

Status codes:
- `400` Validation failed (includes `issues` array)
- `401` Missing/invalid token
- `403` Insufficient permissions
- `404` Not found
- `429` Rate limited
- `500` Internal error

## Rate limits

- 100 requests/minute per IP (global, public routes)
- 50 requests/minute per authenticated user (`/api/*`, keyed by verified user id)
- 5 requests/minute per IP for `/auth/login`, `/auth/signup`, `/api/platform/login` (credential endpoints)
- 10 requests/minute for `/api/p4g-ai/chat` (AI)
- 20 requests/minute for `/api/files/presign` (uploads)

---

## Platform-admin surface (`/api/platform/*`)

**Auth model is completely separate from tenant auth.** Platform endpoints
authenticate against `platform_admins` using a dedicated JWT signed with
`PLATFORM_ADMIN_JWT_SECRET` (NOT the Supabase JWT). A tenant Supabase JWT will
be rejected with `401` here; a platform JWT will be rejected with `401` on
every tenant `/api/*` route. Every authenticated request writes one row to
`platform_audit_log` (fail-closed — a log error fails the request).

All endpoints accept `Authorization: Bearer <platform_jwt>` and respond JSON.

### `POST /api/platform/login`
Public, rate-limited to 5/min/IP. Returns a platform JWT + admin profile.
Reached via the unified `/login` page (see `POST /auth/login`), not a separate
admin login screen.
```json
Request:  { "email": "...", "password": "..." }
Response: { "token": "...", "admin": { "id", "email", "full_name", "role", "must_change_password" } }
```

### `POST /api/platform/orgs` *(superadmin)*
Creates a tenant organisation + owner directly (auto-approved, owner `active`).
Generates a one-time temp password returned ONCE (never persisted or audited).
```json
Request:  { "email": "...", "full_name": "...", "organisation_name": "..." }
Response: { "organisation_id": "uuid", "owner_id": "uuid", "email": "...", "temp_password": "..." }
```

### `GET /api/platform/signups`
Self-signup owners awaiting approval (status `pending`), with org name. Any admin.

### `POST /api/platform/signups/:id/approve` *(superadmin)*
Approves a pending owner → `active` (can now log in). `404` if `:id` is not an
owner, `409` if not `pending`. Audited.

### `POST /api/platform/signups/:id/reject` *(superadmin)*
Rejects a pending owner → `rejected` (row kept; login permanently blocked).
Same `404`/`409` guards. Audited.

### `POST /api/platform/change-password`
Authenticated. Verifies `current_password`, sets `new_password` (min 12 chars),
clears `must_change_password`.

### `GET /api/platform/me`
Returns the current platform admin record.

### `GET /api/platform/orgs?q=&limit=&offset=`
Lists all organisations (cross-tenant). Returns `{ rows, total }`.

### `GET /api/platform/orgs/:id`
Single org with `user_count`.

### `GET /api/platform/orgs/:id/users`
Users in that org (no RLS — service-client read).

### `GET /api/platform/orgs/:id/activity`
Tenant `audit_log` rows for that org, newest first.

### `GET /api/platform/users?q=&limit=`
Global user search by email substring (min 1 char from frontend; backend caps `limit` at 200).

### `GET /api/platform/metrics/overview?days=`
Cross-tenant counts and N-day deltas. Default `days=30`, max `365`.

### `GET /api/platform/metrics/integrations`
Per-provider connected/error/total counts across tenants.

### `GET /api/platform/audit?organisation_id=&user_id=&action=&limit=&offset=`
Cross-tenant tenant audit log.

### `GET /api/platform/audit/platform?limit=&offset=`
Platform-side audit log (who-did-what on `/api/platform/*`). Requires `superadmin` role.

### Roles
- `superadmin` — every endpoint, including `/audit/platform`, `POST /orgs`, and
  signup approve/reject.
- `support`    — read endpoints + `/me` + `/change-password`; NOT `/orgs`,
  signup approve/reject, or `/audit/platform`.
- `readonly`   — read endpoints only.

A platform admin with `must_change_password=true` is blocked (403) on every
route except `/me` and `/change-password` until they rotate their password.

### Env vars
- `PLATFORM_ADMIN_JWT_SECRET` (required at runtime, ≥32 chars)
- `PLATFORM_ADMIN_BOOTSTRAP_EMAIL` + `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` — when both set
  AND the `platform_admins` table is empty, server boot creates the first
  superadmin with `must_change_password=true`. Idempotent thereafter.

## Platform course authoring (`/api/platform/courses/*`)

**Auth:** platform superadmin JWT only (same auth model as `/api/platform/*` above — platform JWT, not Supabase JWT). All endpoints require `superadmin` role. The catalogue is **global** (no `organisation_id`); tenant read/enrol/progress lives on `/api/training`.

File uploads: use `POST /api/platform/courses/presign` to get an S3 presigned PUT URL, then store the returned `key` when creating courses/lessons/files. Tenant downloads use the `/api/training/…/download` endpoints.

### Courses

- `GET    /api/platform/courses` — list all courses (draft + published). Returns `{ courses: [...] }`.
- `POST   /api/platform/courses` — create course (body: `courseCreateSchema`). Returns the created course (201).
- `GET    /api/platform/courses/:id` — one course with modules, lessons, and files. Returns the full course.
- `PATCH  /api/platform/courses/:id` — partial update (`courseUpdateSchema`). Returns the updated course.
- `DELETE /api/platform/courses/:id` — delete course (cascades modules/lessons). Returns `{ deleted }`.
- `POST   /api/platform/courses/:id/publish` — set status `published` or `draft` (body `{ status }`, default `published`). Returns updated course.
- `POST   /api/platform/courses/presign` — presigned S3 PUT URL for an attachment upload (body: `{ filename, content_type }`). Returns `{ uploadUrl, key, file }`.

### Modules *(superadmin)*

- `POST   /api/platform/courses/:id/modules/reorder` — reorder modules (body `{ ids: string[] }`, full ordered list of module UUIDs). Returns `{ modules }`.
- `POST   /api/platform/courses/:id/modules` — create module. Body: `{ title, position?, access? }`. Returns the created module (201).
- `PATCH  /api/platform/courses/:id/modules/:moduleId` — partial update of a module (any subset of create fields). Returns the updated module.
- `DELETE /api/platform/courses/:id/modules/:moduleId` — delete module (cascades lessons and their files). Returns `{ deleted }`.

### Lessons *(superadmin)*

- `POST   /api/platform/courses/:id/modules/:moduleId/lessons/reorder` — reorder lessons within a module (body `{ ids: string[] }`). Returns `{ lessons }`.
- `POST   /api/platform/courses/:id/modules/:moduleId/lessons` — create lesson under a module. Body: lesson fields (title, type, content, position, access, etc.). Returns the created lesson (201).
- `PATCH  /api/platform/courses/:id/lessons/:lessonId` — partial update of a lesson. Returns the updated lesson.
- `DELETE /api/platform/courses/:id/lessons/:lessonId` — delete lesson (cascades lesson files). Returns `{ deleted }`.

### Lesson files *(superadmin)*

- `POST   /api/platform/courses/:id/lessons/:lessonId/files` — add a categorised file to a lesson. Body: `{ category, name, file_key, file_type?, size_bytes?, access? }`. Returns the created lesson file record (201).
- `DELETE /api/platform/courses/:id/lessons/:lessonId/files/:fileId` — remove a lesson file. Returns `{ deleted }`.

### Course resources *(superadmin)*

- `POST   /api/platform/courses/:id/resources` — attach a course-level resource (body: `resourceCreateSchema`). Request/response now include `category` (`marking-rubrics` | `additional-resources`, default `additional-resources`; migration `000048`). Returns the created resource (201).
- `DELETE /api/platform/courses/:id/resources/:resId` — remove a course-level resource. Returns `{ deleted }`.

> **Schema note (migration `000047`):** modules live in `course_modules`; lesson files live in `lesson_files`; lessons carry a `module_id` FK. Migration `000047` is **NOT YET applied on hosted** — apply it + run `NOTIFY pgrst, 'reload schema';` before using any module or lesson-file endpoint in production.

## CRM

### CRM Templates  `/api/crm/templates`
Reception may GET; owner/practice_manager may mutate. All org-scoped.

- `GET /api/crm/templates?channel=sms|email` -> `{ templates: Template[] }`
- `POST /api/crm/templates` body `{ channel, name, subject?, body }` -> `Template`
- `PATCH /api/crm/templates/:id` body `{ channel?, name?, subject?, body?, is_archived? }` -> `Template`
- `DELETE /api/crm/templates/:id` -> `{ success: true }` (soft delete: sets is_archived)

`Template = { id, organisation_id, channel, name, subject, body, is_archived, created_at, created_by, updated_at }`.
Bodies/subjects may contain `{{var}}` placeholders: first_name, last_name, treatment, practice, appointment_date, address, review_link.

### CRM Settings  `/api/crm/settings`
Manage-only screen: owner/practice_manager for both GET and PUT. One row per org;
seeded from catalogue defaults on first GET. Treatment values are integer **pence**.

- `GET /api/crm/settings` -> `{ settings: Settings, counts: Counts }`
- `PUT /api/crm/settings` body = any subset of `{ treatments, sources, payment_plans, gdpr_default_basis, quiet_hours_start, quiet_hours_end, quiet_hours_tz, marketing_default_consent }` (upsert) -> `{ settings, counts }`

`Settings = { organisation_id, treatments: [{ name, default_value_pence }], sources: string[], payment_plans: string[], gdpr_default_basis: 'consent'|'legitimate_interest'|'contract'|'none', quiet_hours_start, quiet_hours_end ('HH:MM'), quiet_hours_tz, marketing_default_consent, updated_at, updated_by }`.
`Counts = { template_count, active_sequence_count, treatment_count, source_count }` (active_sequence_count is 0 until B3 lands the crm_sequences table).

## Production logs (`/api/admin/logs/*`) *(owner only)*

Read/download the on-disk production logs. Gated `requireRole('owner')` at the
mount point. Logs are written by `lib/logger.js` into `LOG_DIR` (point it at a
persistent Railway Volume, e.g. `/data/logs`). When `LOG_DIR` is unset the app
logs to stdout only and these endpoints report `enabled: false` / `files: []`.

Files: `app.<date>.<n>.log` (all levels) and `error.<date>.<n>.log` (errors +
fatals only), daily-rotated, auto-pruned to `LOG_RETAIN_APP_DAYS` (default 14)
and `LOG_RETAIN_ERROR_DAYS` (default 30). The `file` query param must be a plain
basename of a file in `LOG_DIR` (path traversal rejected with `400`).

- `GET /api/admin/logs` -> `{ enabled, directory, files: [{ name, sizeBytes, modified }] }` (newest first)
- `GET /api/admin/logs/tail?file=<name>&lines=<n>` -> `{ file, lines: string[] }` (default 200 lines, max 5000; reads ≤512 KB from the file end). `400` bad name, `404` missing file, `409` if `LOG_DIR` unset.
- `GET /api/admin/logs/download?file=<name>` -> raw `text/plain` attachment. Same error codes.

## Daily Command Cockpit (`/api/cockpit/*`)

One-page daily snapshot: Emergent cash-up + monthly P&L, and Google vs Facebook
lead performance matched against Emergent conversions. Gated on the
`finance.view` permission. Money is integer **pence** throughout.

Window params are `since` / `until` (ISO, half-open `[since, until)`); `scope` is
`all` or a practice UUID on the root endpoint, `practiceId` on the detail ones.

### `GET /api/cockpit`

```
{
  window, revenue { collectedPence, byPractice[], dailySeries[] },
  treatment { acceptedCount, acceptedValuePence, txPlansGiven, txPlanValuePence,
              newLeads, attended, byPractice[] },
  leadRoi, cashUp { … }, monthly { … }, updatedAt
}
```

`leadRoi` is the Google/Facebook comparison:

- `channels[]` — one row per practice × channel: `{ practiceId, practiceName, pipelineId, pipelineName, channel, leads, entries, conversions, matchedValuePence }`. **`leads` counts people** (one contact sitting in several pipelines of the same channel is one lead); `entries` is the raw pipeline-row count behind them.
- `group` — org-wide `{ google, facebook }` totals. **Always org-wide**, whatever `scope` is, so a scoped figure always has a group figure to be compared against.
- `scoped` — the selected practice's own totals, same shape as `group`; `null` when `scope=all`. Scoping is applied *after* matching, so it never changes how a lead is matched or what the group total is.
- `unmapped` — `{ leads, accounts: [{ accountId, label, leads }] }`. Leads from GoHighLevel subaccounts with **no practice mapping** (an org can also connect academy/accounting locations). They are excluded from `channels`/`group` and reported here, so they are neither silently counted into a practice nor silently dropped.
- `spendByChannel`, `groupChannels` — ad spend and the derived `cplPence` / `roi`. Group-level only: `ad_metrics` carries no practice, so a per-practice spend figure would be a guess.

Conversion matching is **open-ended on the accepted side** — a lead created in the
window is "converted" if it has been accepted *by now*, not only if it was accepted
inside the same window (leads typically convert weeks later).

`monthly` carries the latest month Emergent has sent a P&L for (falling back from
the current calendar month via `latestMonthlyPl`): `{ periodMonth, revenuePence,
netProfitPence, clinicianFeesPence, labOverheadPence, residualPence, marginPct,
byBusiness[], costLines[], opexLines[], customLines[], lineNotes[] }`.

- `clinicianFeesPence` — `principal_fees_pence + hygienist_therapist_pence`.
- `labOverheadPence` — every other cost line + all opex lines + `custom_lines`.
- `residualPence` — `revenue − clinician − labOverhead − netProfit`. **Non-zero
  means Emergent's own lines don't add up to the net profit it sent.** Surfaced
  rather than plugged, so a broken feed can't masquerade as a balanced one.
- `marginPct` — `netProfit / revenue`, to 2dp. **`null` when revenue is 0** (a
  margin on no revenue is undefined, not 0%).

`revenueByLine[]` — `{ name, amountPence, sharePct }`, largest-first, zero-fee
lines dropped. Invoiced fee per treatment from the `treatment_revenue_matrix`
RPC (migration `…000041`), scoped to `scope` when it's a practice. **Empty for
a window/practice with no invoiced treatment lines** — this can mean nothing
was invoiced in the window, or that there is no Dentally feed for that
practice at all; either way it is not the same as `£0` invoiced. (An earlier
version of this doc asserted a fixed "data starts 10 Jun 2026" cutoff — that
was wrong: it was `min(created_at)` on `invoice_items`, i.e. when rows were
SYNCED, not the period they cover; the live coverage for `invoiced_on` in fact
runs back to mid-2025. There is no fixed platform-wide start date — it
depends on each org's Dentally connection.)

### Detail endpoints (lazy — fetched when a drill-down opens)

- `GET /api/cockpit/leads?since&until&practiceId&channel&limit&offset` -> `{ window, lines[], limit, offset }`. Each line: `{ id, contactId, createdAt, practiceName, channel, pipelineName, name, email, phone, converted, matchedValuePence, matchedTreatmentName, matchedPatientName, matchedAcceptedDate }`. `limit` defaults 100, capped 500.
- `GET /api/cockpit/treatments?since&until&practiceId&limit&offset` -> accepted treatments, each tagged with the ad pipeline the patient **first** came in on: `{ id, acceptedDate, practiceName, patientName, treatmentName, valuePence, source, leadChannel, leadPipelineName, leadCreatedAt }`. The last three are `null` when no GoHighLevel lead matches the patient (walk-in, referral, or unmatchable). Backed by the `cockpit_accepted_lead_source` RPC (migration `…000112`) — phone → email → practice-scoped name, earliest lead wins.
- `GET /api/cockpit/cashup-days?since&until&practiceId&limit&offset` -> `{ window, lines[] }`, one row per cash-up day: `{ cashupDate, practiceName, cashTakenPence, detailPence, variancePence, txPlansGiven, txPlanValuePence, newLeads, attended, refunds[] }`. **This day list is the deepest `txPlansGiven` / `newLeads` / `attended` can be drilled** — Emergent's cash-up sends a manager-keyed count per day and no per-plan or per-lead records.

### `GET /api/cockpit/cost-model?asOf=YYYY-MM-DD`

The manual per-practice inputs behind §6 Profit vs Breakeven and §1's Daily
target. `finance.view`. `asOf` defaults to today; the read returns the model **in
force on that date** (latest `effective_from <= asOf`), so a past window is
costed with the model that was actually in force then.

```
{ asOf, rows: [{ practiceId, name, effectiveFrom, fixedCostPenceMonth,
                 breakevenLowPence, breakevenHighPence, workingDaysPerMonth,
                 revenueTargetPenceMonth }] }
```

One row per **active practice**, not per stored model — a practice with no model
returns `null` for every input (and `effectiveFrom: null`), never `0`.
`workingDaysPerMonth` defaults to 20.

### `PUT /api/cockpit/cost-model/:practiceId`

**Owner only** (`requireRole('owner')`) — rule 5 makes Practice Manager finance
access owner-toggled, so a manager cannot set targets by default. Body is any
subset of `{ fixedCostPenceMonth, breakevenLowPence, breakevenHighPence,
workingDaysPerMonth, revenueTargetPenceMonth }`; money is integer **pence**.
Omitted fields are left untouched.

Writes at `effective_from = today`, upserting on `(practice_id, effective_from)`
— so two edits in one day update one row rather than stacking two, and yesterday's
model is preserved. Returns the written row in the same shape as the list.

`400` on a malformed `practiceId`, an empty body, or `breakevenLowPence >
breakevenHighPence`.

### `breakeven` and `revenue.month` on the main cockpit payload

`breakeven` — §6 Profit vs Breakeven. Inputs come from `practice_cost_model`
(migration `…000113`), read **as-of the window's start**. Maths in
`calculateBreakeven` (`docs/FORMULAS.md` §17).

- `rows[]` — one per **active practice**: `{ practiceId, name, revenuePence,
  workingDaysInWindow, breakevenDayPence, contributionPence, fixedDayPence,
  fixedPence, profitPence, status }`.
- `status` — `above` | `below` | `not_set` (no usable cost model) |
  `not_reporting` (no cash-up in the window at all, e.g. Warwick Lodge). For the
  last two, every money field is **`null`, not `0`** — a practice with no feed has
  not earned £0.
- `workingDaysInWindow` counts **days the practice actually traded** (distinct
  cash-up dates), not calendar weekdays.
- `group` — `{ revenuePence, contributionPence, fixedPence, breakevenPence,
  profitPence, status, excludedCount }`. Sums **only** the `above`/`below` rows;
  `excludedCount` reports how many were left out. A costless practice folded in as
  £0 fixed would silently overstate group profit. **When no practice is counted
  (`excludedCount` == total), every field here is `null`, not `0`** — summing an
  empty set to a hard zero would render "£0" beside the `not_set` status badge.
- `group.revenuePence` here is `Σ` of the counted rows' `revenuePence` — the
  cash-up feed, same source as each row. `group.breakevenPence` is `Σ
  (breakevenDayPence × workingDaysInWindow)`, an **INDICATIVE aggregate** of
  the per-practice requirements. `group.status` is derived from **summed
  profit** (the authoritative figure), not from comparing `revenuePence` to
  `breakevenPence`. With heterogeneous per-practice margins the two aggregates
  can legitimately diverge — e.g. group revenue can sit below group breakeven
  while `status` is still `above`, because one practice's higher margin
  outweighs another's shortfall. A consumer must not infer `status` by
  comparing group revenue to group breakeven; read `status`/`profitPence`
  directly.
- Revenue for `rows[]` and `group` comes from `emergent_daily_cashup`
  **only** — never from `treatment_accepted` (a separate Emergent feed). A
  practice with an accepted treatment but no cash-up row is `not_reporting`,
  not `£0`.

`revenue.month` — §1's Cash today / MTD / Projected / Daily target cards.
**Anchored to the calendar month containing `min(until, today)`**, not to the
window ("month to date" against an arbitrary window is meaningless), and not
blindly to the window's last month either — a window ending in the future
(e.g. "This year" sends `until` = next 1 Jan) anchors to the CURRENT month,
never to a month that hasn't happened yet. The UI labels the month on all four
cards. Both `since`/`until` and the window used to read the as-of cost model
are resolved to **London-local calendar dates** (`Europe/London`), since the
scope bar sends London-wall-clock-midnight ISO instants (e.g. July's window
starts at `2026-06-30T23:00:00.000Z` in BST) rather than plain `YYYY-MM-DD`
strings; truncating those as UTC would land a day early every BST month, and
because `until` is exclusive its instant is resolved from the last instant
*inside* the window so it doesn't roll into the next month. A bare
`YYYY-MM-DD` `until` (accepted by `cockpitQuerySchema`, though the scope bar
never sends one) is handled as a plain date rather than round-tripped through
an instant, which would otherwise land inside the BST offset and skip a day.
`{ periodMonth, todayPence, todayDate, mtdPence, workingDaysElapsed,
avgPerDayPence, projectedPence, dailyTargetPence, byPractice[] }`.

- The `workingDaysPerMonth` and `revenueTargetPenceMonth` behind
  `dailyTargetPence`/`projectedPence` are read from the cost model **as-of
  TODAY**, not the window start — a target saved this afternoon must show up
  on this card even when the default "This month" window starts on the 1st.
  `breakeven`'s per-day figures keep reading as-of the window start (a March
  window is costed with March's model); these are two independent reads of
  `practice_cost_model`.
- `projectedPence` — each practice projected separately (`mtd / daysElapsed ×
  workingDaysPerMonth`) then summed, so the group can't drift from its parts.
  **`null` when nothing has traded** — never a divide-by-zero or a £0.
- `dailyTargetPence` — sum of each practice's `revenueTargetPenceMonth /
  workingDaysPerMonth`. `null` when no practice has a target set.
- `todayPence` / `todayDate` — the latest cash-up day in the month; `null` when
  the month has no cash-up at all.
- `mtdPence` — **`null` when the month has no cash-up at all** (never a
  fabricated `£0`), otherwise the sum of real cash-up cash across practices
  that reported (see `byPractice[].mtdPence` below).
- `avgPerDayPence` — group `mtdPence` ÷ the count of distinct calendar days ANY
  practice traded so far in the month. `null` when nothing has traded, or when
  `mtdPence` itself is `null` (never a divide-by-zero).
- `byPractice[].mtdPence` — `null` when that practice has no cash-up row
  anywhere in the month (it did not report), matching `breakeven.rows`'
  `not_reporting` story for the same practice — never a contradictory `£0
  MTD`. The group `mtdPence` total still sums real cash-up cash, treating a
  non-reporting practice as contributing 0 to the total (the total is a known
  fact even though the individual row is not) — but is `null` itself when no
  practice reported at all this month.

## Data Room (`/api/data-room/*`)

Raw source rows for the data analyst. Every route requires the `data.export`
permission key (owner by default; the `analyst` role holds only this key).
Registry: `backend/src/lib/data-room/registry.js`. Spec:
`docs/superpowers/specs/2026-08-25-data-room-design.md`.

### `GET /api/data-room/datasets`

Registry for the UI. `{ sources: [{ key, label, description, datasets: [{ key, label, roster, summary, columns: [{ col, pii, derived, unit, description }] }] }] }`.
Sources: `dentally`, `google-ads`, `meta-ads`, `gohighlevel`, `emergent`, `summaries`. `unit` ∈ `id`|`hash`|`pence`|`count`|`number`|`percent`|`minutes`|`flag`|`date`|`timestamptz`|`text`.

### `GET /api/data-room/freshness`

"Data as of" for the badge. `{ sources: { dentally|google-ads|meta-ads|gohighlevel|emergent|summaries: { last_sync_at, status, accounts?: [{ label, status, last_sync_at }] } }, as_of }` — `last_sync_at` from `integrations` (GoHighLevel: latest across `integration_accounts`, which are listed under `accounts`); `summaries.last_sync_at = as_of` = the latest of all sources.

### `GET /api/data-room/:source/:dataset?scope&since&until&page&cursor&limit&pii`

- `scope` — `all` (default) or a practice UUID.
- `since`, `until` — ISO instants, `[since, until)`. Required unless the dataset is `roster` (ignored then). Dentally `patients` is dated on `created_at`.
- `page` — integer ≥ 1. **Numbered-page (offset) mode**: returns rows `(page-1)*limit … page*limit-1` of the filtered, ordered set; `cursor` is ignored. What the Data Room UI uses.
- `cursor` — opaque, from the previous page's `next_cursor` (keyset mode; used when `page` is absent — O(page) on any table size, how the CSV export batches).
- `limit` — 1–500, default 100.
- `pii` — `1` includes patient-identifying columns. **Owner only**; anyone else gets `403 { error: "PII export is owner-only" }`.

Response `{ rows, next_cursor, total }` in both modes (`total` is the exact filtered count, so the client derives `ceil(total / limit)` pages). Rows carry only registry columns; PII-flagged columns are absent unless `pii=1` by an owner. Ordering `(dateCol, id)` for event datasets, `id` for roster. Money is integer pence.

**Derived columns** (`derived: true` in the registry) are computed in `public.data_room_*` views (migration `…000131`): appointments `is_patient_appointment / occurred / dna / cancelled / duration_mins / practitioner_name`, patients `patient_key / birth_year / postcode_district`, payments `is_settled`, invoice_items `fee_total_pence / practitioner_name`, treatment_items `counts_as_activity / practitioner_name`, GHL contacts `contact_key`, opportunities `pipeline_name / outcome`, ads `practice_name / cpl_pence` (spend ÷ platform conversions). **Summary datasets** (`summaries/practice_day`, `summaries/practice_month`; `summary: true`) come from RPCs `data_room_practice_day` / `data_room_practice_month` (service_role only), require `since`/`until`, page by offset, and carry `id = "<practice_id|unassigned>:<day|YYYY-MM>"`. `practice_month`'s `cost_per_lead_pence` (spend ÷ CRM leads, `leads_new`) is a different ratio from ads' `cpl_pence` above — the two must not be conflated. Summary financial columns `financial_revenue_pence`/`financial_costs_pence` are `null` when no accounting row is mapped to that practice+month; org-level accounting rows land on the row with `practice_id = null` and `practice_name = 'Group / unassigned'`, which a single-practice `scope` excludes.

### `GET /api/data-room/:source/:dataset/export.csv?scope&since&until&pii`

Streams the whole filtered set: `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<source>-<dataset>_<since>_<until>.csv"` (roster: `_<today>`), UTF-8 BOM, CRLF. Written in 1000-row batches; any size. Every export writes an `audit_log` row (`action='export'`, `entity_type='data_room'`, `diff={source,dataset,scope,since,until,pii,rows[,aborted]}`).

### `GET /api/data-room/:source/:dataset/export.xlsx?scope&since&until&pii`

Same filters and PII gate as CSV. Streams an `.xlsx` workbook (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="<source>-<dataset>_<since>_<until>.xlsx"`). `scope=all` on a practice-column dataset → one worksheet per practice (+ "Unassigned"); a practice scope → one worksheet named after it; `via`/summary datasets → "All practices". Header row bold + frozen; pence columns keep their integer value and gain a `<name>_gbp` neighbour formatted `£#,##0.00`; dates/timestamps are real Excel dates (UTC). Row cap 500 000 → `413 { error: "Export too large for Excel (N rows). Narrow the period or use CSV." }` before any byte. Audited like CSV with `format: 'xlsx'`.

## Ad attribution (`/api/ad-attribution/*`)

Google-vs-Facebook lead performance from an explicit, operator-maintained
pipeline→channel map (`ad_channel_pipelines`, migration `…000114`), replacing
name-based channel guessing. All routes gated `requireRole('owner',
'practice_manager')`. Money is integer **pence**. Maths: `docs/FORMULAS.md`
§18.

### `GET /api/ad-attribution/config`

Everything the settings screen needs in one round trip: `{ practices,
subaccounts[], pipelines[], adAccounts[] }`.

- `subaccounts[]` — one per connected GoHighLevel Location: `{ id, label,
  locationId, status, practiceId, practiceName, pipelineCount, leadCount }`.
  `practiceId`/`practiceName` are `null` when the subaccount is not mapped to a
  practice (e.g. the academy/accounting Locations that share an org with
  dental practices).
- `pipelines[]` — one row per pipeline across every subaccount: `{ accountId,
  accountLabel, practiceId, practiceName, pipelineId, pipelineName, channel,
  leadCount }`. `channel` is `null` when the pipeline has no row in
  `ad_channel_pipelines` (Unassigned) — there is deliberately no
  `'unassigned'` value stored; absence of a row **is** the unassigned state.
- `adAccounts[]` — connected Google/Meta ad accounts: `{ id, provider,
  customerId, name, practiceId, practiceName }`, `practiceId` `null` when
  unmapped.

### `PUT /api/ad-attribution/pipelines/:accountId/:pipelineId`

Set (or clear) a pipeline's channel. Body `{ channel: 'google_ads' |
'meta_ads' | null }` — `null` deletes the mapping row, returning the pipeline
to Unassigned. `500` (a plain `Error`, not a status-coded `AppError`) if
`:accountId` is not a GHL subaccount belonging to the caller's organisation.

### `PATCH /api/ad-attribution/subaccounts/:id`

Map a GHL subaccount to a practice. Body `{ practice_id: <uuid> | null }`.
Delegates to the existing `integration_accounts` update path (not a direct
write), so the one-subaccount-per-practice unique index stays enforced in one
place.

### `PATCH /api/ad-attribution/ad-accounts/:id`

Map a Google/Meta ad account to a practice. Body `{ practice_id: <uuid> |
null }`.

### `GET /api/ad-attribution/performance?since&until&practice_id`

The channel scorecard. `practice_id` omitted (or the shared ScopePeriod's
`scope=all`) returns the group view; a UUID scopes every block below except
`excludedUnmappedLeads` and `unmappedPipelineCount` to that one practice.

```
{ channels[], totals, byPractice[], trend[], excludedUnmappedLeads,
  unmappedPipelineCount, groupOnlySpendPence }
```

This endpoint deliberately reports EVERY synced `ad_metrics` row, without the
`is_selected` account filter or the revoked-provider gating the Marketing
screens apply (`integration.repository.js` / `integration-gating.js`). If an
owner deselects a legacy ad account, or an ad provider integration is
revoked, Marketing's spend figures drop while this endpoint's do not — the
two surfaces will disagree in that case. Whether to apply the same gating
here is a separate product decision; this note only makes the divergence
explicit.

- `channels[]` — one row per `google_ads` | `meta_ads` | `unassigned`: `{
  channel, leads, conversions, acceptedValuePence, spendPence,
  costPerLeadPence, costPerAcquisitionPence, conversionRate }`. **`leads`
  counts people** (`contact_id`, or the lead id when absent), not pipeline
  rows — one person sitting in two pipelines of the same channel is one lead.
  `spendPence` and everything derived from it is `null` — never `£0` — for
  `unassigned` (no spend feed exists) and for any channel whose spend for the
  window accumulated to exactly `0` (indistinguishable, on the wire, from "no
  feed connected"; see FORMULAS §18).
- `totals` — the group's (or the scoped practice's) reach **deduped per person
  across all three channels**, plus `paidLeads`/`paidConversions` (the same
  dedup restricted to `google_ads`+`meta_ads`). Summing `channels[]`'
  `leads`/`conversions` overstates this figure whenever a person is tagged
  under two channels; `totals` is the correct one to show as "total leads".
  `totals.costPerLeadPence`/`costPerAcquisitionPence` divide by `paidLeads`/
  `paidConversions`, NOT by `totals.leads`/`totals.conversions` — an
  `unassigned` lead cost nothing to acquire. `totals.conversionRate` is the
  one exception: it deliberately uses `totals.conversions / totals.leads`
  (all-channel), since it is a funnel rate over everyone attracted, not a
  paid-media cost metric. Both cost metrics on `totals` are forced `null` if
  either paid channel has leads but no accumulated spend — a reporting
  channel's spend must never be charged against a non-reporting channel's
  leads. See FORMULAS §18 for a fully worked example.
- `byPractice[]` — `{ practiceId, practiceName, channels[], total, trend[] }`,
  same shapes as above, scoped to that practice. Only practices with at least
  one mapped-subaccount lead **or** any spend on a practice-mapped ad account
  in the window appear.
- `trend[]` — monthly series (`{ month, channels[] }`), `google_ads`/
  `meta_ads` only. **Dedupes per person per MONTH**, not per person across the
  whole window like `channels[]`/`totals` — a person enquiring in two
  different months is one lead in the scorecard but two across `trend[]`. The
  months are therefore deliberately not additive back to the scorecard totals.
- `excludedUnmappedLeads` — count of lead **rows** on a GHL subaccount with no
  practice mapping; excluded from every block above rather than folded into
  the group. (Opportunity-row count before any dedup, so contrast with
  totals.leads which is a person-level count.)
- `unmappedPipelineCount` — how many pipelines, across subaccounts mapped to a
  practice only, have no row in `ad_channel_pipelines` (Unassigned), for a
  settings-page nudge. A subaccount with no practice mapping (the
  academy/accounting Location) is excluded entirely from this feature, so its
  pipelines never count here — they could never legitimately be mapped.
- `groupOnlySpendPence` — total spend, across all channels, on rows whose ad
  account did NOT resolve to a practice (i.e. `ad_accounts.practice_id` is
  null for that `customer_id`). `channels[]`/`totals` spend sums EVERY spend
  row regardless of mapping, but each `byPractice[]` entry only accumulates a
  row when its account maps to that practice — so whenever some ad accounts
  are mapped and others are not (the normal in-between state while an owner
  maps accounts one at a time), group spend and the sum of `byPractice[]`
  spend differ by exactly this amount, and `byPractice[]` spend will not sum
  back to the group figure while it is non-zero. It is a real sum over rows
  that exist, so it is always a number, never null; `0` correctly means
  "everything attributed". Always the group-wide figure regardless of the
  `practice_id` query parameter — it describes the org's mapping state, not
  any one practice's spend.

### `GET /api/ad-attribution/leads?since&until&channel&practice_id&limit`

The people behind a number, in the shared `LeadsTable` shape: `{ leads: [{ id,
contactId, name, email, phone, channel, pipelineName, createdAt, converted,
matchedTreatmentName, matchedValuePence }] }`. One row per person **per
channel** (same `contact_id`-or-lead-id dedup as the scorecard, scoped to the
selected channel); a lead on an unmapped subaccount is excluded. `channel`
filters to one of `google_ads` | `meta_ads` | `unassigned`; omitted returns
all three. `limit` applies to the returned deduped rows and defaults 500.

Each row also carries `personKey` (the identity used to dedupe per person — contact id, or `lead:<id>` when there is no contact), `practiceId`, `practiceName`, `matchedPatientName` and `matchedAcceptedDate`.

### `GET /api/ad-attribution/mapping-health`

Roles: `owner`, `practice_manager`. No query parameters — deliberately group-wide, not narrowed by practice.

Returns every ad account, GoHighLevel subaccount and Emergent business with the practice it maps to, plus a `summary` of what is unmapped. `mapped` is `practiceId !== null`. `practiceName` is null when unmapped. `summary.pipelinesUnmapped` counts pipelines with no channel, excluding subaccounts that have no practice (academy/accounting Locations), matching the `unmappedPipelineCount` returned by `/performance`.

Each entry in `adAccounts[]` also carries per-account feed health, because a mapped account can still have a dead data feed — mapping completeness and feed health are different questions. `lastMetricDate` is the most recent `ad_metrics.metric_date` for that account (`string | null`; null means the account has never delivered a single metric row). `daysStale` is `null` when `lastMetricDate` is null — an account that has never reported is unknown staleness, never `0` standing in for it. `feedStatus` is `'reporting'`, `'stale'` (`daysStale >= FEED_STALE_AFTER_DAYS`, currently 7 days — both connectors sync nightly, so a week's silence is well beyond normal jitter) or `'no-data'` (no `ad_metrics` row has ever been seen for the account). `summary` gains `adAccountsStale` and `adAccountsNoData` counting each state; a never-reported account counts only in `adAccountsNoData`, not `adAccountsStale`. `ad_accounts.period_synced_at`/`period_window_end` are deliberately NOT used for any of this — those columns record that a sync ran and the window it asked for, not what data actually came back, so a feed that stopped delivering months ago can still show a recent `period_synced_at`.

### `GET /api/ad-attribution/spend`

Roles: `owner`, `practice_manager`. Query: `since`, `until`, optional `practice_id`.

Returns `byAccount[]` and `byCampaign[]` (both sorted by `spendPence` descending) plus `unattributedSpendPence`. Money is integer pence.

Practice attribution comes from joining `ad_metrics.customer_id` to `ad_accounts.practice_id` — `ad_metrics.practice_id` is null on every row and is not used. `unattributedSpendPence` is spend on a `customer_id` with no matching `ad_accounts` row; group-wide (no `practice_id` filter) it is `0`, never null, because it is a real sum. Under a `practice_id` filter it is `null`, not `0` — the loop deliberately never accumulates unattributed spend into a practice-scoped view (spend that cannot be tied to any account certainly cannot be tied to one practice), so a `0` there would falsely read as "everything attributed" when group-level unattributed spend may still exist; `null` means "not known/not applicable" here, per the project rule that `null` — never `0` — signals an unknown figure. `reach` and `frequency` are deliberately not returned: they cannot be summed across days.

This endpoint deliberately reports EVERY synced `ad_metrics` row, without the
`is_selected` account filter or the revoked-provider gating the Marketing
screens apply (`integration.repository.js` / `integration-gating.js`). If an
owner deselects a legacy ad account, or an ad provider integration is
revoked, Marketing's spend figures drop while this endpoint's do not — the
two surfaces will disagree in that case. Whether to apply the same gating
here is a separate product decision; this note only makes the divergence
explicit.
