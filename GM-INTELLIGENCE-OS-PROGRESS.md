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
| T5 Workbench → ProfitScreen (pure debounced compute endpoint) | [ ] | golden ± tolerance; audit-exempt |
| T6 3-buyer Valuation + Sale Planner → ValuationScreen | [ ] | driver-based; EBITDA reconciled; versioned |
| T7 Chair OCPSPD + empty-chair + Recovery + profit/chair-hr | [~] | formulas DONE (+15 tests, FORMULAS.md §11). Backend DONE: migration 000036 (assumed_util_pct, applied hosted), chairAnalytics service (real trailing-12mo revenue + assumption util), GET /api/analytics/chair (finance.view, scopeQuerySchema), +2 tests, API.md. utilPct=owner-editable assumption (decision). OCPSPD/profit-per-chair-hr deferred (opex/treatment-minute sourcing). NEXT: frontend ChairEfficiency UI + ScopePeriodBar wiring |
| Group Overview rollup (Academy+Lab) + Decision Lens | [ ] | |
**Exit:** Tier-1 new UI, scope/period reactive. — `[ ]`

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

## Risks / blockers
- **kind read-path audit (T2)** — must catch every legacy practice rollup or Academy/Lab corrupt group tables / div-by-zero. Phase-0 exit gate.
- **calculateValuation EBITDA reconciliation (T6)** — service fabricates `profit+revenue*0.04`; prototype uses explicit add-backs. Two defs; version to avoid silently changing current outputs.
- **Day data semantics** — cash receipts ≠ production; must stay labelled "Cash collected".
