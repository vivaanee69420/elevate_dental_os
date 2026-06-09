# Build Tracker — DentaCFO Feature-Gap Modules

> Note: named `BUILD-DENTACFO-MODULES.md` because `TASKS.md` already exists (the durable work log; macOS filesystem is case-insensitive so `tasks.md` == `TASKS.md`). This is the dedicated tracker for porting the demo's missing modules.

Source: `GM-Group-Intelligence-OS_2.html` (standalone GM Dental demo). Its **New Modules** roadmap audits 24 feature areas vs a "DentaCFO" platform; its **Exit Plan** is a personal-wealth / 4%-rule model. This file ports the missing/partial pieces into the real multi-tenant app (`backend/` Express + `frontend/` Next.js).

## Context — gap analysis result (vs current Dental-os codebase)

Of 24 prototype feature areas (1 is N/A — pricing/GTM):

- **Fully built (10):** Group Overview, Clinician Performance, Treatment Profitability, Dentally/PMS, Marketing, AI Analyst, Owner Command Centre, Task & Accountability, RBAC, Academy/LMS.
- **Partial (8):** Individual Practice Dash, Xero/QB integration, M&A/Valuation (sell-side only), Practice Manager Portal, Benchmarking, Treatment Acceptance, Practice Sites admin, Exit Plan (FIRE UI exists on mock data).
- **Missing (4):** Revenue Leakage, Open Banking, Board Report Generator, Data Quality Engine. (+ Attrition & Retention = partial, loyalty only.)

Weighted coverage ≈ 61%. Two areas the real app is AHEAD of the demo: RBAC + Academy LMS (demo tags these "new").

Architecture rules to honour (from CLAUDE.md): layered `routes → controllers → services → repositories → models`; native ESM; money in **integer pence**; every business table has `organisation_id` + manual `.eq('organisation_id', orgId)` on serviceClient path; new formulas → update `docs/FORMULAS.md` + unit test; new endpoint → update `docs/API.md`; British English UI; no dark mode; no emojis in UI; audit every mutation.

## Integrations required

| Module | New 3rd-party integration? | Reuses |
|---|---|---|
| Revenue Leakage | **No** | Dentally appts/invoice_items/treatment_plans/payments (already synced); analytics.repository rollups |
| Board Report Generator | **No** | Claude (`lib/claude.js`), email (Postmark/SES `notification.service`), PDF client-side |
| M&A Acquisition Modeller | **No** | pure calc in `lib/formulas.js` |
| Exit Plan (full 4% model) | **No** | `planExitTrajectory` already in `lib/formulas.js`; valuation midpoint |
| Data Quality Engine | **No** | reads existing Dentally + Xero sync state |
| Attrition & Retention | **No** (but needs Dentally patient-level recall/last-visit fields) | Dentally; may need re-sync per `dentally-appt-contact-linkage-gap` memory |
| **Open Banking** | **YES — new provider** | TrueLayer *or* GoCardless Bank Account Data (Nordigen); OAuth, encrypted secrets via `lib/crypto.js`, pattern mirrors existing Xero/GHL OAuth |

**Net: only 1 brand-new integration (Open Banking).** All others compute from data already in the warehouse.

## Phases

Order follows the demo's own verdict (highest ROI / lowest cost first).

### Phase 1 — Revenue Leakage  ✅ DONE
Commercial hook: "here's £X/yr you're losing → one-click task". Pure compute.
- [x] `lib/formulas.js`: `calculateRevenueLeakage(input, rates)` (pence) — plans/FTA/recall/lapsed/collect pools + `LEAKAGE_DEFAULT_RATES`
- [x] unit test `test/formulas-leakage.test.mjs` (7 cases, green) + `docs/FORMULAS.md` entry
- [x] `analytics.repository.js`: `treatmentPlanValueByStatus()` (presented vs accepted); reused settled-revenue / appt-rollup / settled-receipts
- [x] `analytics.service.js`: `revenueLeakage(orgId, {days, since, until, rates})` — annualised by window length, per-line owner metadata
- [x] controller `leakage` + route `GET /api/analytics/leakage` (gate: `finance.view`); `docs/API.md` updated
- [x] frontend: `RevenueLeakageScreen.tsx` + `leakage-api.ts` + `leakage-hooks.ts` + `app/(dashboard)/leakage/page.tsx` + nav (Finance section) + `ROUTE_PERMISSION.leakage`
- [x] "＋ Task" button → POST `/api/tasks` via existing `createTask` (Owner-only, 403-safe)
- Verified: backend `npm test` = 606 pass (71 files); frontend `tsc --noEmit` = 0 errors.
- NOTE: recall + lapsed pools are modelled shares of revenue (hygiene 12%, lapsed 6%) — flagged in UI; exact figures need patient-level Dentally cohorts (see Phase 6).

### Phase 2 — Board Report Generator
- [ ] service: assemble exec summary (Claude) + RAG priorities from live analytics
- [ ] route `POST /api/analytics/board-report` (finance.view); reuse notification.service for email
- [ ] frontend Reports panel on Business Hub / AI Insights; PDF via print
- [ ] schedule (daily/weekly/monthly) — reuse workers cron

### Phase 3 — M&A Acquisition Modeller (buy-side)
- [ ] `lib/formulas.js`: `calculateAcquisition(inputs)` → EV, NPV, IRR, payback, debt capacity, red flags
- [ ] unit test + FORMULAS.md
- [ ] route `POST /api/analytics/acquisition` (valuation.view)
- [ ] extend ValuationScreen with buy-side tab

### Phase 4 — Exit Plan (full personal-wealth model)
- [ ] verify/extend `planExitTrajectory` (tax gross-up, freehold rent, sale waterfall, multi-person split)
- [ ] confirm/add endpoint for `computeValuationExitPlan`
- [ ] wire `FirePlanScreen` off mock → live model + inputs persistence

### Phase 5 — Data Quality Engine
- [ ] service: per-practice cleanliness score + alerts (uncoded appts, unmatched invoices, low collection)
- [ ] route `GET /api/analytics/data-quality`
- [ ] frontend panel under Settings/Data Hub + connector health

### Phase 6 — Attrition & Retention
- [ ] confirm Dentally fields for last-visit/recall; flag re-sync if absent
- [ ] service: active vs lapsed (>12mo) cohorts + reactivation value
- [ ] route + frontend panel (next to Lead Funnel / Loyalty)

### Phase 7 — Open Banking (NEW INTEGRATION)
- [ ] pick provider (TrueLayer vs GoCardless BAD) — DECISION NEEDED
- [ ] migration: `bank_connections` + `bank_balances` tables (org-scoped)
- [ ] connector in `lib/integrations/`, OAuth routes, encrypted secrets
- [ ] service: live balance + cash-movement + missed-payment alerts
- [ ] frontend: Cashflow & Runway panel

## Build log

- 2026-06-09 — Created tracker. Gap analysis done. Starting Phase 1 (Revenue Leakage).
- 2026-06-09 — **Phase 1 (Revenue Leakage) COMPLETE.** Backend: formula + 7 tests + repo method + service + controller + route. Frontend: api + hook + screen + page + nav + route-perm. No new integration. 606 backend tests pass, frontend tsc clean. Docs (FORMULAS.md §Revenue Leakage, API.md) updated. Next: Phase 2 (Board Report Generator).
