# Business Health — real-data metrics engine

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan
**Page:** `/health-setup` (wizard) → `/progress` (tracker) → `/kpiscorecard` (scorecard)
**Approach:** A — single metrics resolver + JSONB manual store, live actuals from `analytics.service`.

## Problem

The Business Health feature (setup wizard, progress tracker, KPI scorecard) is wired
to a real API for *setup input*, but the *comparison / progress* half is broken or mock:

1. **Progress "current" is dead.** `business-health.service.js:111` reads
   `const latest = snapshots?.[snapshots.length - 1]?.metrics || baseline`. The cron
   worker (`workers/index.js`) writes snapshots shaped `{pl, ltv, marketingROI, counts, ...}`,
   but `progress()` reads `latest.revenue / latest.profit / latest.conversion / ...`.
   Shape mismatch → `current` is always `undefined`/blank, or silently equals baseline.
   It never touches `analytics.service`, which holds the real Dentally/Xero/GHL/CSV actuals.
2. **KPI Scorecard is 100% static.** `KpiScorecardScreen.tsx` renders a hardcoded
   23-item array. No API call.
3. **Several metrics have no data source anywhere** (NPS, retention, recall compliance,
   lead response time, aged debtors, same-day fill).

Goal: every metric shows **real-or-honestly-manual** numbers, end-to-end, no errors,
org-scoped per the multi-tenant SaaS rules.

## Decisions

- **Auto where a source exists, manual fallback otherwise.** Each metric is tagged with
  its provenance (`auto · <source>` or `manual · <asof>`). No fake numbers; unset manual
  metrics render a "No data — enter value" state.
- **Live computation, not snapshot-driven.** "Current" auto-values are computed on read
  from `analytics.service` (same actuals the Business Hub uses). Snapshots remain the
  historical-trend record only.
- **One JSONB column for manual values.** Fits the existing `business_health.baseline/targets`
  JSONB pattern; avoids a new table for ~6–10 manual values.

## Architecture

```
catalog (lib/health-metrics.js)
   -> resolver (business-health.service.metrics)
        auto  -> analytics.service (org-scoped actuals: monthly_financials, payments, appointments, leads, treatment_plans, contacts)
        manual-> business_health.manual JSONB
   -> GET /api/health/metrics  (unified array)
        -> ProgressScreen  (baseline -> current -> target, per-row source/asof tag)
        -> KpiScorecardScreen (traffic-light cards, source chip / inline edit)
   -> PATCH /api/health/metrics/:key (owner-only manual write, audited)
```

### 1. Metric catalog — `backend/src/lib/health-metrics.js`

Single source of truth for both backend resolution and frontend rendering. The frontend
renders from the endpoint payload — it does **not** keep its own metric array.

Each entry:

```js
{
  key: 'revenue_per_chair',
  label: 'Revenue per chair (monthly)',
  cat: 'Financial',           // Financial | Patient | Conversion | Operational
  unit: '£',                  // '£' | '%' | 'min' | ''
  better: 'higher',           // 'higher' | 'lower'
  sourceType: 'auto',         // 'auto' | 'manual'
  source: 'Xero',             // display label for the provenance chip (auto only)
  resolver: 'revenuePerChair' // name of the resolver fn (auto only)
}
```

**Source mapping:**

| Metric | sourceType | Source / resolver |
|---|---|---|
| Net profit margin, EBITDA margin, Lab cost %, Staff cost % | auto | `analytics.pl()` ← `monthly_financials` (Xero/CSV) |
| Annual revenue, Revenue per chair, Collections rate | auto | settled-payment RPCs ← `payments` (Dentally/CSV) |
| Cash at bank | auto | `analytics.dashboardSummary()` ← `bank_accounts` |
| New patients/mo, Active patient base | auto | `contacts` (Dentally) |
| Lead→consult, Consult→treatment, Lead→treatment, Avg case value | auto | `analytics.kpis()` ← `leads` + `appointments` + `treatment_plans` |
| FTA/no-show rate, Chair utilisation | auto | `appointments` (Dentally) |
| Production per associate /mo, UDA delivery vs contract | auto | `treatment_plans` (Dentally) |
| Lifetime value (private) | auto | `analytics.calculateLTV` |
| NPS, Patient retention (12mo), Recall compliance, Lead response time, Aged debtors >90d, Same-day appointment fill | manual | `business_health.manual[key]` |

(Final auto/manual split confirmed during implementation against what each resolver can
actually compute; any auto metric that returns no source falls back to a manual/`needsInput`
state rather than a fabricated number.)

### 2. Resolver — `business-health.service.js` `metrics(orgId)`

- Iterate the catalog.
  - `auto` → call the named `analytics.service` resolver (all already org-scoped).
  - `manual` → read `business_health.manual[key]` → `{ value, asof }` or null.
- For each: assemble `baseline` (from `business_health.baseline`), `current`, `target`
  (from `business_health.targets`, with the existing derive-from-baseline fallback),
  `source`, `asof`, then spread `calculateProgress({baseline, current, target, better})`.
- Returns `{ metrics: [...] }`.
- **Rewrite `progress()`** to delegate to this resolver (kills the snapshot shape bug).
  Keeps its existing extra fields (`target_year`, `required_cagr_pct`, `target_profit`,
  `snapshots`). The hero "profit" metric still resolves from the unified array.

### 3. Storage — migration `..._000030_health_manual_metrics.sql` (000031 if /staff took 000030)

```sql
ALTER TABLE business_health
  ADD COLUMN IF NOT EXISTS manual JSONB NOT NULL DEFAULT '{}';
```

- Idempotent; re-applies cleanly on `supabase db reset`.
- Mirror into `db/01_schema.sql` (unmanaged source copy).
- After hosted DDL: `NOTIFY pgrst, 'reload schema';`.
- **Worker fix (rider):** `workers/index.js` writes periodic snapshots in the catalog
  metric shape so the historical trend matches the live tracker. Not the critical path.

### 4. Endpoints — `business-health.routes.js` + controller + model

- `GET /api/health/metrics` — unified array. Auth required; reception gets the existing
  stub (CRM-only rule). Org-scoped via `req.user.organisation_id`.
- `PATCH /api/health/metrics/:key` — body `{ value: number }`, Zod-validated;
  `requireRole('owner')`; key must exist in the catalog and be `sourceType: 'manual'`
  (reject auto keys 400). Writes `business_health.manual[key] = { value, asof: today }`.
  Audited by the `audit` middleware.
- Repo methods replicate the explicit `.eq('organisation_id', orgId)` filter
  (serviceClient path, per repo convention — no automatic isolation).

### 5. Frontend — `frontend/features/health/`

- **`api.ts`** (already exists) — add `getMetrics()`, `updateMetric(key, value)`.
- **`hooks.ts`** — add `useMetrics()`, `useUpdateMetric()` (React Query; invalidate on mutate).
- **`KpiScorecardScreen.tsx`** — delete the static `KPIS` array; render from `useMetrics()`.
  Auto rows show a `source` chip; manual rows show value + `asof` + an inline `[edit]`
  (owner-only via `useMe()`), opening a small number input → `updateMetric`. Unset manual →
  "No data — enter value". Traffic-light + progress-bar logic unchanged. Keep the
  summary strip (green/amber/red counts) computed from the live array.
- **`ProgressScreen.tsx`** — unchanged data contract (consumes `/progress`); add a per-row
  `source · asof` tag now that `current` is real.

### 6. Multi-tenancy, RBAC, SaaS guarantees (rules 3,4,5,8,9)

- Every read/write filtered by `organisation_id`; cross-org isolation test added.
- Manual writes owner-only; reception → CRM-only stub; PM finance access stays Owner-toggled.
- All mutations audited to `audit_log` (user_id, org_id, diff).
- British English, £ integer pence (`(pence/100).toLocaleString('en-GB')`), no emojis,
  no dark mode, no fabricated numbers.

### 7. Tests (vitest, `backend/test/`) + docs

- Resolver: auto metric pulls actuals; manual metric pulls JSONB; unset → null + `needsInput`.
- `progress()` returns real `current` (regression test for the shape-mismatch bug).
- `PATCH /api/health/metrics/:key`: owner 200; reception/PM 403; auto-key rejected 400;
  cross-org isolation (org A cannot write org B).
- Update `docs/API.md` (two new endpoints) and `docs/FORMULAS.md` if any new formula is
  added (rule: new/changed formula → `FORMULAS.md` + unit test).

## Scope boundaries (YAGNI)

- **In:** catalog, resolver, two endpoints, one JSONB column, two screen rewrites,
  worker snapshot-shape fix, tests, docs.
- **Out:** per-practice targets (business_health is org-level only), a dedicated
  per-metric table (deferred — Approach B), new accounting/source integrations, the
  setup wizard steps (already wired and working).

## Coordination

- Parallel `/staff` session may also claim migration `000030`. Whoever lands second bumps
  to `000031`. Expect a tiny `backend/src/app.js` merge if both wire a router (different
  routers, trivial resolve). No other shared files.
