# GM Intelligence OS — Progress Tracker

Plan: `GM-INTELLIGENCE-OS-PLAN.md` (eng-reviewed 2026-06-05). Update after every task (status + date + commit).

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-06-06 (Frontend-first build of the 6 remaining views: Clinicians, AI Analyst, Day, Marketing & ROI, P&L & Margin + Value & Growth relabel)

---

## Phase 0 — Foundation (LANE A — blocks everything)
Branch: `feat/intelligence-os-phase0`
| Task | Status | Notes / commit |
|---|---|---|
| D1 DESIGN.md + green/gold token migration | [x] | globals.css + tailwind.config.ts swapped centrally; --ink-soft darkened for WCAG; tsc clean |
| T4 Shared components/ui primitives | [x] | KpiTile/DataTable/PageHeader/ProgressBar/EmptyState already existed; ADDED BarRow, HeatCell (D3 cue), AlertRow |
| ScopePeriodContext + ScopePeriodBar (URL-synced) | [x] | features/_shared/; provider mounted in (dashboard)/layout under Suspense; tsc + lint clean |
| T1 Migration: practices.kind + entity_revenue_lines | [x] | 000035_entity_kind.sql (idempotent, NOTIFY pgrst). Per-org Academy/Lab seeding deferred to app/seed (not a global migration) |
| T3 resolveScope() + scopeQuerySchema | [x] | analytics.service.resolveScope + model scopeQuerySchema + repo.entitiesByKind; 11 vitest tests |
| T2 kind read-path audit | [x] | Only 1 RPC enumerates practices (growth_practice_performance) → filtered in 000035; practicesList/practicesFull/practices.routes filter kind='practice'; regression-tested |
| React Query key {domain,scope,period,periodKey} | [x] | scopeKey() helper in scope-context |
**Exit:** scope/period works; Academy/Lab selectable; no rollup regressions. — `[x]` DONE. Backend: 348 tests green. Frontend: tsc+lint clean.

### Phase 0 exit notes
- Migration 000035 APPLIED to hosted (project Dental Os `mkfhpzjbijbachoonytt`) via Supabase MCP 2026-06-05 + `NOTIFY pgrst`. `entity_revenue_lines` confirmed (RLS on, 0 rows); `practices.kind` defaults 'practice' (25 existing rows unaffected). Re-applies cleanly on local `supabase db reset`.
- Per-org Academy/Lab rows: create via app/seed (they need an organisation_id); ScopePeriodBar already offers the options.
- ScopePeriodBar is built but not yet rendered on any screen — wired per-screen in Phase 1.

## Phase 1 — Tier-1 (new UI + extended compute)
| Task | Status | Notes / commit |
|---|---|---|
| T5 Workbench → ProfitScreen (pure debounced compute endpoint) | [x] | FULL VERTICAL DONE: computeServiceEconomics + DEFAULT_SERVICE_MODELS (pence, 11 tests, FORMULAS.md §12) → POST /api/analytics/compute/treatment-economics + GET .../treatment-models (finance.view, **audit-exempt /compute/ path**) → TreatmentWorkbench UI (treatment tabs, £↔pence inputs, debounced sliders, money-flow + components + principal-vs-associate planning) on /profit. Establishes the Arch#3 compute pattern. Suite 376 green; tsc+lint clean. Persisted overrides = later slice |
| T6 3-buyer Valuation + Sale Planner → ValuationScreen | [x] | FULL VERTICAL DONE: driver-based engine moved server-side (`computeGroupValuation` + `valueUpliftLevers` + `planExitTrajectory`, pence, +18 tests, FORMULAS.md §13) → POST `/api/analytics/compute/valuation` + `/compute/valuation/exit-plan` (valuation.view, audit-exempt /compute/ path) → ValuationScreen now posts state (debounced) via `useValuationCompute`/`useValuationExitPlan`, pence↔pounds adapter keeps the pound-denominated screen intact. **EBITDA reconciled + versioned**: legacy `calculateValuation` (§2) LEFT UNTOUCHED (GET /valuation unchanged) — new engine takes reported EBITDA + explicit add-backs (no fabrication). Client formula deleted from mock.ts (single-source rule). Suite 394 green; tsc+lint clean |
| T7 Chair OCPSPD + empty-chair + Recovery + profit/chair-hr | [x] | FULL VERTICAL DONE: formulas (+15 tests, FORMULAS.md §11) → migration 000036 (applied hosted) → chairAnalytics service (+2 tests) → GET /api/analytics/chair (finance.view) → ChairEfficiencyScreen UI + ScopePeriodBar wired into /chair (tsc+lint clean). FIRST end-to-end slice — proves the formulas→endpoint→UI pattern. Remaining: OCPSPD + profit-per-chair-hr (deferred, need opex/treatment-minute sourcing) |
| Group Overview rollup + Decision Lens | [x] | GroupOverviewScreen on /business-hub — REAL business-hub data, scope-aware (practice narrows; academy/lab note), KPI strip + per-practice table + client-computed Decision Lens (AlertRow). tsc+lint clean. Academy/Lab entity revenue rollup = later (needs entity_revenue_lines wiring) |
**Exit:** Tier-1 new UI, scope/period reactive. — `[~]` 6 views built fresh on the new tokens/primitives/ScopePeriodBar:
- Chair Efficiency (/chair) ✅ full vertical incl. endpoint
- Treatment Workbench (/profit) ✅ full vertical incl. pure compute endpoint
- Group Overview (/business-hub) ✅ real business-hub data
- Lead Funnel (/leads) ✅ real business-hub data
- Practice Deep Dive (/deep-dive, NEW route + nav) ✅ real (business-hub + chair + treatments + revenue-series + marketing/roi), scope-driven. Enriched: 8-stat hero, 8 chair-economics KPIs, treatment-mix bar chart + 12mo turnover area chart + Channel ROI (KPIs + per-provider spend bar chart) — all recharts, green/gold. Channel ROI added practice_id filter to /growth/marketing/roi (no new endpoint).
- Value & Growth / Valuation (/valuation) ✅ full vertical incl. pure compute endpoints (T6). Prototype labels this view "Value & Growth" (BOARDROOM); maps to existing /valuation route per the nav-mapping decision. NOTE: screen header still reads "Practice Valuation" — relabel is part of the D5/D6 nav sweep, not T6.

Commits e393809→(this). Also: full green/gold reskin sweep across 49 screens (d91514f).

### Bug fixes
- 404 on chair + workbench endpoints: api() paths missing `/api/` prefix (proxy forwards `http://backend/${path}`). Fixed chair-analytics-api + workbench-api to `/api/analytics/...` (business-hub-api was already correct).

### Intelligence OS views — all 12 now have a new-UI screen (2026-06-06)
The 6 remaining views were built FRONTEND-FIRST this session (decision: ship the UI on a
shared mock engine, wire the backend per-screen afterwards). All 12 nav views now render the
green/gold scope/period-reactive Intelligence OS UI:
- Group Overview, Practice Deep Dive, Treatment Mix, Treatment Profitability, Chair Efficiency,
  Lead Funnel, Value & Growth — DONE (full vertical, real endpoints) in earlier sessions.
- **Clinicians (/clinicians), AI Analyst (/ai-insights), Day (/day), Marketing & ROI (/marketing),
  P&L & Margin (/financial)** — frontend built this session; **backend wiring pending.**
- Value & Growth (/valuation) — header relabelled from "Practice Valuation" (the T6 vertical was
  already done; this closes the D5/D6 relabel note).

Shared mock engine: `frontend/features/intelligence/os-data.ts` (faithful TS port of the
GM-Group-Intelligence-OS_3.html data engine — PRACTICES/ACADEMY/LAB, channels, treatments,
scopedEntities/groupChannels/practiceAssociates/ocpspd/plEntity/buildInsights, scope/period-aware).
Shared panel primitives: `frontend/features/intelligence/components/os-ui.tsx`. Money is whole
POUNDS in the mock (prototype convention); the wiring slice converts to integer pence at the api()
boundary (CLAUDE.md rule 2).

### Backend-wiring TODO (next phase — replace os-data per screen)
- AI Analyst: `POST /api/analytics/ai-ask` → lib/claude.js (findings shape already matches `buildInsights`).
- Marketing & ROI: marketing-analytics endpoint over `ad_metrics` + `leads` (per-channel + per-practice).
- P&L & Margin: real CoA→P&L over Xero (reuse `calculateProfitBenchmark` lineage); editable sheets = Phase 3.
- Clinicians: production from synced appointments + associate mapping + UDA feed.
- Day: real settled receipts by `processed_at` date + composite index.
- Chair OCPSPD + profit-per-chair-hr panels — still need opex/treatment-minute sourcing.

## Phase 2 — Tier-2 (new UI + extended compute)
| Task | Status | Notes / commit |
|---|---|---|
| Treatment Mix heat matrix + insight cards | [x] | FULL VERTICAL DONE (volume + **real £ revenue**). VOLUME: `treatment_mix_matrix` RPC (migration `…000038`) → `treatmentMatrix({scope,period,pk})` → GET /api/analytics/treatment-matrix → `TreatmentMatrixScreen` on /treatments (ScopePeriodBar + KpiTiles + AlertRow insights + HeatCell matrix; top-12 + 'Other treatment types' tail; volume-framed insights). REVENUE: shared `assembleMixMatrix` builder + `treatment_revenue_matrix` RPC (`…000041`) over **invoice_items** → `treatmentRevenueMatrix` → GET /api/analytics/treatment-revenue → **Volume/Revenue £ toggle** on the screen (cells in £, money-framed insights). +13 backend tests. Suite 431 green; tsc+lint clean; API.md updated. **Real-fee plumbing (the big unlock):** Dentally `/invoices`+`/invoice_items` now pulled (connector + new `invoice_items` table `…000040`); fixed `treatment_plans` 0-rows bug (missing unique idx, `…000039`). Workbench case fee **auto-fills** from real invoices (`invoice_case_rollup` RPC `…000042` + `classifyCaseFees` → GET /api/analytics/treatment-fee-benchmarks; FORMULAS.md §12). See memory `dentally-invoice-items-real-fees`. **Pending:** verify against the populating resync + `/ship` (live app needs deploy for invoice_items pull). |
| Clinicians unified (production, OCPSPD, ledger, UDA-by-assoc) | [x] | WIRED (full vertical, honest data walls): `clinicians({scope,period,pk})` over REAL associate roster (`cliniciansRoster` repo — pay_pct/lab_split_pct), `associate_production` RPC (treatment_plans), `associate_appointment_stats`, owner-entered NHS contract (`practicesNhs` repo) → GET /api/analytics/clinicians (finance.view; academy/lab not-applicable) → `CliniciansScreen` reads `useClinicians`. **NO fabrication** — `productionAvailable`/`appointmentsAvailable`/`nhs.completedAvailable` flags drive honest "awaiting Dentally feed" states (treatment_plans empty live); lab/OCPSPD per clinician omitted (no real source); bars fall back to appointment volume when production absent. +6 tests (suite 454 green); tsc+lint clean; API.md updated. Mock os-data path removed. |
| CoA → P&L mapping + Profit Benchmarking (45/18/15/12/10) | [x] | FULL VERTICAL DONE: `calculateProfitBenchmark` + `PROFIT_BENCHMARKS` constants (pence, 10 tests, FORMULAS.md §1b) → GET /api/analytics/pl-benchmark (finance.view, **actuals-only — no baseline on a Finance screen**; costsAvailable:false/no rows when no cost source) → ProfitBenchmarkScreen on /profit (5 cost-line tiles, variance table, CoA→P&L bucket→category mapping panel). Honest `dentistStaffSeparable` flag: Xero folds associate pay into staff → UI combines/banners instead of false-green dentist row. Did NOT fabricate Xero account codes (real bucket mapping only; account-code-level = later owner-gated slice). API.md updated. Suite 415 green; tsc+lint clean. Commit ee97cbd |
| Cashflow: bills-to-plan + free-cash + runway | [x] | FULL VERTICAL DONE + ENRICHED to the prototype. (1) `calculateRunway` (pence, FORMULAS.md §14) on GET /cashflow runway block. (2) `cashflowOutlook` + GET /api/analytics/cashflow-outlook (FORMULAS.md §15): month-by-month cash IN (real settled receipts) vs OUT (P&L cost base, flagged), forward months PROJECTED from run-rate, closing-balance trail ANCHORED to today's real bank balance (current month closes there; earlier reconstructed; later projected), `lowestProjected`. (3) `estimateCorporationTax` (UK FY24/25 rates: 19/marginal/25) → bills-to-plan; VAT NOT estimated (dental largely exempt); no payables feed → honest gap note. (4) `freeCashDecision` (2-week buffer; sweepable only when lowest projected clears buffer). CashflowScreen rebuilt to match prototype: headline cards (cash position / net this month / runway "Self-funding") + Cash-in-vs-out + Will-I-run-out table + Bills-to-plan + Decision panel; kept real weekly receipts below. +11 tests (runway/corp-tax/decision). Skipped the generic marketing/ROAS/new-patient KPI strip (Overview/Business-Hub data, not cashflow). Suite 405 green; tsc+lint clean |
| T9 Day = cash-collected-by-day + composite index | [x] | FULL VERTICAL DONE (2026-06-06): `cashByDay({scope,period,pk})` over `settled_receipts_by_day` RPC (real receipts by `processed_at` date; scope→org/entity, month-framed, composite index vs avg working day=100, data-derived Decision Lens) → GET /api/analytics/cash-by-day (finance.view) → `DayScreen` reads `useCashByDay` (loading/empty/error states), money in PENCE. +6 tests (suite 437 green); tsc+lint clean; API.md updated. Mock os-data path removed from the screen. |
| AI Analyst findings + Ask box (reuse generate/p4g-ai) | [x] | WIRED (full vertical): `aiAsk({scope,period,pk,question})` aggregates the REAL Decision-Lens insights from plMargin+marketingRoi+clinicians+cashByDay (+ headline margin/ROAS/cash facts) into £-ranked findings; with a question + ANTHROPIC_API_KEY, `claude.askAnalyst` writes a NL answer grounded in a compact real summary, else keyword-match fallback → POST /api/analytics/ai-ask (finance.view, `aiAskSchema`) → `AiAnalystScreen` (`useAiFindings` query + `useAiAsk` mutation; loading/empty/error). NO fabrication — findings are the live rollups. +4 tests (suite 458 green); tsc+lint clean; API.md updated. Mock os-data path removed. |
| T11 Port remaining views (new UI) | [x] | **Marketing & ROI WIRED (full vertical):** `marketingRoi({scope,period,pk})` over real `ad_metrics` (paid spend) + CRM `leads` (channel attribution via utm/source; conversions = leads reaching treatment) + settled revenue → GET /api/analytics/marketing-roi (finance.view; repo `adMetricsInWindow`/`leadsForMarketing` added). HONEST: no per-channel revenue/ROAS (revenue unattributable) — only business-level blended paid ROAS; per-practice ROAS only when ad spend is practice-tagged. `MarketingRoiScreen` rebuilt off `useMarketingRoi` (loading/empty/not-connected; spend→leads→CPL→patients→CPA led; Decision Lens). +6 tests (suite 448 green); tsc+lint clean; API.md updated. ~~P&L & Margin~~ done (prev row). |
| ~~T11 (P&L & Margin)~~ | [x] | **P&L & Margin WIRED (full vertical):** `plMargin({scope,period,pk})` over real `monthly_financials` actuals (Xero/QuickBooks override manual, resolved PER ENTITY; honest CoA buckets — staff incl. associate pay, tax excluded; selected-month else trailing-annual) → GET /api/analytics/pl-margin (finance.view, `allEntities` repo helper added) → `PLMarginScreen` reads `usePLMargin` (loading/empty/error; staff-includes-associate banner; per-entity only when practice-tagged), money in PENCE. +5 tests (suite 442 green); tsc+lint clean; API.md updated. **Marketing & ROI backend wiring pending.** |
**Exit:** all 12 views ported, new UI. — `[ ]`

## Phase 3 — Persistence + editable sheets (final slice)
| Task | Status | Notes / commit |
|---|---|---|
| T8 RBAC finance.edit/valuation.edit + gate mutations | [x] | BACKEND DONE: added `finance.edit`/`valuation.edit` to PERMISSION_CATALOG (owner-default via reduce; PM/reception excluded). All Phase-3 mutation routes gated on the `*.edit` key (not `*.view`, rule 5); audited automatically by the audit middleware (non-`/compute/` path). |
| T12 valuation_inputs + chair_config (org config, RLS, audit) | [x] | DONE (commit c46c749). Migration `…000043` (both org-scoped, UNIQUE org, RLS `current_org_id()` reception-excluded, `set_updated_at`; valuation_inputs +`ui_state` jsonb for faithful screen restore). Repos `valuationInputs`/`chairConfig`. Service get/save (snake↔camel; chair merges over CHAIR_CONFIG defaults). GET/PUT `/valuation-inputs` (val/valEdit) + `/chair-config` (fin/finEdit). `GET /chair` overlays saved config into capacity. **Frontend DONE:** Value & Growth Save valuation inputs (load on mount via ui_state) + Chair Efficiency "Capacity assumptions" editor (refetch on save). +11 tests. |
| T13 Editable P&L: resolve TODO1 precedence → pl_sheets (Postgres) | [x] | DONE (commit c46c749). **TODO1 resolved = SCENARIO OVERLAY** (sheets never override actuals or feed EBITDA; finance screens stay real-or-zero). Migration `…000044` (`pl_sheets`: name/type/cols/lines/cells jsonb, org RLS, audited). Repo `plSheet` + service CRUD + `plSheetToCsv`. Full CRUD routes + `/pl-sheets/:id/csv`, finance.edit-gated. **Frontend DONE:** editable grid on `/financial` below P&L & Margin (sheet picker, add/remove rows+cols, £ cell editing, Save, Delete, Export CSV; Postgres-backed, NOT localStorage). Money integer pence. |
| FORMULAS.md + API.md + documented constants | [x] | API.md: Phase-3 persistence block (10 endpoints, gates, precedence note). FORMULAS.md §16 (config constants for accountant sign-off + precedence rule); §11 chair_config note updated. Accountant sign-off still to be obtained. |
| T10 /qa + /browse pass against test-plan artifact | [~] | Static QA done: backend 469 tests green, backend typecheck clean, frontend typecheck/lint/build clean. Live `/qa`+`/browse` deferred to post-deploy (endpoints not live until backend deploy + hosted migrations). |
**Exit:** code complete (backend + frontend), CI-green locally, docs updated — `[~]`. REMAINING TO GO LIVE: apply migrations `000043`/`000044` to hosted Supabase (+`NOTIFY pgrst`), deploy backend (Railway), then live `/qa`+`/browse` pass + accountant sign-off on FORMULAS.md. |

---

## Decisions log
| Date | Decision | Outcome |
|---|---|---|
| 2026-06-05 | Plan drafted from prototype | — |
| 2026-06-05 | Eng review: scope | Reframe + extend existing backend; adopt new UI; full coverage; editable P&L final slice (Postgres) |
| 2026-06-05 | A1 entity model | kind discriminator on practices + entity_revenue_lines |
| 2026-06-05 | A2 Day period | Cash-receipts-by-day (labelled); production stays month-only |
| 2026-06-05 | A3 compute | Server-authoritative pure formulas.js + debounced |
| 2026-06-05 | CQ1/CQ2 | Shared primitives first; single resolveScope() helper |
| 2026-06-05 | Perf | Single fetch + in-memory (no N+1); composite (org,processed_at,status) index |
| 2026-06-05 | Security | finance.edit/valuation.edit keys; pure compute audit-exempt |
| 2026-06-05 | TODO1/TODO2 | P&L precedence at sheets slice; chair_config+valuation drivers org config, rest documented constants |
| 2026-06-05 | Design: nav | Map 12 views into existing routes; no new nav |
| 2026-06-05 | Design: system | Adopt new green/gold system APP-WIDE; legacy 50-screen reskin = deferred sweep (D5) |
| 2026-06-05 | Design: states | Full per-view state table (loading/empty/error/recalculating) |
| 2026-06-05 | Design: a11y | Heat-matrix non-colour cue; glyph aria-hidden; --soft contrast >=4.5:1; stack KPIs on mobile |

## Design tasks (from /plan-design-review, score 6->9)
| Task | Status | Notes |
|---|---|---|
| D1 Create DESIGN.md + migrate globals.css/tailwind to green/gold tokens | [ ] | Phase 0, before primitives |
| D6 Map 12 views into existing routes (no new nav) | [ ] | Phase 0/throughout |
| D2 Per-view interaction state table | [ ] | Phases 1-2 |
| D3 Heat-matrix non-colour cue (WCAG 1.4.1) | [ ] | Phase 2 |
| D4 Responsive (stack KPIs) + a11y (glyph aria-hidden, contrast) | [ ] | Phase 2 |
| D5 Reskin existing ~50 screens to new tokens | [ ] | DEFERRED sweep (P3) |

## Chair occupancy = MANUAL grid (product decision)
- Chair Efficiency / Deep Dive occupancy now reads from the **manual chair-utilisation grid** (`chair_utilisation`, owner-maintained — booked ÷ available minutes per practice), NOT appointments and NOT a flat assumption. The chair-utilisation tab is intentionally manual and unchanged. No grid data for a practice → falls back to assumed 80% (flagged `occupancySource:'assumption'`). Live now: all practices ~67% from the grid.
- `occupancySource: 'manual' | 'assumption'` returned per practice; UI labels accordingly (info banner "from chair-utilisation grid" vs warn "fill the grid").
- Migration 000037 (`chair_booked_minutes_by_practice`, completed-appt minutes) is retained as a UTILITY only (future actual-vs-manual comparison), NOT the occupancy source.
- Still not real: `practices.chairs` defaults to 1 (capacity/cost-of-empty £ depend on it). Separate from occupancy; flag/fix when real chair counts exist.

## Known caveats
- **Channel ROI spend is account-level, not per-practice.** `ad_metrics.practice_id` is NULL for Google/Meta (one ad account per group). So Deep Dive's per-practice Channel ROI shows real data only when ad rows carry a practice_id; otherwise "not connected" even if the group has ads. Live now: `ad_metrics` = 0 rows (no ads connected) → honest "not connected". Future fix: per-practice channel view should lead with **leads-by-channel** (leads.source/utm, practice-scoped, real) and show paid spend/ROAS as group-level context. Tracked.

## Risks / blockers
- **kind read-path audit (T2)** — must catch every legacy practice rollup or Academy/Lab corrupt group tables / div-by-zero. Phase-0 exit gate.
- ~~**calculateValuation EBITDA reconciliation (T6)**~~ — RESOLVED. New `computeGroupValuation` (FORMULAS.md §13) takes reported EBITDA + explicit add-backs (no fabrication); legacy `calculateValuation` (§2) left untouched so GET /valuation is byte-identical. Two versioned engines, documented divergence — no silent output change.
- **Day data semantics** — cash receipts ≠ production; must stay labelled "Cash collected".
