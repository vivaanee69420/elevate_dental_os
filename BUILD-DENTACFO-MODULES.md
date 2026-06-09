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

### Phase 4 — Exit Plan (full personal-wealth model)  ✅ DONE
Scope clarification: the demo's surviving `_3` "Exit Plan" (`planExit`) is the BUSINESS-exit valuation planner = already-shipped Sale Planner (`planExitTrajectory`/`/compute/valuation/exit-plan`). The `_2` personal 4% source is gone. Phase 4 is the PERSONAL-wealth FIRE model (the `FirePlanScreen` that was on mock). User chose the FULL option: a personal net-sale-proceeds waterfall feeds net worth.
- [x] NEW `lib/formulas.calculateSaleWaterfall` — EV → clear debt → equity split by `ownerSharePct` → UK CGT (BADR 18% to £1m lifetime cap, 24% above) → + freehold equity = net cash. Constants `UK_TAX` (accountant-repointable). (Did NOT extend `planExitTrajectory` — that's the separate business Sale Planner; a personal waterfall is the right home.)
- [x] NEW `lib/formulas.calculateFirePlan` — net worth (liquid assets + business net proceeds − liabilities) vs FIRE number (`spend/withdrawalRate`, 4%→25×), progress, years-to-FIRE solve, FV-annuity path, required-savings solve. `FIRE_DEFAULTS`.
- [x] tests: `test/formulas-exit-plan.test.mjs` (14) + `test/wealth.service.test.mjs` (5); FORMULAS.md §Exit Plan
- [x] migration **000061 wealth_inputs** (org-scoped JSONB personal balance sheet + fire/sale assumption blobs; RLS; one row/org) — applied on hosted, schema reloaded
- [x] `wealth.model.js` (zod) + `wealth.repository.js` (get/upsert) + `wealth.service.js` (getInputs/saveInputs/netWorth/exitPlan + pure computes; EV from live valuation midpoint, manual fallback) + `wealth.controller.js`
- [x] rewrote `wealth.routes.js` (was a `business_health` stub) → GET/PUT `/inputs`, GET `/net`+`/fire`, POST `/compute/{sale-waterfall,fire}`. Reads gated `wealth.view`; PUT owner-only; `/compute` audit-exempt. API.md §Wealth updated.
- [x] frontend `wealth-api.ts` + `wealth-hooks.ts`; wired `FirePlanScreen` (live plan + editable persisted FIRE/sale assumptions + waterfall panel) and `NetWorthScreen` (editable persisted balance sheet) off mock. Page/nav/route-perm already existed (`wealth-*`, `wealth.view`).
- Verified: backend `npm test` = 641 pass; frontend `tsc --noEmit` + `next lint` clean.
- NOTE: Pension + Property screens still on mock `features/wealth/data.ts` (out of phase scope; their data has no synced source). Freehold treated as already net of its mortgage/property-tax — documented simplification, flagged in UI.

### Phase 5 — Data Quality Engine  ✅ DONE
Reads ONLY data already in the warehouse (appointments / invoices / integrations) — no new integration, no new page (lands on the existing Data Hub).
- [x] migration **000062 data_quality** — RPC `data_quality_by_practice(p_org)` returns per-practice defect counts in ONE query (appointments is 100k+ rows/org; JS scan too heavy). Mirrors the `*_rollup_by_practice` RPCs (security definer, granted service_role+authenticated). Applied on hosted, schema reloaded.
- [x] `analytics.repository.js`: `dataQualityByPractice(orgId)` (RPC) + `connectorStates(orgId)` (integrations table)
- [x] `analytics.service.dataQuality(orgId)` — per-practice cleanliness score (weighted, dimension-renormalised: coded 0.30 / linked 0.30 / invoice-match 0.20 / collection 0.20), record-volume-weighted org rollup, RAG (≥90/≥70), connector staleness classifier + prioritised alert list. Pure module-scope helpers (`scoreCleanliness`/`scoreConnectors`/`buildDataQualityAlerts`). `associate_id` is FLAGGED not scored (null on every synced Dentally appt — data wall; would crater every score).
- [x] controller `dataQuality` + route `GET /api/analytics/data-quality` (gate: **`system.manage`** — matches the Data Hub page, not finance.view); `docs/API.md` updated
- [x] frontend: `features/system/data-quality-api.ts` + `data-quality-hooks.ts` + `DataQualityPanel.tsx` (org score + action queue + connector-health table + per-practice cleanliness table), mounted at top of the existing `DataHubScreen`. No new page/nav/route-perm (Data Hub already exists, gated `system.manage`).
- [x] test `test/analytics-data-quality.test.mjs` (6 cases: perfect score, dimension renormalisation, red-flag + worst-first ordering, connector staleness/error, the all-unassigned data-wall flag, empty org)
- Verified: backend `npm test` = 658 pass; backend typecheck clean; frontend `tsc --noEmit` + `next lint` clean.
- NOTE: scoring weights + connector staleness budgets (Dentally/GHL 36h, Xero/QB 48h) are module constants, easy to retune. No money math → no formulas.js change / no FORMULAS.md entry.

### Phase 6 — Attrition & Retention  ✅ DONE
Reads ONLY data already in the warehouse (appointments + settled receipts) — no new integration, no new page (lands on the existing Loyalty page).
- [x] confirmed last-visit source = `appointments.starts_at` + `status` (no Dentally re-sync needed); patient identity = `COALESCE(contact_id, pms_patient_id)` per the linkage data wall (appts with neither id are flagged, not cohorted)
- [x] migration **000063 patient_retention** — RPC `patient_retention_by_practice(p_org, p_now)`: per-practice active (<12mo) / lapsed (12-24mo) / dormant (>24mo) cohorts by each patient's most recent non-cancelled past visit, attributed to that visit's practice, in ONE query (appointments is large; per-patient max() can't go JS-side). Mirrors the `*_rollup_by_practice` RPCs. Applied + smoke-tested on hosted, `NOTIFY pgrst,'reload schema'` run.
- [x] `lib/formulas.calculateRetention(cohorts, opts)` + `RETENTION_DEFAULTS` (reactivationRate 0.25) — retention/attrition rates + reactivation pool = lapsed × avgPatientValue × rate (lapsed only; dormant excluded). +6 formula tests + FORMULAS.md §Attrition & Retention.
- [x] `analytics.repository.patientRetentionByPractice(orgId, nowISO)` (RPC); reused `settledRevenueByPractice` (trailing 12mo) for avg patient value.
- [x] `analytics.service.retention(orgId, {scope, reactivationRate, now})` — scope-aware (academy/lab not-applicable), per-practice cohorts + avg-value join (org-blended fallback when a practice has revenue but no active patients), org rollup + RAG, prioritised insights, unlinked-appt data-wall flag. Pure helpers `retentionRagBand`/`buildRetentionInsights`. +6 service tests.
- [x] controller `retention` + route `GET /api/analytics/retention?scope&rate` gated **`growth.view`** (recall/marketing metric, same gate as the Loyalty page — NOT finance.view). API.md updated.
- [x] frontend: `features/growth/retention-api.ts` + `retention-hooks.ts` + `RetentionPanel.tsx` (cohort KPI strip + insights + per-practice table + data-wall note), mounted on the existing `LoyaltyScreen` (no new page/nav/route-perm — Loyalty already gated growth.view).
- Verified: backend `npm test` = 676 pass; backend typecheck + frontend `tsc --noEmit` + `next lint` clean.
- NOTE: reactivation rate is a module default (0.25), overridable via `?rate=`. A "visit" = a past appointment not cancelled (completed/confirmed-past/in_progress/no_show all count). No COST math → reactivation value is recoverable patient FEE, not margin.

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
- 2026-06-09 — **Phase 5 (Data Quality Engine) COMPLETE.** Per-practice cleanliness score + connector health + prioritised alerts, all from data already in the warehouse (appointments/invoices/integrations) — no new integration, no new page. Backend: migration **000062** (RPC `data_quality_by_practice`, hosted) + repo (`dataQualityByPractice`/`connectorStates`) + `analytics.service.dataQuality` (weighted dimension-renormalised score, RAG, connector staleness, alert list; pure module helpers) + controller + route `GET /api/analytics/data-quality` (**`system.manage`**) + 6 tests. Frontend: `data-quality-api.ts`+`-hooks.ts`+`DataQualityPanel` mounted on the existing Data Hub page. `associate_id` flagged not scored (data wall). 658 backend tests pass; backend typecheck + frontend tsc + lint clean. API.md updated. Next: Phase 6 (Attrition & Retention).
- 2026-06-09 — **Phase 6 (Attrition & Retention) COMPLETE.** Per-practice patient cohorts (active <12mo / lapsed 12-24mo / dormant >24mo) by last-visit recency + the recoverable reactivation revenue pool, all from data already in the warehouse (appointments + settled receipts) — no new integration, no new page. Backend: migration **000063** (RPC `patient_retention_by_practice(p_org, p_now)`, hosted + smoke-tested on real data) + `calculateRetention`/`RETENTION_DEFAULTS` (+6 formula tests) + repo (`patientRetentionByPractice`) + `analytics.service.retention` (scope-aware cohorts + avg-value join + org rollup + insights + data-wall flag; pure helpers `retentionRagBand`/`buildRetentionInsights`) (+6 service tests) + controller + route `GET /api/analytics/retention` (**`growth.view`**). Frontend: `retention-api.ts`+`-hooks.ts`+`RetentionPanel` mounted on the existing Loyalty page. Patient identity = COALESCE(contact_id, pms_patient_id); appts with neither id flagged, not cohorted. 676 backend tests pass; backend typecheck + frontend tsc + lint clean. FORMULAS.md §Attrition & Retention + API.md updated. Next: Phase 7 (Open Banking — GoCardless, the ONE new integration).
- 2026-06-09 — **Phase 4 (Exit Plan, full personal-wealth model + sale waterfall) COMPLETE.** Personal FIRE model wired live (was mock). NEW `calculateSaleWaterfall` (debt → equity split → UK CGT BADR 18%/£1m cap then 24% → freehold = net cash; `UK_TAX` constants) + `calculateFirePlan` (net worth vs 4%-rule FIRE number + path + required-savings solve; `FIRE_DEFAULTS`). 14 formula + 5 service tests. Migration **000061 wealth_inputs** (org-scoped JSONB balance sheet, hosted). Full backend stack (model/repo/service/controller) + rewrote `wealth.routes.js` stub → GET/PUT `/inputs`, GET `/net`+`/fire`, POST `/compute/{sale-waterfall,fire}` (reads `wealth.view`, write owner-only). EV pulled from the live valuation midpoint. Frontend `wealth-api.ts`+`wealth-hooks.ts`; `FirePlanScreen` + `NetWorthScreen` off mock (editable, persisted). Pension/Property screens left on mock (out of scope). 641 backend tests pass; tsc + lint clean. FORMULAS.md §Exit Plan + API.md §Wealth updated. Next: Phase 5 (Data Quality Engine).
