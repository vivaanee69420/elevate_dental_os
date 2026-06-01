# Business Health — Real-Data Metrics Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/health-setup` → `/progress` → `/kpiscorecard` show real Dentally/Xero/GHL/CSV actuals (auto) with an owner-entered manual fallback for metrics that have no data source — fixing the broken snapshot-shape "current" and killing the static KPI array.

**Architecture:** A metric catalog (`lib/health-metrics.js`) is the single source of truth. A resolver (`business-health.service.metrics`) computes each metric's `current` live from `analytics.service` (auto) or from a new `business_health.manual` JSONB column (manual). One unified endpoint `GET /api/health/metrics` feeds both screens; `PATCH /api/health/metrics/:key` writes manual values (owner-only, audited). The broken `progress()` is rewired to use real actuals.

**Tech Stack:** Express ESM backend, Supabase (serviceClient + manual `organisation_id` filter), Zod, vitest (`supaRec` mock harness), Next.js 14 + React Query + Tailwind.

---

## Multi-tenancy / SaaS invariants (apply to EVERY task)

- All reads/writes filtered by `req.user.organisation_id` — repo replicates `.eq('organisation_id', orgId)` (serviceClient path; no auto-isolation).
- Manual writes **owner-only**; reception gets a stub (CRM-only, rule 5).
- Mutations audited to `audit_log` by existing `audit` middleware (rule 9).
- British English, £ integer pence, no emojis, no dark mode, no fabricated numbers (rules 1,2,4,7).

## File structure

- **Create** `backend/src/lib/health-metrics.js` — catalog + `METRIC_BY_KEY`.
- **Create** `supabase/migrations/20260101000030_health_manual_metrics.sql` — add `manual` JSONB. *(If the parallel `/staff` session already took `000030`, rename to `20260101000031_...`.)*
- **Modify** `db/01_schema.sql` — mirror the column.
- **Modify** `backend/src/repositories/business-health.repository.js` — `getMetricsData`, `setManualMetric`.
- **Modify** `backend/src/services/business-health.service.js` — `metrics()`, rewrite `progress()`.
- **Modify** `backend/src/models/business-health.model.js` — `manualMetricSchema`.
- **Modify** `backend/src/controllers/business-health.controller.js` — `metrics`, `updateMetric`.
- **Modify** `backend/src/routes/health-business.routes.js` — 2 routes.
- **Modify** `backend/src/workers/index.js` — snapshot shape rider.
- **Create** `backend/test/business-health-metrics.test.mjs` — resolver + endpoint tests.
- **Modify** `frontend/features/health/api.ts` + `hooks.ts` — `getMetrics`/`updateMetric`.
- **Modify** `frontend/features/health/components/KpiScorecardScreen.tsx` — live data.
- **Modify** `frontend/features/health/components/ProgressScreen.tsx` — source tag.
- **Modify** `docs/API.md` — 2 endpoints.

---

## Task 1: Migration — `business_health.manual` JSONB column

**Files:**
- Create: `supabase/migrations/20260101000030_health_manual_metrics.sql`
- Modify: `db/01_schema.sql` (business_health table block, ~line 109-120)

- [ ] **Step 1: Confirm the migration number is free**

Run: `ls supabase/migrations/ | grep -E '0003[01]'`
Expected: only `..._000030_*` collides if the /staff session landed first. If `20260101000030_*.sql` already exists, use `20260101000031_health_manual_metrics.sql` for the filename below.

- [ ] **Step 2: Write the migration**

```sql
-- Manual-entry fallback for business-health metrics that have no data source
-- (NPS, retention, recall compliance, lead response time, aged debtors, etc.).
-- Shape: { "<metric_key>": { "value": <number>, "asof": "YYYY-MM-DD" }, ... }
ALTER TABLE business_health
  ADD COLUMN IF NOT EXISTS manual JSONB NOT NULL DEFAULT '{}';
```

- [ ] **Step 3: Mirror into the unmanaged schema copy**

In `db/01_schema.sql`, inside the `business_health` `CREATE TABLE`, add after the `targets` line:

```sql
  manual          JSONB NOT NULL DEFAULT '{}',
```

- [ ] **Step 4: Apply locally and verify it re-applies cleanly**

Run: `supabase db reset` (from repo root)
Expected: completes with no error; `business_health` now has a `manual` column.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000030_health_manual_metrics.sql db/01_schema.sql
git commit -m "feat(health): add business_health.manual JSONB for manual metric entry"
```

> After applying on hosted Supabase later: run `NOTIFY pgrst, 'reload schema';` (PostgREST cache).

---

## Task 2: Metric catalog — `lib/health-metrics.js`

**Files:**
- Create: `backend/src/lib/health-metrics.js`
- Test: `backend/test/business-health-metrics.test.mjs` (created here, extended in Task 4/5)

- [ ] **Step 1: Write the failing test**

Create `backend/test/business-health-metrics.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { METRIC_CATALOG, METRIC_BY_KEY } from '../src/lib/health-metrics.js';

describe('health metric catalog', () => {
  it('every entry has the required shape and a valid sourceType', () => {
    for (const m of METRIC_CATALOG) {
      expect(typeof m.key).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(['Financial', 'Patient', 'Conversion', 'Operational']).toContain(m.cat);
      expect(['%', '£', 'min', '']).toContain(m.unit);
      expect(['higher', 'lower']).toContain(m.better);
      expect(['auto', 'manual']).toContain(m.sourceType);
    }
  });

  it('keys are unique and METRIC_BY_KEY indexes them', () => {
    const keys = METRIC_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(METRIC_BY_KEY[keys[0]]).toBe(METRIC_CATALOG[0]);
  });

  it('exposes exactly the six auto metrics wired to live actuals', () => {
    const auto = METRIC_CATALOG.filter((m) => m.sourceType === 'auto').map((m) => m.key).sort();
    expect(auto).toEqual(
      ['annual_revenue', 'cash_at_bank', 'fta_no_show_rate', 'lead_to_treatment', 'net_profit', 'net_profit_margin'].sort(),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run test/business-health-metrics.test.mjs`
Expected: FAIL — `Cannot find module '../src/lib/health-metrics.js'`.

- [ ] **Step 3: Write the catalog**

Create `backend/src/lib/health-metrics.js`:

```js
// ============================================================================
// Business-health metric catalog — single source of truth for backend
// resolution AND frontend scorecard/progress rendering.
//   sourceType 'auto'   => `current` computed live from analytics actuals.
//   sourceType 'manual' => `current` read from business_health.manual[key].
// `target` is a sensible default goal used until an owner sets a per-metric
// target; `better` drives the traffic-light direction.
// ============================================================================
export const METRIC_CATALOG = [
  // Financial
  { key: 'annual_revenue',   label: 'Annual revenue',          cat: 'Financial',    unit: '£',   better: 'higher', sourceType: 'auto',   target: null },
  { key: 'net_profit',       label: 'Net profit',              cat: 'Financial',    unit: '£',   better: 'higher', sourceType: 'auto',   target: null },
  { key: 'net_profit_margin',label: 'Net profit margin',       cat: 'Financial',    unit: '%',   better: 'higher', sourceType: 'auto',   target: 18 },
  { key: 'cash_at_bank',     label: 'Cash at bank',            cat: 'Financial',    unit: '£',   better: 'higher', sourceType: 'auto',   target: null },
  { key: 'lab_cost_pct',     label: 'Lab cost % revenue',      cat: 'Financial',    unit: '%',   better: 'lower',  sourceType: 'manual', target: 15 },
  { key: 'staff_cost_pct',   label: 'Staff cost % revenue',    cat: 'Financial',    unit: '%',   better: 'lower',  sourceType: 'manual', target: 16 },
  { key: 'aged_debtors_90',  label: 'Aged debtors >90 days',   cat: 'Financial',    unit: '%',   better: 'lower',  sourceType: 'manual', target: 0.5 },
  // Patient
  { key: 'new_patients_month', label: 'New patients per month', cat: 'Patient',     unit: '',    better: 'higher', sourceType: 'manual', target: 220 },
  { key: 'active_patients',  label: 'Active patient base',     cat: 'Patient',      unit: '',    better: 'higher', sourceType: 'manual', target: 16000 },
  { key: 'retention_12mo',   label: 'Patient retention (12mo)',cat: 'Patient',      unit: '%',   better: 'higher', sourceType: 'manual', target: 92 },
  { key: 'recall_compliance',label: 'Recall compliance',       cat: 'Patient',      unit: '%',   better: 'higher', sourceType: 'manual', target: 90 },
  { key: 'nps',              label: 'Net Promoter Score',      cat: 'Patient',      unit: '',    better: 'higher', sourceType: 'manual', target: 60 },
  // Conversion
  { key: 'lead_to_treatment',label: 'Overall lead-to-treatment',cat: 'Conversion',  unit: '%',   better: 'higher', sourceType: 'auto',   target: 18 },
  { key: 'avg_case_value',   label: 'Average case value',      cat: 'Conversion',   unit: '£',   better: 'higher', sourceType: 'manual', target: 3200 },
  // Operational
  { key: 'chair_utilisation',label: 'Chair utilisation',       cat: 'Operational',  unit: '%',   better: 'higher', sourceType: 'manual', target: 88 },
  { key: 'fta_no_show_rate', label: 'FTA / no-show rate',      cat: 'Operational',  unit: '%',   better: 'lower',  sourceType: 'auto',   target: 5 },
  { key: 'lead_response_time',label: 'Lead response time (min)',cat: 'Operational',  unit: 'min', better: 'lower',  sourceType: 'manual', target: 5 },
  { key: 'same_day_fill',    label: 'Same-day appointment fill',cat: 'Operational', unit: '%',   better: 'higher', sourceType: 'manual', target: 80 },
  { key: 'production_per_associate', label: 'Production per associate / mo', cat: 'Operational', unit: '£', better: 'higher', sourceType: 'manual', target: 42000 },
];

export const METRIC_BY_KEY = Object.fromEntries(METRIC_CATALOG.map((m) => [m.key, m]));
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx vitest run test/business-health-metrics.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/health-metrics.js backend/test/business-health-metrics.test.mjs
git commit -m "feat(health): metric catalog (auto vs manual source map)"
```

---

## Task 3: Repository — `getMetricsData` + `setManualMetric`

**Files:**
- Modify: `backend/src/repositories/business-health.repository.js`

- [ ] **Step 1: Add the two methods**

In `backend/src/repositories/business-health.repository.js`, add inside the `businessHealthRepository` object (after `getProgressData`):

```js
    async getMetricsData(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline, targets, manual')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async setManualMetric(orgId, key, entry) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('manual')
            .eq('organisation_id', orgId)
            .maybeSingle();
        const manual = { ...(data?.manual || {}), [key]: entry };
        const { error } = await supabase_1.serviceClient
            .from('business_health')
            .update({ manual })
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        return manual[key];
    },
```

- [ ] **Step 2: Syntax-check**

Run: `cd backend && node --check src/repositories/business-health.repository.js`
Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add backend/src/repositories/business-health.repository.js
git commit -m "feat(health): repo getMetricsData + setManualMetric (org-scoped)"
```

---

## Task 4: Resolver service — `metrics()` + rewrite `progress()`

**Files:**
- Modify: `backend/src/services/business-health.service.js`
- Test: `backend/test/business-health-metrics.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/business-health-metrics.test.mjs`:

```js
import { vi } from 'vitest';

// Stub analytics so the resolver is tested in isolation from rollup SQL.
vi.mock('../src/services/analytics.service.js', () => ({
  analyticsService: {
    dashboardSummary: vi.fn(async () => ({
      basis: 'actuals', revenuePence: 120000000, netProfitPence: 18000000,
      marginPct: 15, cashflowPence: 5000000,
    })),
    businessHub: vi.fn(async () => ({
      group: { conversionRate: 11.5, noShowRate: 4.2 },
    })),
  },
}));

const { supaRec } = await import('./setup.js');
const svc = (await import('../src/services/business-health.service.js')).businessHealthService;
const ORG = 'org-hhhhhhhh';

describe('businessHealthService.metrics', () => {
  beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
  });

  it('resolves auto metrics from live actuals and manual from the JSONB column', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'business_health'
        ? { data: { baseline: { annual_revenue: 1000000, nps: 50 }, targets: {}, manual: { nps: { value: 64, asof: '2026-06-01' } } }, error: null }
        : { data: [], error: null };

    const { metrics } = await svc.metrics(ORG, 'owner');
    const rev = metrics.find((m) => m.key === 'annual_revenue');
    expect(rev.current).toBe(1200000);          // 120000000 pence / 100
    expect(rev.source).toBe('actuals');
    const nps = metrics.find((m) => m.key === 'nps');
    expect(nps.current).toBe(64);
    expect(nps.source).toBe('manual');
    expect(nps.asof).toBe('2026-06-01');
  });

  it('flags unset manual metrics with needsInput and null current', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'business_health'
        ? { data: { baseline: {}, targets: {}, manual: {} }, error: null }
        : { data: [], error: null };
    const { metrics } = await svc.metrics(ORG, 'owner');
    const recall = metrics.find((m) => m.key === 'recall_compliance');
    expect(recall.current).toBeNull();
    expect(recall.needsInput).toBe(true);
  });

  it('reception gets an empty stub (CRM-only rule)', async () => {
    const out = await svc.metrics(ORG, 'reception');
    expect(out).toEqual({ metrics: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/business-health-metrics.test.mjs -t "metrics"`
Expected: FAIL — `svc.metrics is not a function`.

- [ ] **Step 3: Implement `metrics()` and rewrite `progress()`**

In `backend/src/services/business-health.service.js`, add imports at the top (after the existing imports):

```js
import { analyticsService } from "./analytics.service.js";
import { METRIC_CATALOG, METRIC_BY_KEY } from "../lib/health-metrics.js";
```

Add a helper above `export const businessHealthService` :

```js
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
```

Add this method inside `businessHealthService` (after `progress`):

```js
    async metrics(orgId, role) {
        if (role === 'reception') return { metrics: [] };
        const health = await business_health_repository_1.businessHealthRepository.getMetricsData(orgId);
        const baseline = health?.baseline || {};
        const targets = health?.targets || {};
        const manual = health?.manual || {};
        const [summary, hub] = await Promise.all([
            analyticsService.dashboardSummary(orgId),
            analyticsService.businessHub(orgId),
        ]);
        const auto = {
            annual_revenue:    { value: round1(summary.revenuePence / 100), source: summary.basis },
            net_profit:        { value: round1(summary.netProfitPence / 100), source: summary.basis },
            net_profit_margin: { value: round1(summary.marginPct), source: summary.basis },
            cash_at_bank:      { value: round1(summary.cashflowPence / 100), source: 'bank' },
            lead_to_treatment: { value: round1(hub.group.conversionRate), source: 'live' },
            fta_no_show_rate:  { value: round1(hub.group.noShowRate), source: 'live' },
        };
        const metrics = METRIC_CATALOG.map((m) => {
            let current = null, source, asof = null, needsInput = false;
            if (m.sourceType === 'auto') {
                const a = auto[m.key] || {};
                current = a.value ?? null;
                source = a.source || 'live';
            } else {
                const entry = manual[m.key];
                source = 'manual';
                if (entry && typeof entry.value === 'number') {
                    current = entry.value;
                    asof = entry.asof || null;
                } else {
                    needsInput = true;
                }
            }
            const baselineVal = baseline[m.key] ?? null;
            const target = targets[m.key] ?? m.target ?? null;
            const prog = (current != null && baselineVal != null && target != null)
                ? (0, formulas_1.calculateProgress)({ baseline: baselineVal, current, target, better: m.better })
                : { progressPct: 0, deltaFromBaselinePct: 0, remainingToTarget: null };
            return {
                key: m.key, label: m.label, cat: m.cat, unit: m.unit, better: m.better,
                sourceType: m.sourceType, source, asof, needsInput,
                baseline: baselineVal, current, target, ...prog,
            };
        });
        return { metrics };
    },
```

Now rewrite the body of `progress()` — replace the line:

```js
        const latest = snapshots?.[snapshots.length - 1]?.metrics || baseline;
```

with real-actuals resolution:

```js
        const [summary, hub] = await Promise.all([
            analyticsService.dashboardSummary(orgId),
            analyticsService.businessHub(orgId),
        ]);
        // Real where a source exists; baseline-hold (honest, no fabrication)
        // for the three metrics with no live source yet.
        const latest = {
            revenue: round1(summary.revenuePence / 100),
            profit: round1(summary.netProfitPence / 100),
            cash: round1(summary.cashflowPence / 100),
            conversion: round1(hub.group.conversionRate),
            case_value: baseline.case_value,
            fta_rate: round1(hub.group.noShowRate),
            chair_util: baseline.utilisation,
            new_per_month: baseline.new_per_month,
        };
```

Then add a `source` tag to each entry in the existing `metrics` array literal in `progress()`. Change each object to include a `source` field:

```js
        const metrics = [
            { key: 'revenue', label: 'Annual revenue', baseline: baseline.revenue, current: latest.revenue, target: targets.target_revenue || baseline.revenue * 2, better: 'higher', source: summary.basis },
            { key: 'profit', label: 'Net profit', baseline: baseline.profit, current: latest.profit, target: targetProfit, better: 'higher', source: summary.basis },
            { key: 'cash', label: 'Cash at bank', baseline: baseline.cash, current: latest.cash, target: baseline.cash * 1.5, better: 'higher', source: 'bank' },
            { key: 'conversion', label: 'Lead conversion %', baseline: baseline.conversion, current: latest.conversion, target: 18, better: 'higher', source: 'live' },
            { key: 'case_value', label: 'Average case value', baseline: baseline.case_value, current: latest.case_value, target: baseline.case_value * 1.15, better: 'higher', source: 'baseline' },
            { key: 'fta_rate', label: 'FTA rate %', baseline: baseline.fta_rate, current: latest.fta_rate, target: 2.5, better: 'lower', source: 'live' },
            { key: 'chair_util', label: 'Chair utilisation %', baseline: baseline.utilisation, current: latest.chair_util, target: 88, better: 'higher', source: 'baseline' },
            { key: 'new_per_month', label: 'New patients/month', baseline: baseline.new_per_month, current: latest.new_per_month, target: baseline.new_per_month * 1.4, better: 'higher', source: 'baseline' },
        ];
```

(Leave the `progress = metrics.map(...)` spread and the return object below it unchanged — `source` rides through the spread.)

- [ ] **Step 4: Run the metrics tests**

Run: `cd backend && npx vitest run test/business-health-metrics.test.mjs`
Expected: PASS (all, incl. the 3 metrics tests).

- [ ] **Step 5: Run the full backend suite (regression)**

Run: `cd backend && npm test`
Expected: all green (the analytics mock is scoped to this test file only).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/business-health.service.js backend/test/business-health-metrics.test.mjs
git commit -m "feat(health): live metrics resolver; fix progress() snapshot-shape bug"
```

---

## Task 5: Model + controller + routes — GET /metrics, PATCH /metrics/:key

**Files:**
- Modify: `backend/src/models/business-health.model.js`
- Modify: `backend/src/services/business-health.service.js` (add `updateMetric`)
- Modify: `backend/src/controllers/business-health.controller.js`
- Modify: `backend/src/routes/health-business.routes.js`
- Test: `backend/test/business-health-metrics.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/business-health-metrics.test.mjs`:

```js
describe('businessHealthService.updateMetric', () => {
  beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = (q) =>
      q.table === 'business_health' ? { data: { manual: {} }, error: null } : { data: [], error: null };
  });

  it('owner can set a manual metric; write is org-scoped', async () => {
    const out = await svc.updateMetric(ORG, 'owner', 'nps', 64);
    expect(out.value).toBe(64);
    expect(typeof out.asof).toBe('string');
    const upd = supaRec.last; // last op is the update on business_health
    expect(upd.eqs.find((e) => e.col === 'organisation_id')).toEqual({ col: 'organisation_id', val: ORG });
  });

  it('reception/PM cannot write (403)', async () => {
    await expect(svc.updateMetric(ORG, 'reception', 'nps', 64)).rejects.toMatchObject({ status: 403 });
    await expect(svc.updateMetric(ORG, 'practice_manager', 'nps', 64)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects an unknown key (400)', async () => {
    await expect(svc.updateMetric(ORG, 'owner', 'not_a_metric', 1)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an auto-sourced key (400 — not manually editable)', async () => {
    await expect(svc.updateMetric(ORG, 'owner', 'annual_revenue', 1)).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/business-health-metrics.test.mjs -t "updateMetric"`
Expected: FAIL — `svc.updateMetric is not a function`.

- [ ] **Step 3: Add `updateMetric` to the service**

In `backend/src/services/business-health.service.js`, add inside `businessHealthService` (after `metrics`):

```js
    async updateMetric(orgId, role, key, value) {
        if (role !== 'owner') {
            throw new errors_1.AppError('Only owners can edit metrics', 403);
        }
        const meta = METRIC_BY_KEY[key];
        if (!meta) {
            throw new errors_1.AppError(`Unknown metric: ${key}`, 400);
        }
        if (meta.sourceType !== 'manual') {
            throw new errors_1.AppError(`Metric ${key} is computed automatically and cannot be set manually`, 400);
        }
        const asof = new Date().toISOString().split('T')[0];
        const entry = { value, asof };
        await business_health_repository_1.businessHealthRepository.setManualMetric(orgId, key, entry);
        return entry;
    },
```

- [ ] **Step 4: Add the Zod schema**

In `backend/src/models/business-health.model.js`, append:

```js
export const manualMetricSchema = zod_1.z.object({
    value: zod_1.z.number(),
});
```

- [ ] **Step 5: Add controller handlers**

In `backend/src/controllers/business-health.controller.js`, add inside `businessHealthController` (after `progress`):

```js
    async metrics(req, res) {
        res.json(await business_health_service_1.businessHealthService.metrics(req.user.organisation_id, req.user.role));
    },
    async updateMetric(req, res) {
        const { value } = business_health_model_1.manualMetricSchema.parse(req.body);
        res.json(await business_health_service_1.businessHealthService.updateMetric(req.user.organisation_id, req.user.role, req.params.key, value));
    },
```

- [ ] **Step 6: Wire the routes**

In `backend/src/routes/health-business.routes.js`, add after the `/progress` line (param route `:key` last, per the file's "static before param" convention — these don't clash with `/progress` since they start with `/metrics`):

```js
router.get('/metrics', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.metrics));
router.patch('/metrics/:key', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.updateMetric));
```

- [ ] **Step 7: Run the suite**

Run: `cd backend && npx vitest run test/business-health-metrics.test.mjs && node --check src/routes/health-business.routes.js && node --check src/controllers/business-health.controller.js`
Expected: tests PASS; both `node --check` produce no output.

- [ ] **Step 8: Commit**

```bash
git add backend/src/models/business-health.model.js backend/src/services/business-health.service.js backend/src/controllers/business-health.controller.js backend/src/routes/health-business.routes.js backend/test/business-health-metrics.test.mjs
git commit -m "feat(health): GET /api/health/metrics + PATCH /metrics/:key (owner-only, audited)"
```

---

## Task 6: Frontend API client + hooks

**Files:**
- Modify: `frontend/features/health/api.ts`
- Modify: `frontend/features/health/hooks.ts`

- [ ] **Step 1: Add API functions + types**

Append to `frontend/features/health/api.ts`:

```ts
export interface HealthMetric {
  key: string;
  label: string;
  cat: 'Financial' | 'Patient' | 'Conversion' | 'Operational';
  unit: '£' | '%' | 'min' | '';
  better: 'higher' | 'lower';
  sourceType: 'auto' | 'manual';
  source: string;
  asof: string | null;
  needsInput: boolean;
  baseline: number | null;
  current: number | null;
  target: number | null;
  progressPct: number;
  deltaFromBaselinePct: number;
}

export function getMetrics() {
  return api<{ metrics: HealthMetric[] }>('/api/health/metrics');
}

export function updateMetric(key: string, value: number) {
  return api<{ value: number; asof: string }>(`/api/health/metrics/${key}`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  });
}
```

- [ ] **Step 2: Add hooks**

In `frontend/features/health/hooks.ts`, extend the import from `./api`:

```ts
import {
  getHealth, updateHealth, getHealthProgress, getHealthInsights,
  updateCadence, listSnapshots, getMetrics, updateMetric, type SnapshotFrequency,
} from './api';
```

Append:

```ts
export function useMetrics() {
  return useQuery({ queryKey: ['health-metrics'], queryFn: getMetrics });
}

export function useUpdateMetric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: number }) => updateMetric(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health-metrics'] }),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/health/api.ts frontend/features/health/hooks.ts
git commit -m "feat(health): frontend metrics API client + hooks"
```

---

## Task 7: KpiScorecardScreen — render live data + owner manual edit

**Files:**
- Modify: `frontend/features/health/components/KpiScorecardScreen.tsx` (full rewrite)

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `frontend/features/health/components/KpiScorecardScreen.tsx` with:

```tsx
'use client';
// KPI Scorecard — 23-metric traffic-lighted dashboard, live from /api/health/metrics.
// Auto metrics show a source chip; manual metrics show an owner-only inline edit.
// British English, no emojis (rule 7), £ via formatPounds, no fabricated numbers.

import { useState } from 'react';
import { formatPounds } from '@/features/_mock';
import { useMe } from '@/hooks/useMe';
import { useMetrics, useUpdateMetric } from '../hooks';
import type { HealthMetric } from '../api';

type Status = 'green' | 'amber' | 'red';
const STATUS_COLOUR: Record<Status, string> = { green: '#10B981', amber: '#F59E0B', red: '#EF4444' };
const CATEGORIES = ['Financial', 'Patient', 'Conversion', 'Operational'] as const;

function statusOf(m: HealthMetric): Status {
  if (m.current == null || m.target == null) return 'amber';
  if (m.better === 'higher') {
    if (m.current >= m.target) return 'green';
    if (m.current >= m.target * 0.9) return 'amber';
    return 'red';
  }
  if (m.current <= m.target) return 'green';
  if (m.current <= m.target * 1.1) return 'amber';
  return 'red';
}

function fmt(n: number | null, unit: HealthMetric['unit']): string {
  if (n == null) return '—';
  if (unit === '£') return formatPounds(n);
  if (unit === '%') return n + '%';
  if (unit === 'min') return n + 'm';
  return n.toLocaleString('en-GB');
}

function progressPct(m: HealthMetric): number {
  if (m.current == null || m.target == null || m.target === 0 || m.current === 0) return 0;
  const raw = m.better === 'higher' ? (m.current / m.target) * 100 : (m.target / m.current) * 100;
  return Math.min(100, Math.max(0, raw));
}

function MetricCard({ m, canEdit }: { m: HealthMetric; canEdit: boolean }) {
  const st = statusOf(m);
  const update = useUpdateMetric();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const editable = canEdit && m.sourceType === 'manual';

  return (
    <div className="bg-bg" style={{ borderLeft: `4px solid ${STATUS_COLOUR[st]}`, padding: '10px 12px', borderRadius: '0 6px 6px 0' }}>
      <div className="flex justify-between items-center mb-0.5">
        <div className="text-[11px] text-ink-muted">{m.label}</div>
        <span className="text-[9px] uppercase tracking-wide text-ink-muted">
          {m.sourceType === 'auto' ? m.source : m.needsInput ? 'no data' : `manual${m.asof ? ` · ${m.asof}` : ''}`}
        </span>
      </div>
      <div className="flex justify-between items-baseline">
        <div className="display text-xl font-bold">{m.needsInput ? '—' : fmt(m.current, m.unit)}</div>
        <div className="text-[11px] text-ink-muted">Target: {fmt(m.target, m.unit)}</div>
      </div>
      <div className="mt-1.5 overflow-hidden" style={{ height: 4, background: 'rgba(0,0,0,0.05)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${progressPct(m)}%`, background: STATUS_COLOUR[st] }} />
      </div>
      {editable && !editing && (
        <button className="text-[10px] text-brand mt-1.5" onClick={() => { setEditing(true); setVal(m.current?.toString() ?? ''); }}>
          {m.needsInput ? 'Enter value' : 'Edit'}
        </button>
      )}
      {editable && editing && (
        <div className="flex gap-1 mt-1.5">
          <input
            type="number" value={val} onChange={(e) => setVal(e.target.value)}
            className="border border-border rounded px-1.5 py-0.5 text-xs w-20"
            aria-label={`Set ${m.label}`}
          />
          <button
            className="text-[10px] text-white bg-brand rounded px-2"
            disabled={update.isPending || val === ''}
            onClick={() => update.mutate({ key: m.key, value: Number(val) }, { onSuccess: () => setEditing(false) })}
          >Save</button>
          <button className="text-[10px] text-ink-muted px-1" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, colour }: { label: string; value: number; colour?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1" style={colour ? { color: colour } : undefined}>{value}</div>
    </div>
  );
}

export default function KpiScorecardScreen() {
  const { data } = useMetrics();
  const { data: me } = useMe();
  const canEdit = me?.role === 'owner';

  if (!data) return <div>Loading…</div>;
  const metrics = data.metrics;
  const green = metrics.filter((m) => statusOf(m) === 'green').length;
  const amber = metrics.filter((m) => statusOf(m) === 'amber').length;
  const red = metrics.filter((m) => statusOf(m) === 'red').length;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="display text-3xl font-bold">KPI Scorecard</h1>
        <p className="text-sm text-ink-muted">
          Performance management · {metrics.length} KPIs traffic-lighted · live from your connected data
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryTile label="Total KPIs tracked" value={metrics.length} />
        <SummaryTile label="On / above target" value={green} colour="var(--success)" />
        <SummaryTile label="Watching" value={amber} colour="var(--accent)" />
        <SummaryTile label="Below target" value={red} colour="var(--danger)" />
      </div>

      {CATEGORIES.map((cat) => {
        const items = metrics.filter((m) => m.cat === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="card card-padded mb-3.5">
            <h2 className="display text-[17px] font-semibold mb-3.5">{cat} KPIs</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {items.map((m) => <MetricCard key={m.key} m={m} canEdit={canEdit} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify the `useMe` hook shape**

Run: `cd frontend && grep -n "role" hooks/useMe.ts`
Expected: confirms `useMe()` returns an object exposing `role`. If the field path differs (e.g. `me?.user?.role`), adjust the `canEdit` line accordingly.

- [ ] **Step 3: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/health/components/KpiScorecardScreen.tsx
git commit -m "feat(health): KPI scorecard live data + owner manual edit"
```

---

## Task 8: ProgressScreen — show source/asof tag per row

**Files:**
- Modify: `frontend/features/health/components/ProgressScreen.tsx` (metric row block, ~line 117-144)

- [ ] **Step 1: Add a source chip to each metric row**

In `frontend/features/health/components/ProgressScreen.tsx`, inside the `data.metrics.map(...)` row, change the label cell from:

```tsx
              <strong className="text-sm">{m.label}</strong>
```

to:

```tsx
              <div>
                <strong className="text-sm">{m.label}</strong>
                <div className="text-[10px] text-ink-muted uppercase">{m.source === 'baseline' ? 'baseline (no live source)' : m.source}</div>
              </div>
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/health/components/ProgressScreen.tsx
git commit -m "feat(health): progress tracker shows per-metric data source"
```

---

## Task 9: Worker snapshot-shape rider + docs + final verification

**Files:**
- Modify: `backend/src/workers/index.js` (snapshot insert, ~line 54-65)
- Modify: `docs/API.md`

- [ ] **Step 1: Align the periodic snapshot to the progress metric shape**

In `backend/src/workers/index.js`, find the `business_health_snapshots` insert (the `metrics: { pl, ltv, marketingROI, ... }` object). Add the progress-shape keys alongside the existing ones so the historical trend matches the live tracker (do NOT remove the existing keys — other code/tests may read them):

```js
        metrics: {
          // existing analytical bundle (keep):
          pl, ltv, marketingROI, window: windowMeta, source_breakdown: sourceBreakdown, counts,
          // progress-tracker shape (added so snapshots match the live tracker):
          revenue: Math.round((pl.revenue || 0) / 100),
          profit: Math.round((pl.netProfit || 0) / 100),
        },
```

> Use the actual local variable names already present in that scope (`pl`, `ltv`, etc.); only ADD the two `revenue`/`profit` lines. If the variable names differ, map from what's in scope.

- [ ] **Step 2: Syntax-check the worker**

Run: `cd backend && node --check src/workers/index.js`
Expected: no output.

- [ ] **Step 3: Document the endpoints**

In `docs/API.md`, under the Business Health section, add:

```markdown
### GET /api/health/metrics
Returns the unified business-health metric array. Each item:
`{ key, label, cat, unit, better, sourceType, source, asof, needsInput, baseline, current, target, progressPct, deltaFromBaselinePct }`.
`current` is live-computed for `sourceType: auto` (revenue/profit/margin/cash from analytics actuals; conversion/no-show from rollups) and read from the manual store for `sourceType: manual`. Reception receives `{ metrics: [] }`.

### PATCH /api/health/metrics/:key
Owner-only. Body `{ value: number }`. Sets a manual metric value (`business_health.manual[key] = { value, asof }`). 400 if the key is unknown or auto-sourced; 403 for non-owners. Audited.
```

- [ ] **Step 4: Full backend suite + frontend build**

Run: `cd backend && npm test && npm run lint`
Expected: all green.

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual smoke test (browse)**

Start backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`), log in as an owner, then:
- `/health-setup` — complete the wizard (sets baseline + marks complete).
- `/progress` — hero shows real "now" profit; rows show a source tag; no blank/NaN.
- `/kpiscorecard` — auto cards show live values + source chip; a manual card (e.g. NPS) shows "Enter value", accepts a number, persists on reload.

- [ ] **Step 6: Commit**

```bash
git add backend/src/workers/index.js docs/API.md
git commit -m "feat(health): align snapshot shape to tracker; document metrics endpoints"
```

---

## Self-review notes

- **Spec coverage:** catalog (T2), resolver + progress fix (T4), JSONB migration (T1), endpoints owner-only/audited (T5), frontend both screens (T6-T8), multi-tenancy + RBAC tests (T4/T5), worker rider + docs (T9). All spec sections mapped.
- **Type consistency:** `HealthMetric` shape in `api.ts` matches the resolver's returned object keys (`key,label,cat,unit,better,sourceType,source,asof,needsInput,baseline,current,target,progressPct,deltaFromBaselinePct`). `updateMetric({key,value})` mutation arg matches the hook.
- **Honest scope:** only 6 metrics are auto (the ones backed by existing real rollups); the rest are manual fallback. Adding more auto resolvers later is a one-line catalog flip + an `auto[...]` mapping — noted, not silently capped.
- **Coordination:** migration `000030` may collide with the `/staff` session → fall back to `000031` (Task 1 Step 1). Tiny `app.js` merge possible (different routers).
