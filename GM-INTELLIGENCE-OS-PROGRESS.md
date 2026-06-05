# GM Intelligence OS — Progress Tracker

Plan: `GM-INTELLIGENCE-OS-PLAN.md` (eng-reviewed 2026-06-05). Update after every task (status + date + commit).

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-06-05 (eng review complete; scope reframed)

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
| T6 3-buyer Valuation + Sale Planner → ValuationScreen | [ ] | driver-based; EBITDA reconciled; versioned |
| T7 Chair OCPSPD + empty-chair + Recovery + profit/chair-hr | [x] | FULL VERTICAL DONE: formulas (+15 tests, FORMULAS.md §11) → migration 000036 (applied hosted) → chairAnalytics service (+2 tests) → GET /api/analytics/chair (finance.view) → ChairEfficiencyScreen UI + ScopePeriodBar wired into /chair (tsc+lint clean). FIRST end-to-end slice — proves the formulas→endpoint→UI pattern. Remaining: OCPSPD + profit-per-chair-hr (deferred, need opex/treatment-minute sourcing) |
| Group Overview rollup + Decision Lens | [x] | GroupOverviewScreen on /business-hub — REAL business-hub data, scope-aware (practice narrows; academy/lab note), KPI strip + per-practice table + client-computed Decision Lens (AlertRow). tsc+lint clean. Academy/Lab entity revenue rollup = later (needs entity_revenue_lines wiring) |
**Exit:** Tier-1 new UI, scope/period reactive. — `[~]` 5 views built fresh on the new tokens/primitives/ScopePeriodBar:
- Chair Efficiency (/chair) ✅ full vertical incl. endpoint
- Treatment Workbench (/profit) ✅ full vertical incl. pure compute endpoint
- Group Overview (/business-hub) ✅ real business-hub data
- Lead Funnel (/leads) ✅ real business-hub data
- Practice Deep Dive (/deep-dive, NEW route + nav) ✅ real (business-hub + chair + treatments + revenue-series + marketing/roi), scope-driven. Enriched: 8-stat hero, 8 chair-economics KPIs, treatment-mix bar chart + 12mo turnover area chart + Channel ROI (KPIs + per-provider spend bar chart) — all recharts, green/gold. Channel ROI added practice_id filter to /growth/marketing/roi (no new endpoint).

Commits e393809→(this). Also: full green/gold reskin sweep across 49 screens (d91514f).

### Bug fixes
- 404 on chair + workbench endpoints: api() paths missing `/api/` prefix (proxy forwards `http://backend/${path}`). Fixed chair-analytics-api + workbench-api to `/api/analytics/...` (business-hub-api was already correct).

### Pending Intelligence OS views (7 of 12)
- AI Analyst (Ask box) — needs new `POST /api/analytics/ai-ask` → lib/claude.js (findings UI already exists)
- Treatment Mix heat matrix — needs practice×treatment RPC
- Sale Planner / driver Valuation — T6 backend (extend calculateValuation + EBITDA reconcile)
- Chair OCPSPD + profit-per-chair-hr panels — opex/treatment-minute sourcing
- Marketing & ROI, P&L & Margin, Cashflow & Runway, Clinicians — screens exist (reskinned); need new layout + ScopePeriodBar + scope wiring

## Phase 2 — Tier-2 (new UI + extended compute)
| Task | Status | Notes / commit |
|---|---|---|
| Treatment Mix heat matrix + insight cards | [ ] | |
| Clinicians unified (production, OCPSPD, ledger, UDA-by-assoc) | [ ] | |
| CoA → P&L mapping + Profit Benchmarking (45/18/15/12/10) | [ ] | constants documented in FORMULAS.md |
| Cashflow: bills-to-plan + free-cash + runway | [ ] | |
| T9 Day = cash-collected-by-day + composite index | [ ] | labelled 'Cash collected', NOT production |
| AI Analyst findings + Ask box (reuse generate/p4g-ai) | [ ] | no new endpoint |
| T11 Port remaining views (new UI) | [ ] | British copy, no emojis |
**Exit:** all 12 views ported, new UI. — `[ ]`

## Phase 3 — Persistence + editable sheets (final slice)
| Task | Status | Notes / commit |
|---|---|---|
| T8 RBAC finance.edit/valuation.edit + gate mutations | [ ] | persisted edits audited |
| T12 valuation_inputs + chair_config (org config, RLS, audit) | [ ] | |
| T13 Editable P&L: resolve TODO1 precedence → pl_sheets (Postgres) | [ ] | CSV export; NOT localStorage |
| FORMULAS.md + API.md + documented constants | [ ] | accountant sign-off |
| T10 /qa + /browse pass against test-plan artifact | [ ] | |
**Exit:** all live, no mock, CI green, docs updated. — `[ ]`

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

## Known caveats
- **Channel ROI spend is account-level, not per-practice.** `ad_metrics.practice_id` is NULL for Google/Meta (one ad account per group). So Deep Dive's per-practice Channel ROI shows real data only when ad rows carry a practice_id; otherwise "not connected" even if the group has ads. Live now: `ad_metrics` = 0 rows (no ads connected) → honest "not connected". Future fix: per-practice channel view should lead with **leads-by-channel** (leads.source/utm, practice-scoped, real) and show paid spend/ROAS as group-level context. Tracked.

## Risks / blockers
- **kind read-path audit (T2)** — must catch every legacy practice rollup or Academy/Lab corrupt group tables / div-by-zero. Phase-0 exit gate.
- **calculateValuation EBITDA reconciliation (T6)** — service fabricates `profit+revenue*0.04`; prototype uses explicit add-backs. Two defs; version to avoid silently changing current outputs.
- **Day data semantics** — cash receipts ≠ production; must stay labelled "Cash collected".
