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
  "organisation_name": "..."
}
```

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

### `GET /api/health/snapshots`
Historical snapshots ordered chronologically.

### `POST /api/health/snapshots` *(owner-only)*
Manually capture a snapshot.

### `GET /api/health/metrics`
Returns the unified business-health metric array. Each item:
`{ key, label, cat, unit, better, sourceType, source, asof, needsInput, baseline, current, target, progressPct, deltaFromBaselinePct }`.
`current` is live-computed for `sourceType: auto` (revenue/profit/margin/cash from analytics actuals; conversion/no-show from rollups) and read from the manual store for `sourceType: manual`. Reception receives `{ metrics: [] }`.

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
Paginated (default 25/page, max 100), ordered by `starts_at` asc. Returns `{ appointments, total, page, per_page }`. Optional `practice_id` / `associate_id` filters. Each appointment includes joined `contact`/`practice`/`associate`.
### `POST /api/appointments` — create
### `PATCH /api/appointments/:id` — reschedule/cancel

## Chair utilisation (manual)  — owner / practice_manager

- `GET  /api/chair-utilisation?practice_id=<uuid>` — list manual records.
- `GET  /api/chair-utilisation/grid?practice_id=<uuid>` — aggregated weekday×slot heatmap
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

## Analytics

### `GET /api/analytics/dashboard` — main dashboard rollup
### `GET /api/analytics/pl` — Profit & Loss using formulas.calculatePL()
### `GET /api/analytics/pl-benchmark?practice_id=<uuid>` — Profit Benchmarking (Intelligence OS — CoA→P&L). Actual cost/profit ratios vs the UK dental group benchmarks (Dentist 45 · Staff 18 · Lab+Material 15 · Other Fixed 12 · Profit 10), from `formulas.calculateProfitBenchmark`. Returns `{ rows:[{key,label,benchmarkPct,benchmarkPence,actualPence,actualPct,variancePts,good,severity,verdict}], overspendPence, dentistStaffSeparable, marginPct, netProfit, totalCosts, costsAvailable, basis, periodsCovered }`. **Real `monthly_financials` actuals only — never the baseline** (Finance screen, FORMULAS §1a/§1b); no cost source ⇒ `costsAvailable:false`, no rows. `dentistStaffSeparable:false` flags Xero folding associate pay into staff. finance.view.
### `GET /api/analytics/valuation` — 3-model valuation
### `GET /api/analytics/kpis` — 23-metric scorecard with traffic lights
### `GET /api/analytics/business-hub?days=90` — group + per-practice rollup (Business Hub): revenue (settled payments), appointments/no-show (appointments), conversion (leads), group margin/target from business_health baseline. finance.view.
### `GET /api/analytics/compute/treatment-models` — seed workbench models (fullarch/implant/invisalign), pence. finance.view. Pure read.
### `POST /api/analytics/compute/treatment-economics` — Treatment Economics Workbench (Intelligence OS). Body = a treatment model (`treatmentModelSchema`, all money pence). Returns the full money flow from `formulas.computeServiceEconomics`: gross/clinician/practice/group profit, marginPct, target-price solver, max-ad/CAC, monthly+annual, principal-vs-associate. **Pure compute — no persistence, audit-exempt** (`/compute/` path), so debounced slider recompute (Arch #3) doesn't spam audit_log. finance.view.
### `POST /api/analytics/compute/valuation` — Group Valuation (Intelligence OS — Value & Growth). Body = the driver state (`valuationStateSchema`: `reportedEbitdaPence`, `addBacksPence`, `principalSalaryPence`, the three multiples, `regionFactor`, `growthRatePct`). Returns `{ result, levers }` from `formulas.computeGroupValuation` + `valueUpliftLevers`: the three buyer valuations (principal/associate/dso), midpoint, strategic, EBITDA build-up, and six ranked value-uplift levers — all pence. Server-authoritative successor to `GET /valuation` (legacy §2 left untouched; EBITDA reconciled — explicit add-backs, no fabrication; FORMULAS.md §13). **Pure compute — no persistence, audit-exempt** (`/compute/` path). valuation.view.
### `POST /api/analytics/compute/valuation/exit-plan` — Sale Planner (Intelligence OS — Value & Growth). Body = `valuationExitPlanSchema` (`base`, `baselinePence`, `principalSalaryPence`, `plan`). Returns `formulas.planExitTrajectory`: projected exit value, gap, required CAGR, EBITDA needed, current/future margins, and a year-by-year revenue/EBITDA/sites/value trajectory — all pence. Per-year advisory copy is computed client-side. **Pure compute — audit-exempt** (`/compute/` path). valuation.view.
### `GET /api/analytics/treatment-matrix?scope=all&period=month&pk=2026-05` — Treatment Mix heat matrix (Intelligence OS, Phase 2). Appointment VOLUME by treatment type × practice for the selected scope + period (`treatment_mix_matrix` RPC; paginated JS fallback when absent). `scope` = all|practices|academy|lab|<practiceUUID> (resolveScope; academy/lab → `{applicable:false}`). `period`/`pk` give the window: `month`+`YYYY-MM` = whole calendar month; `day`+`YYYY-MM-DD` = one day (defaults to current month). Returns `{ applicable, scope, period, window:{since,until,label}, practices:[{id,name,total}] (columns, vol desc), types:[{type,total,sharePct,isOther,cells[]}] (rows: top-12 + one 'Other treatment types' tail), distinctTypes, grandTotal, maxCell, insights:[{tone,title,body}], note }`. `cells[]` align to `practices` order; `maxCell` (excludes the Other tail) drives HeatCell intensity. **VOLUME ONLY — Dentally appointments carry no price (data wall), so there is no £/revenue here; insights are volume-framed (top treatment, single-site concentration, busiest practice, Pareto breadth).** finance.view.

### `GET /api/analytics/treatment-fee-benchmarks?months=12` — Real case-fee benchmarks for the Treatment Economics Workbench (Intelligence OS). Per workbench category (`fullarch`/`implant`/`invisalign`), the mean INVOICE total for invoices that contain that procedure, from `invoice_items` over a trailing window (`invoice_case_rollup` RPC + `formulas.classifyCaseFees`). A dental case is billed across many line items, so the honest case fee is the invoice-level total, not a single line. Returns `{ windowMonths, invoicesAnalysed, benchmarks: { fullarch|implant|invisalign: { feePence, sampleSize } | null } }` — `null` per category when no matching invoices (the workbench then keeps its hardcoded default). **Patient FEE only — lab/CBCT/component COST is never in the Dentally feed and stays owner-entered.** finance.view.

### `GET /api/analytics/treatment-revenue?scope=all&period=month&pk=2026-05` — Treatment REVENUE heat matrix (Intelligence OS, Phase 2). The £ counterpart to `treatment-matrix`: real invoiced FEE by treatment name × practice, from `invoice_items` (`treatment_revenue_matrix` RPC; paginated fallback). Same window/scope semantics + response shape as `treatment-matrix`, but `grandTotal`/`maxCell`/`types[].total`/`cells[]` are integer PENCE, rows keyed by `treatment_name`, plus `basis:'invoice_items'` and `hasData`. Insights are money-framed (top earner, single-site revenue concentration, busiest biller, revenue Pareto). `invoice_items` is populated by the Dentally sync (`/invoices` + `/invoice_items` pull). **This is the patient FEE (retail), NOT cost — lab/material cost is never in the Dentally feed and stays owner-entered in the Workbench.** finance.view.

### `POST /api/analytics/ai-ask` — AI Analyst (Intelligence OS). Body `{ scope, period, pk, question? }` (scope/period as elsewhere; `question` ≤500 chars, optional). £-ranked findings over the group's LIVE scope/period numbers, aggregated from the REAL Decision-Lens insights of the P&L / Marketing / Clinicians / Cash rollups (NO fabrication) plus cross-cutting headline facts (group margin, blended ROAS, cash). With a `question` AND `ANTHROPIC_API_KEY` set, Claude (sonnet-4-5) writes a natural-language `answer` grounded ONLY in a compact real summary; without a key it falls back to keyword-matched findings (`basis:'rollups'`, `note`). Returns `{ scope, period, question, answer:string|null, findings:[{sev:'good'|'warn'|'bad'|'info',t,d,v}] (ranked bad→info, ≤8), answerFindings?, basis:'rollups'|'claude', model, note? }`. Money in integer PENCE within findings text. finance.view.

### `GET /api/analytics/clinicians?scope=all&period=month&pk=2026-05` — Clinicians (Intelligence OS, T2). Per-clinician production, pay splits and NHS/UDA from REAL data: associate roster (names/`pay_pct`/`lab_split_pct`, basis points→%), per-associate completed production (`associate_production` RPC over `treatment_plans`), appointment activity (`associate_appointment_stats`), owner-entered NHS contract (`practices.nhs_contract_uda`/`nhs_uda_rate_pence`). `scope` = all|practices|<practiceUUID> (academy/lab → `{applicable:false}`); period→window. **HONEST DATA WALLS (no revenue-share fabrication):** `productionAvailable` false when treatment_plans aren't synced; `appointmentsAvailable` false when appointments lack a resolved associate_id; `nhs.completedAvailable` always false until the UDA treatment-plan feed lands; lab cost / OCPSPD per clinician have no real per-clinician source and are omitted. Returns `{ applicable, scope, period, window, productionAvailable, appointmentsAvailable, clinicians:[{id,name,role,practiceId,practiceName,active,payPct,labSplitPct,productionPence,feesPence,netToPracticePence,appointments,completed,noShows}], totalProductionPence, totalFeesPence, totalNetPence, nhs:{available,completedAvailable,practices:[{id,name,contractUda,udaRatePence}]}, insights:[{tone,title,body,value}], note }`. Money in integer PENCE. finance.view.

### `GET /api/analytics/marketing-roi?scope=all&period=month&pk=2026-05` — Marketing & ROI (Intelligence OS, T11). Per-channel acquisition economics from REAL sources: ad spend from `ad_metrics` (paid providers google_ads/meta_ads), channel attribution + conversions from CRM `leads`, revenue from settled payments. **HONEST DATA WALL: revenue is NOT attributable per channel (no per-touch attribution) — there is NO per-channel ROAS/revenue, only a business-level blended paid ROAS = settled revenue ÷ paid spend.** Per-channel ranks on spend → leads → CPL → patients → CPA. Conversions use ONE consistent definition across all channels: a CRM lead reaching `treatment_started`/`treatment_completed`. `scope`/`period`/`pk` per resolveScope + window. Returns `{ applicable, scope, period, window, connected (any ad rows), hasLeads, channels:[{key,label,color,paid,group,spendPence,impressions,clicks,leads,conversions,cplPence,cpaPence,leadSharePct,convRatePct}], paidSpendPence, totalLeads, totalConversions, settledRevenuePence, blendedRoas|null, blendedRoiPct|null, google, meta, revenuePerChannelAvailable:false, byPracticeAvailable, adSpendPerPracticeAvailable, byPractice:[{id,name,leads,conversions,convRatePct,revenuePence,spendPence,cpaPence,roas|null}], insights:[{tone,title,body,value}], note }`. Money in integer PENCE. `ad_metrics.practice_id` is usually NULL (one ad account per group) → an entity scope sees no paid spend (honest); per-practice ROAS only when ad spend is practice-tagged. finance.view.

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

> **Precedence (TODO1, resolved):** `pl_sheets` are a **scenario overlay only**. They are standalone planning/budget grids — they NEVER override the real actuals P&L (`pl`/`pl-margin` stay Xero > manual > zero) and NEVER feed EBITDA or the valuation. This preserves the "finance screen = real actuals or honest empty, never fabricated" guarantee. See FORMULAS.md §16.

**Real-data read path (exact, or zero — never estimated):**
- Revenue is **exact**, summed in Postgres via the `settled_receipts_by_day` RPC
  (avoids PostgREST's 1000-row cap that undercounts orgs with >1000 payments).
- `finance-series` — monthly revenue = exact settled payments (or
  `monthly_financials` revenue actual). Costs/profit = `monthly_financials`
  actuals when present, else **0** (not estimated). Per-month `costsAvailable`;
  response `costsAvailable`. `basis`: `actuals` | `mixed` | `revenue-only`.
  Always returns the full 12-month window.
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

### `GET /api/growth/booking?from=&to=&practice_id=`
Appointment-derived booking KPIs over the window. `{ booked_30d, completed_30d, no_show_30d, today, this_week, this_month, no_show_rate }`. `today` = calendar today (00:00–23:59), `this_week` = current Mon–Sun — both bounded BOTH ends and intersected with the window, so future-dated appts can't inflate them. `this_month`/`booked_30d` = the full window total.

### `GET /api/growth/recent-bookings?from=&to=&practice_id=&page=1&per_page=10`
Paginated appointments in the window (most-recent `starts_at` first). `{ bookings: [{ id, starts_at, status, service, deposit_pence, deposit_paid, patient, practice }], total, page, per_page }`. `service` (appointment_type), `deposit_pence`/`deposit_paid` are null/0/false for Dentally-synced rows (the PMS sends none). `patient` is null when the appointment has no linked contact.

### `GET /api/growth/patients`
`{ new_patients_30d, new_leads_30d, by_source }`.

### `GET /api/growth/marketing`
`{ leads_30d, revenue_pence_30d, by_provider }` (revenue = settled payments).

### `GET /api/growth/marketing/ad-spend?from=&to=`
Live ad spend & performance from connected marketing providers (Google Ads now;
Meta Ads next), read from `ad_metrics`. Org-scoped; window-aware via `from`/`to`
(else 30-day rolling). Account-level — `practice_id` is intentionally ignored
(ad spend isn't practice-attributed). All money in integer pence.
`{ connected, window:{from,to}, totals, channels[], campaigns[], daily[] }` —
each aggregate carries `{ spend_pence, impressions, clicks, leads, conversions,
ctr, cpc_pence, cpl_pence, cpa_pence, conversion_rate }`; `channels` add
`provider`, `campaigns` add `provider/campaign_id/campaign_name`, `daily` is a
per-date spend series for charting. `connected:false` when no rows in window.

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

### `GET /api/tasks?status=open&assigned_to=...`
### `POST /api/tasks`
### `PATCH /api/tasks/:id`

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

### `POST /webhooks/postmark/inbound`
Records inbound email as communication.

### `POST /webhooks/twilio/inbound`
Records inbound SMS as communication.

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

### `POST /api/integrations/:provider/refresh`
Forces an OAuth token refresh. For `gohighlevel`, guarded against concurrent
refresh (single-use token) via the `refresh_in_progress_at` claim; a non-claiming
caller returns `{ skipped: 'refresh_in_progress' }`.

### `POST /api/integrations/:provider/sync`
On-demand data pull for a connected provider (`dentally` | `xero` | `gohighlevel`).
Runs the provider's `syncOneOrg` now and returns its counts. The same pull also
fires automatically on connect (`finishConnect`), so a freshly-connected provider
has data without a manual refresh. 409 if the provider is not connected.

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

**Connect styles.** `dentally` (and `soe`) are `broker_key`: connect returns
`{ requiresKeyPaste, pasteHint }`; the owner pastes the Dentally Bearer token
(encrypted at rest). Dentally is pull-only — the token authenticates our polling
(`GET /v1/patients|appointments|payments`); Dentally does not push. Poll cadence:
every 2h in `workers/index.js`, plus first-pull-on-connect and on-demand `/sync`.

> GoHighLevel inbound sync (opportunities + contacts → leads/contacts) runs
> hourly in `workers/index.js`; not an HTTP endpoint.

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
