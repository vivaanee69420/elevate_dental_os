# GM Intelligence OS — Implementation Plan (eng-reviewed)

Source prototype: `GM-Group-Intelligence-OS_3.html` (single-file demo, mock data, `localStorage`).
Target: port into the live Next.js 14 app (`frontend/`) + Express backend (`backend/`), respecting all project rules.

Companion tracker: `GM-INTELLIGENCE-OS-PROGRESS.md` (update after every task).

> Reviewed via `/plan-eng-review` 2026-06-05. Scope reframed from "greenfield build" to
> "EXTEND the existing analytics layer + adopt the prototype's new UI". All architecture,
> code-quality, test and performance decisions below are locked. See `## GSTACK REVIEW REPORT`.

---

## 1. Goal

Upgrade the existing analytics screens to the prototype's boardroom-grade depth and **adopt the
prototype's new UI**, behind a single **global Scope + Period switcher**, with **Academy** and
**Lab** as first-class entities alongside the 5 dental practices.

This is **not** a greenfield build. The backend analytics layer already exists and is wired to
real data (see §3 "What already exists"). We EXTEND it. **Full feature coverage** — every relevant
prototype feature ships, including the editable multi-sheet P&L (sequenced last, Postgres-backed).

Strategy: shared UI primitives first → screen-by-screen port (new UI) → extend backend per slice.

---

## 2. Locked decisions (from eng review)

| # | Decision | Choice |
|---|---|---|
| Scope | Reframe | EXTEND existing analytics backend; adopt prototype UI; full coverage; editable P&L = final slice (Postgres, not localStorage) |
| A1 | Academy/Lab model | `kind` discriminator on `practices` (`practice`\|`academy`\|`lab`) + `entity_revenue_lines` table. Reuses `monthly_financials.practice_id` wiring |
| A2 | Day/Month period | Day = **cash receipts by day** (`payments.processed_at`, settled), labelled "Cash collected" — NOT production. Revenue/production stay month-only. No reliance on stale appts |
| A3 | Workbench/Sale-Planner recompute | **Server-authoritative**: formulas.js is the only source. Sliders debounce (~250ms) → **pure** compute endpoint (inputs in body, no DB read) → optimistic "recalculating" state |
| CQ1 | Shared UI | Build `components/ui` primitives FIRST (KpiCard, BarRow, HeatCell, AlertRow, PanelHeader, DataTable), then compose in every screen |
| CQ2 | Scope resolution | Single `resolveScope(orgId, scopeParam)` in `analytics.service` → `{entityIds, kinds, isAggregate}`; shared `scopeQuerySchema` (Zod) |
| Test | Coverage | Backend 100% of new/changed formula branches + endpoint gate + cross-org isolation (vitest). Frontend via `/qa` + `/browse` (no new framework). Regressions mandatory. Golden-value tests vs prototype floats with documented tolerance |
| P1 | Scoped queries | Single org-scoped fetch + in-memory scope filter. **No N+1** (no per-entity query loops) |
| P2 | Day index | New migration: composite `(organisation_id, processed_at, status)` on `payments` (covers the settled-by-day query incl. status filter). `NOTIFY pgrst` after DDL |
| Sec | Write gate + audit | Add `finance.edit` + `valuation.edit` RBAC keys; gate all mutations on those (read stays `finance.view`). Live-recompute endpoints are **pure + audit-exempt**; persisted edits ARE audited |
| TODO1 | Editable P&L precedence | Resolve the 3-layer precedence rule (Xero actuals vs monthly_financials manual vs sheet edit; revert/stick/stale; feeds EBITDA?) at the sheets slice. Added to TODOS.md |
| TODO2 | Business constants | `chair_config` + valuation drivers = per-org config (`valuation_inputs`); benchmarks (45/18/15/12/10), associate-roster template, weekday weights = group constants DOCUMENTED in FORMULAS.md. Per-org benchmarks = later TODO |

---

## 3. What already exists (do NOT rebuild)

- `backend/src/routes/analytics.routes.js` — `dashboard`, `dashboard-summary`, `revenue-series`,
  `practice-summary`, `business-hub`, `ai-insights` (+`/generate`), `finance-series`, `cashflow`,
  `financial`, `pl`, `kpis`, `valuation`. **Already gated** (`finance.view` / `valuation.view`).
- `backend/src/lib/formulas.js` — pence-based: `calculatePL`, **`calculateValuation` (already
  3-buyer)**, `calculateAssociatePay`, `calculateCashFlow`, `calculateKPIs`, `calculateCAGR`,
  `calculateMarketingROI`, `calculateProgress`, `calculateLTV`.
- `backend/src/services/analytics.service.js` — pulls **real `monthly_financials` actuals**
  (Xero>manual precedence, period bucketing, P&L/finance-series/cashflow derivation). `basis` flag.
- Routes already exist: `growth`, `chair-utilisation`, `treatment`, `payments`, `pay-runs`,
  `associate`, `staff`, `p4g-ai`. Ad-metrics table (`000034`) → marketing has real data.
- `payments` indexes: `idx_payments_org`, `_practice`, `_status`, `_created(created_at)`.
- AI Analyst Ask box → **reuse** `ai-insights/generate` + `p4g-ai` routes (do not build new).

So P&L / cashflow / valuation / dashboard / AI-insights are **already wired to real data**. The
genuinely-new work is: scope/period engine, Academy/Lab entities, and the deep compute below.

---

## 4. Net-new work (the real scope)

**Compute (extend `formulas.js`, pence, server-authoritative):**
- `computeServiceEconomics` — workbench: target-price solver, max-ad/CAC, principal-vs-associate, overrun
- `calculateChairStats`, `calculateOcpspd`, `profitPerChairHour` — occupancy, cost-of-empty-chairs, booking priority
- Extend `calculateValuation` → driver-based (region, growth premium, NHS%, sites tier, add-backs,
  principal salary) + `planExitTrajectory` + `valueUpliftLevers`. **Reconcile EBITDA definition**
  (service currently fabricates `profit + revenue*0.04`; prototype uses explicit add-backs +
  principal salary) and **version outputs** so existing valuation callers don't silently change.
- Extend `calculatePL` (academy/lab branches), `calculateCashFlow` (runway, free-cash, bills)

**Structural:**
- `resolveScope()` + `scopeQuerySchema`; thread scope/period through existing endpoints
- `practices.kind` + `entity_revenue_lines` + seed Academy/Lab
- **`kind` read-path audit** (see failure modes): add `WHERE kind='practice'` (or explicit `IN`) to
  every existing practice-only rollup: `businessHub`, `practiceSummary`, `dashboardSummary`, and the
  chair-utilisation / treatment-mix / settled-revenue-by-practice RPCs (~6 RPCs + ~6 service methods)
- Day = settled-cash-by-day endpoint + composite index
- `finance.edit`/`valuation.edit` RBAC keys; pure audit-exempt compute endpoints
- Persistence: `valuation_inputs`, `chair_config`, `pl_sheets` (all `organisation_id`, RLS, audited)

**Frontend (adopt prototype UI):**
- Shared primitives → ScopePeriodBar (URL-synced context) → port 12 views into existing screens

---

## 5. Phased plan

### Phase 0 — Foundation
- [ ] Shared `components/ui` primitives (KpiCard, BarRow, HeatCell, AlertRow, PanelHeader, DataTable)
- [ ] `ScopePeriodContext` + `<ScopePeriodBar />` (URL-synced) in dashboard layout
- [ ] Migration: `practices.kind` + `entity_revenue_lines`; seed Academy + Lab
- [ ] `resolveScope()` + `scopeQuerySchema` in analytics.service
- [ ] **kind read-path audit**: filter all existing practice-only rollups by `kind='practice'`
- [ ] React Query key convention `{domain, scope, period, periodKey}`
**Exit:** existing screens read scope/period; Academy/Lab selectable; no rollup regressions.

### Phase 1 — Tier-1 (new UI + extended compute)
- [ ] Treatment Economics Workbench → ProfitScreen (pure compute endpoint, debounced)
- [ ] 3-buyer Valuation + Sale Planner → ValuationScreen (driver-based, EBITDA reconciled, versioned)
- [ ] Chair OCPSPD + empty-chair cost + Recovery Engine + profit/chair-hr → ChairScreen
- [ ] Group Overview rollup incl Academy+Lab + Decision Lens → BusinessHubScreen

### Phase 2 — Tier-2 (new UI + extended compute)
- [ ] Treatment Mix heat matrix + insight cards → TreatmentsScreen
- [ ] Clinicians unified (production, OCPSPD, ledger, UDA-by-associate)
- [ ] Chart-of-accounts → P&L mapping + Profit Benchmarking (45/18/15/12/10)
- [ ] Cashflow: bills-to-plan + free-cash + runway → CashflowScreen
- [ ] Day = cash-collected-by-day view (labelled), composite index
- [ ] AI Analyst £-ranked findings + Ask box (reuse existing generate/p4g-ai)

### Phase 3 — Persistence + editable sheets (final slice)
- [ ] `valuation_inputs`, `chair_config` tables (org config, RLS, audited)
- [ ] **Editable P&L spreadsheet** → resolve TODO1 precedence first → `pl_sheets` (Postgres, audited)
- [ ] CSV export parity; FORMULAS.md + API.md updated; constants documented for accountant
**Exit:** all 12 views live + new UI, no mock, CI green, docs updated.

---

## 6. Data model additions

```
practices.kind            text default 'practice'  -- 'practice'|'academy'|'lab'
entity_revenue_lines      -- id, organisation_id, entity_id(->practices), label, revenue_pence, margin_bps
valuation_inputs          -- per-org: reported_ebitda_pence, addbacks_pence, principal_salary_pence,
                          --          classification, nhs_pct, region, growth, sites, mult_adj jsonb, horizon
chair_config              -- per-org: open_hrs, weeks_yr, days_wk, bench_occ_pct, bench_rev_hr_pence
pl_sheets                 -- per-org: name, type, cols jsonb, lines jsonb, cells jsonb  (final slice)
payments  +index          -- idx_payments_org_processed ON payments(organisation_id, processed_at, status)
```
All carry `organisation_id`; RLS-isolated; mutations audited. `NOTIFY pgrst, 'reload schema';` after DDL.

---

## 7. Guardrails (re-check every PR)

1. Integer pence everywhere; formulas only in `lib/formulas.js`; FORMULAS.md + test per formula.
2. No Anthropic calls from browser — backend `lib/claude.js` only (reuse existing AI routes).
3. Every business row carries `organisation_id`; **persisted** mutations audited; compute endpoints audit-exempt + pure.
4. Mutations gated on `finance.edit`/`valuation.edit`, not `finance.view` (rule 5).
5. British English; no emojis (use app icon set); no dark mode; exclude "Italy Implant Residency".
6. `kind='practice'` filter on every legacy practice rollup (prevent Academy/Lab corruption).
7. CI green; update `docs/API.md` per endpoint, `docs/FORMULAS.md` per formula + every documented constant.

---

## 8. Failure modes (new codepaths)

| Codepath | Realistic failure | Test? | Error handling? | Visible? |
|---|---|---|---|---|
| `resolveScope` invalid/foreign scope | scope param tampered to other org's id | YES (cross-org) | reject → 403/empty | clear |
| `kind` rollups un-audited | Academy/Lab phantom rows, chair div-by-zero | YES (regression) | filter kind | **CRITICAL if missed** |
| Day cash-by-day | misread as production | n/a | label "Cash collected" | mitigated by copy |
| pure compute endpoint | per-keystroke DB re-fetch / audit spam | YES | inputs-in-body, audit-exempt | none |
| `calculateValuation` extend | existing outputs change silently | YES (regression+golden) | version flag | clear |
| Math.round solver drift | target-price/exit-target diverge from prototype | YES (golden ± tolerance) | documented tolerance | none |
| Dentally appt re-sync (if Day production ever pursued) | unverified field names leave nulls | — | deferred | n/a (not in scope) |

**Critical gap flagged:** the `kind` read-path audit. If any legacy practice rollup is missed,
Academy/Lab silently corrupt group revenue tables / divide-by-zero on chair views. Must be a
Phase-0 exit gate with regression tests.

---

## 9. Parallelization (git worktrees)

| Lane | Work | Depends on | Shared modules |
|---|---|---|---|
| A | Phase 0 foundation (primitives, context, kind, resolveScope, read-path audit) | — | blocks all |
| B | formulas.js compute extensions + unit tests | A (kind) | `lib/formulas.js` |
| C | Frontend screen ports (Tier-1/2 UI) | A (primitives), B (endpoints) | `features/*`, `components/ui` |
| D | Persistence tables + editable sheets | A, TODO1 | migrations |

Execution: **Lane A first (barrier).** Then B + C-frontend-shell in parallel worktrees (B = backend
`lib/`+`services/`, C = `frontend/` — disjoint). D last. Conflict flag: B and any service-layer work
in A touch `analytics.service.js` — keep A's resolveScope merged before B starts.

---

## 10. NOT in scope (deferred, with rationale)

- **Per-practice user ACL** — RLS is org-level only; the Scope switcher exposes all entities to any
  finance-permissioned user. Restricting a PM to one site is a green-field feature, not this plan.
- **Day = real production** — needs verified Dentally appt re-sync (stale, unverified fields). Day
  ships as cash-collected only.
- **Per-org benchmarks / roster / weekday-weight config tables** — ship as documented constants; TODO.
- **Editable P&L precedence design** — resolved at the sheets slice (TODO1), not up front.
- **Frontend test framework (Vitest/RTL/Playwright)** — covered by `/qa`; infra decision stays deferred.

---

## 11. Implementation Tasks
Synthesized from review findings. P1 blocks ship · P2 same branch · P3 follow-up.

- [ ] **T1 (P1, human: ~3h / CC: ~25min)** — schema — Add `practices.kind` + `entity_revenue_lines`, seed Academy/Lab
  - Surfaced by: Arch #1. Files: `supabase/migrations/`, `db/01_schema.sql`. Verify: `supabase db reset`
- [ ] **T2 (P1, human: ~4h / CC: ~40min)** — analytics.service — kind read-path audit (`WHERE kind='practice'` on ~6 RPCs + ~6 methods)
  - Surfaced by: Outside voice #5. Files: `analytics.service.js`, chair/treatment/settled-revenue RPCs. Verify: regression tests, Academy/Lab no phantom rows
- [ ] **T3 (P1, human: ~2h / CC: ~20min)** — analytics.service — `resolveScope()` + `scopeQuerySchema`, single fetch + in-memory filter
  - Surfaced by: Arch CQ2 + Perf #1. Files: `analytics.service.js`, `models/analytics.model.js`. Verify: 6-branch unit test, no N+1
- [ ] **T4 (P1, human: ~1d / CC: ~1h)** — components/ui — shared primitives (KpiCard, BarRow, HeatCell, AlertRow, PanelHeader, DataTable)
  - Surfaced by: CQ #1. Files: `frontend/components/ui/`. Verify: composed in ≥2 screens
- [ ] **T5 (P1, human: ~1d / CC: ~45min)** — formulas + endpoint — `computeServiceEconomics` + pure debounced compute endpoint (audit-exempt)
  - Surfaced by: Arch #3 + Sec. Files: `lib/formulas.js`, `analytics.routes.js`, `controllers`. Verify: golden-value ± tolerance; no audit row written
- [ ] **T6 (P1, human: ~1d / CC: ~1h)** — formulas — extend `calculateValuation` (driver-based) + `planExitTrajectory` + `valueUpliftLevers`; reconcile EBITDA def + version outputs
  - Surfaced by: Outside voice #6. Files: `lib/formulas.js`, `analytics.service.js`. Verify: regression (existing outputs) + golden
- [ ] **T7 (P1, human: ~4h / CC: ~30min)** — formulas — `calculateChairStats`, `calculateOcpspd`, `profitPerChairHour`; extend PL/cashflow
  - Surfaced by: §4. Files: `lib/formulas.js`. Verify: unit tests incl. 0-chairs/0-days guards
- [ ] **T8 (P1, human: ~3h / CC: ~30min)** — RBAC — add `finance.edit`/`valuation.edit`; gate all mutation endpoints; persisted edits audited
  - Surfaced by: Sec. Files: `lib/permissions.js`, route gates. Verify: Reception/read-only-PM blocked from edits (cross-role test)
- [ ] **T9 (P1, human: ~30min / CC: ~10min)** — schema — composite `idx_payments_org_processed (org, processed_at, status)`
  - Surfaced by: Perf #2. Files: migration. Verify: EXPLAIN uses index for day-range
- [ ] **T10 (P1, human: per-run / CC: per-run)** — QA — run `/qa` + `/browse` against the test-plan artifact for all new UI
  - Surfaced by: Test review. Verify: critical paths green
- [ ] **T11 (P2, human: ~varies / CC: ~varies)** — frontend — port 12 views into existing screens using primitives + ScopePeriodBar
  - Surfaced by: scope decision (new UI). Files: `features/*`. Verify: scope/period reactive, British copy, no emojis
- [ ] **T12 (P2, human: ~1.5d / CC: ~1.5h)** — persistence — `valuation_inputs` + `chair_config` (org config, RLS, audited)
  - Surfaced by: §6. Verify: RLS cross-org isolation, audit rows
- [ ] **T13 (P3, human: ~2d / CC: ~2h)** — editable P&L — resolve TODO1 precedence, then `pl_sheets` (Postgres, audited, CSV export)
  - Surfaced by: scope (full coverage) + Outside voice #3. Verify: precedence rule documented + tested

---

## 12. TODOS.md additions

- **P&L sheet precedence** — design the Xero-actuals vs monthly_financials-manual vs sheet-edit
  precedence (revert/stick/stale on re-sync; does an edit feed EBITDA?). Resolve at the sheets slice.
  Context: `analytics.service.pl()` already does Xero>manual + `basis` flag.
- **Per-org benchmarks/roster/weekday config** — promote documented constants to config tables when an
  org needs to tune UK-standard benchmarks or associate roster templates.
- **Day = real production** — revisit when a verified daily activity source exists (Dentally appt re-sync).
- **Existing ~50-screen reskin sweep** — migrate legacy screens to the new green/gold tokens after the analytics screens ship (token swap is mostly central + a per-screen pass). Accepts a temporary visual seam.

---

## 13. Design decisions (design review)

Prototype is pixel-complete; mockups skipped. Decisions:

| # | Decision | Choice |
|---|---|---|
| Nav | OS ↔ existing sidebar | Map each view into its existing route (Workbench→/profit, Sale Planner→/valuation…); scope/period in topbar. No parallel nav |
| Design system | Palette collision (green/gold vs amber/slate) | **Adopt the new green/gold system app-wide.** Type system already matches (Fraunces+Inter) |
| States | loading/empty/error/recalculating | **Full state table per view** (see below) — skeletons not spinners; inline "recalculating" on workbench debounce; warm empty states w/ primary action; retry on error; keep Academy/Lab clinical-view note |
| A11y | heat matrix | Keep £ value + add a non-colour cue (intensity bar / rank) — WCAG 1.4.1, not colour-only |
| Responsive | wide tables | Horizontal scroll acceptable for dense financial tables; **stack KPI strips** on mobile; one intentional breakpoint min |
| A11y misc | glyphs, contrast | Decorative glyphs → app icon set + `aria-hidden`; bump `--soft #84958c` to ≥4.5:1 on white for body text |

**Token work (this plan):** extract the prototype's palette/radius/shadow into a new `DESIGN.md`
+ `globals.css` / `tailwind.config.ts` (accent → `#1d6e5f`, accent-2 `#c6a253`, bg `#eef3ef`,
radius 12-18, heavier shadow). Build the shared `components/ui` primitives (eng CQ1) in these
tokens. New analytics screens ship on the new system; legacy 50 screens migrate via the deferred sweep.

**State table (fill per view during port):**

```
VIEW          | LOADING        | EMPTY/ZERO-DATA            | ERROR              | RECALCULATING
--------------|----------------|----------------------------|--------------------|----------------
Overview      | skeleton cards | "Connect Xero/Dentally" CTA| retry banner       | n/a
Workbench     | skeleton       | defaults shown             | "couldn't compute" | inline "recalculating…"
Valuation     | skeleton       | "add EBITDA inputs" CTA    | retry              | inline on slider settle
Chair/Clinic  | skeleton       | Academy/Lab → existing note| retry              | n/a
Treatments    | skeleton       | "no treatments in period"  | retry              | n/a
P&L/Cashflow  | skeleton       | "no financials for period" | retry              | n/a
```

**Design tasks:** D1 Create DESIGN.md + token migration (globals.css/tailwind) [P1]. D2 Per-view
state table implementation [P1]. D3 Heat-matrix non-colour cue [P2]. D4 Responsive (stack KPIs) +
a11y (glyph aria-hidden, contrast) [P2]. D5 Legacy 50-screen reskin sweep [P3, deferred].

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES (claude) | 9 missed items surfaced |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | REVIEWED | 9 issues, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAN | score 6→9/10, 6 decisions |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | n/a |

- **CODEX:** Outside voice (Claude subagent — codex not installed) surfaced 9 items the eng
  review under-weighted; 4 folded into locked decisions (Day semantics, write-gate/audit, kind
  read-path audit, EBITDA reconciliation), 2 → TODOs, rest → implementation tasks.
- **CROSS-MODEL:** 2 eng tensions resolved by user — (1) Day data → "cash-receipts-by-day, labelled"
  (only daily field is settled-cash, not production); (2) write endpoints → new `finance.edit`/`valuation.edit`.
- **DESIGN:** 6→9/10. Decisions: adopt the new green/gold system **app-wide** (legacy 50-screen
  reskin deferred to a tracked sweep); map 12 views into existing routes (no new nav); full per-view
  state table; heat-matrix non-colour cue (WCAG); responsive KPI stacking + glyph/contrast a11y.
  Mockups skipped — prototype is pixel-complete. 6 design tasks (D1-D6) emitted.
- **UNRESOLVED:** 0.
- **CRITICAL GAP:** 1 — the `kind` read-path audit (T2) is a Phase-0 exit gate; missing it corrupts
  legacy practice rollups (phantom Academy/Lab rows, chair div-by-zero).
- **VERDICT:** ENG + DESIGN CLEARED — scope reframed (extend, not rebuild). 13 eng tasks + 6 design
  tasks, 3 mandatory regression suites + golden-value tolerance tests, full state table, app-wide
  green/gold token migration. Ready to implement Phase 0 (Lane A): tokens/DESIGN.md + shared
  primitives + scope/period engine + practices.kind + kind read-path audit. Run /ship when work lands.
