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

### Phase 2 — Board Report Generator  ✅ DONE
- [x] `lib/claude.js` `generateBoardReport(bundle)` — AI exec summary + RAG priorities (throws on no key → deterministic fallback)
- [x] `analytics.service.boardReport()` — assembles metrics from live `businessHub` + `revenueLeakage` rollups; `boardReportFallback()` deterministic pack; `renderBoardReportHtml()` SES email body
- [x] `analytics.service.emailBoardReport()` (SES send, `{sent:false}` not an error) + schedule CRUD wrappers; `boardReport.repository.js` (+ pure `isScheduleDue`)
- [x] migration `000060_board_report_schedules` (applied on hosted, schema reloaded)
- [x] routes: `POST /board-report`, `POST /board-report/email` (finEdit), `GET/POST/PATCH/DELETE /board-report/schedules`; `docs/API.md` updated
- [x] worker cron (daily 06:30 Europe/London) — sends due schedules, stamps `last_sent_at`
- [x] frontend: `BoardReportScreen.tsx` + `board-report-api.ts` + `board-report-hooks.ts` + `app/(dashboard)/board-report/page.tsx` + nav (Command section) + `ROUTE_PERMISSION['board-report']`; Generate (button, token cost) → exec summary + RAG priorities + KPIs, Export PDF (print), Send now (SES → mailto fallback), Schedule list
- [x] test `test/board-report.test.mjs` (7 cases: isScheduleDue cadence, claude throws no-key, service assembly + fallback + empty)
- Verified: backend `npm test` = 613 pass; frontend `tsc --noEmit` + `next lint` clean.
- NOTE: email-now sends via SES directly to a free-text address (not the notification outbox) — matches the demo's arbitrary-recipient intent; falls back to a client mailto draft when SES is unconfigured.

### Phase 3 — M&A Acquisition Modeller (buy-side)  ✅ DONE
- [x] `lib/formulas.js`: `calculateAcquisition(input)` + `ACQUISITION_BENCHMARKS` → EBITDA, EV, NPV, IRR (bisection), payback, debt capacity, equity required, asking-price premium, red flags. Faithful port of the demo's `mnaCalc` in integer pence.
- [x] unit test `test/formulas-acquisition.test.mjs` (9 cases, green) + `docs/FORMULAS.md` §M&A
- [x] model `acquisitionSchema` + service `computeAcquisition` + controller `acquisition` + route `POST /api/analytics/compute/acquisition` (valuation.view). **Used the `/compute/` path (audit-exempt, slider-driven recompute), not the `/acquisition` originally sketched.** `docs/API.md` updated.
- [x] frontend: `acquisition-api.ts` + `acquisition-hooks.ts` (debounced `useAcquisition`) + `MnaTab` added as a third tab on the existing `ValuationScreen` (no new page/nav/route-perm — Valuation page already gated `valuation.view`). Inputs grid + multiple/leverage sliders + 6 KPI cards (EV/NPV/IRR/Payback/Debt/Equity) + asking-price gap + red-flag list + benchmark note.
- Verified: backend `npm test` = 622 pass; frontend `tsc --noEmit` + `next lint` clean. No new integration, no migration.
- NOTE: pure compute, no persistence (Arch #3). Terminal exit re-applies the entry multiple; cashflows = EBITDA grown at the revenue-growth rate. Sell-side (Current/Sale Planner) tabs untouched.

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
- 2026-06-09 — **Phase 2 (Board Report Generator) COMPLETE.** AI exec summary + RAG priorities from live `businessHub`+`revenueLeakage` rollups (Claude, deterministic fallback). Backend: claude fn + service (generate/email/schedule CRUD) + repo + controller + 6 routes + migration 000060 (hosted) + worker cron + 7 tests. Frontend: api + hooks + BoardReportScreen (generate / PDF print / send-now SES→mailto / schedule list) + page + nav + route-perm. No new integration. 613 backend tests pass; tsc + lint clean. API.md updated. Next: Phase 3 (M&A Acquisition Modeller).
- 2026-06-09 — **Phase 3 (M&A Acquisition Modeller, buy-side) COMPLETE.** Faithful pence port of the demo's `mnaCalc` + buy-side red flags. Backend: `calculateAcquisition`/`ACQUISITION_BENCHMARKS` + 9 tests + `acquisitionSchema` + service `computeAcquisition` + controller + route `POST /compute/acquisition` (valuation.view, audit-exempt). Frontend: `acquisition-api.ts` + `acquisition-hooks.ts` + `MnaTab` as a third tab on the existing ValuationScreen (no new page/nav/route-perm). No new integration, no migration. 622 backend tests pass; tsc + lint clean. FORMULAS.md §M&A + API.md updated. Next: Phase 4 (Exit Plan full personal-wealth model).
