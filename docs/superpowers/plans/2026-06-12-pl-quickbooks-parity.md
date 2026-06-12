# P&L QuickBooks-parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `/profit` into a QuickBooks-style P&L matrix (line-item rows × time-period columns) with the QB filter set — report period + custom range, Accrual|Cash method, Columns-by Total/Month/Quarter/Year, and Compare (% of income, previous period, previous year) — plus practice and QBO-company scope.

**Architecture:** Backend stores both accounting bases in `monthly_financials` (new `accounting_method` column; QB sync pulls cash + accrual) and the finance-series endpoint gains `accounting_method` + `integration_account_id` params, returning a monthly bucket series for the chosen scope. The frontend fetches a wide (≤24mo) monthly window and does all the pivot/rollup/compare math in pure helpers (`pl-matrix.ts`), rendering the matrix in `ProfitScreen`.

**Tech Stack:** Express (native ESM) + Supabase/Postgres, vitest (backend). Next.js 14 App Router + React Query + recharts (frontend, typecheck-gated, no test runner).

**Money rule:** integer pence end-to-end on the backend; frontend converts to whole pounds at the api boundary (existing `p()` helper). Never floats for money.

**Spec:** `docs/superpowers/specs/2026-06-12-pl-quickbooks-parity-design.md`

---

## File Structure

Backend (modify unless noted):
- `supabase/migrations/20260101000089_monthly_financials_accounting_method.sql` — **create**: add `accounting_method` + rebuild unique index.
- `backend/src/lib/integrations/quickbooks-sync.js` — P&L pull runs cash + accrual; rows stamped + scoped by method.
- `backend/src/repositories/monthlyFinancial.repository.js` — `allForOrg` selects `accounting_method` + `integration_account_id`; accepts a filter object.
- `backend/src/services/monthlyFinancial.service.js` — `bucketsByPeriod` filters by accounting method; comment update.
- `backend/src/services/analytics.service.js` — `_actualsBundle` + `financeSeries` thread `accountingMethod` + `integrationAccountId`.
- `backend/src/models/analytics.model.js` — `seriesQuerySchema` gains `accounting_method` + `integration_account_id`; `months` max raised to 24.
- `backend/src/controllers/analytics.controller.js` — pass new params through.
- `backend/test/quickbooks-sync.test.js` — **create** (cash/accrual mapping).
- `backend/test/finance-series-accounting-method.test.js` — **create** (filtering).

Frontend (modify unless noted):
- `frontend/features/finance/pl-matrix.ts` — **create**: pure rollup/compare helpers + types.
- `frontend/features/finance/api.ts` — `getFinanceSeries` new params; `getQuickbooksAccounts`.
- `frontend/features/finance/hooks.ts` — `useFinanceSeries` new params; `useQuickbooksAccounts`.
- `frontend/features/finance/components/QbFilterBar.tsx` — **create**: the QB filter bar.
- `frontend/features/finance/components/ProfitScreen.tsx` — matrix render + PDF export.

---

## Phase A — Backend: storage + sync (cash & accrual)

### Task 1: Migration — `accounting_method` column + index

**Files:**
- Create: `supabase/migrations/20260101000089_monthly_financials_accounting_method.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 000089: dual accounting basis on monthly_financials.
-- QuickBooks' ProfitAndLoss report can be run on a Cash or Accrual basis; we now
-- store BOTH so the P&L page can toggle. Existing rows (Xero/manual/old QB) are
-- accrual. Cash rows are written only by the QB sync (accounting_method=Cash pull).
-- The unique index folds accounting_method into the conflict key so a period's
-- cash and accrual lines coexist instead of overwriting each other.

ALTER TABLE monthly_financials
  ADD COLUMN IF NOT EXISTS accounting_method TEXT NOT NULL DEFAULT 'accrual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'monthly_financials_accounting_method_chk'
  ) THEN
    ALTER TABLE monthly_financials
      ADD CONSTRAINT monthly_financials_accounting_method_chk
      CHECK (accounting_method IN ('accrual', 'cash'));
  END IF;
END $$;

-- Rebuild the conflict key to include accounting_method (was: org, period,
-- account_code, COALESCE(integration_account_id), COALESCE(practice_id), source).
DROP INDEX IF EXISTS uq_monthly_financials;
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financials
  ON monthly_financials (
    organisation_id,
    period,
    account_code,
    COALESCE(integration_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source,
    accounting_method
  );

CREATE INDEX IF NOT EXISTS idx_monthly_financials_method
  ON monthly_financials (organisation_id, accounting_method);

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify it parses / is idempotent (local DB optional)**

If a local Supabase stack is running:
Run: `supabase db reset` (from repo root)
Expected: applies through `000089` with no error; re-running is clean (all guards are `IF NOT EXISTS` / `DROP ... IF EXISTS`).
If no local stack: visually confirm every statement is guarded and the column default backfills existing rows to `accrual`.

- [ ] **Step 3: Mirror into the unmanaged schema copy**

Per CLAUDE.md, keep `db/01_schema.sql` in sync when changing schema. Add the `accounting_method` column to the `monthly_financials` definition there and update the `uq_monthly_financials` index comment to mention `accounting_method`. (Search `db/01_schema.sql` for `monthly_financials`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000089_monthly_financials_accounting_method.sql db/01_schema.sql
git commit -m "feat(profit): 000089 monthly_financials.accounting_method (cash+accrual)"
```

---

### Task 2: QuickBooks sync — pull cash + accrual

**Files:**
- Modify: `backend/src/lib/integrations/quickbooks-sync.js` (`pullProfitAndLoss`, its caller in `syncAccount`)
- Test: `backend/test/quickbooks-sync.test.js` (create)

Context: `pullProfitAndLoss(orgId, accountId, realmId, accessToken, accountMap, months)` currently loops months, calls `qboReport(... 'ProfitAndLoss', { start_date, end_date })`, maps rows, then delete-then-insert scoped by `(org, period, source, integration_account_id)`. We make it run once per basis and stamp + scope by `accounting_method`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/quickbooks-sync.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { __test } from '../src/lib/integrations/quickbooks-sync.js';

describe('quickbooks-sync accounting basis', () => {
  it('parseReportRows + mapBucket produce bucketed lines', () => {
    const report = {
      Rows: { Row: [
        { Header: { ColData: [{ value: 'Income' }] },
          Rows: { Row: [ { ColData: [{ value: 'Sales' }, { value: '1000.00' }] } ] } },
        { Header: { ColData: [{ value: 'Expenses' }] },
          Rows: { Row: [ { ColData: [{ value: 'Wages' }, { value: '400.00' }] } ] } },
      ] },
    };
    const rows = __test.parseReportRows(report);
    expect(rows).toHaveLength(2);
    const map = new Map();
    expect(__test.mapBucket('Sales', 'Income', map)).toBe('revenue');
    expect(__test.mapBucket('Wages', 'Expenses', map)).toBe('staff');
    expect(__test.toPence('1000.00')).toBe(100000);
  });

  it('exposes the two accounting methods it pulls', () => {
    expect(__test.ACCOUNTING_METHODS).toEqual(['accrual', 'cash']);
  });
});
```

- [ ] **Step 2: Run it — confirm the second case fails**

Run: `cd backend && npx vitest run test/quickbooks-sync.test.js`
Expected: first test PASS, second FAIL (`__test.ACCOUNTING_METHODS` is undefined).

- [ ] **Step 3: Implement cash+accrual pull**

In `backend/src/lib/integrations/quickbooks-sync.js`:

Add near the top constants (after `const BACKFILL_MONTHS = 12;`):

```js
// QuickBooks reports each P&L on a Cash or Accrual basis; we store both.
// 'accrual' is QB's default (omit the param); 'cash' adds accounting_method=Cash.
const ACCOUNTING_METHODS = ['accrual', 'cash'];
const QBO_METHOD_PARAM = { accrual: 'Accrual', cash: 'Cash' };
```

Replace `pullProfitAndLoss` with a per-basis version:

```js
// 1. P&L -> monthly_financials, per period AND per accounting basis. Delete-then-
// insert THIS company's rows scoped by integration_account_id + accounting_method,
// so cash and accrual never clobber each other and never touch Xero/another QB co.
async function pullProfitAndLoss(orgId, accountId, realmId, accessToken, accountMap, months) {
    let totalLines = 0;
    for (const { period, from, to } of lastNMonths(months)) {
        for (const method of ACCOUNTING_METHODS) {
            const report = await qboReport(realmId, accessToken, 'ProfitAndLoss', {
                start_date: from,
                end_date: to,
                accounting_method: QBO_METHOD_PARAM[method],
            });
            const rows = parseReportRows(report).map((r) => ({
                organisation_id: orgId,
                practice_id: null,
                integration_account_id: accountId,
                period,
                account_code: String(r.account),
                dental_bucket: mapBucket(r.account, r.section, accountMap),
                amount_pence: toPence(r.amount),
                source: 'quickbooks',
                accounting_method: method,
            }));
            const { error: delErr } = await supabase_1.serviceClient
                .from('monthly_financials')
                .delete()
                .eq('organisation_id', orgId)
                .eq('period', period)
                .eq('source', 'quickbooks')
                .eq('integration_account_id', accountId)
                .eq('accounting_method', method);
            if (delErr) throw new Error(`monthly_financials clear: ${delErr.message}`);
            if (rows.length > 0) {
                const { error } = await supabase_1.serviceClient.from('monthly_financials').insert(rows);
                if (error) throw new Error(`monthly_financials insert: ${error.message}`);
            }
            totalLines += rows.length;
        }
    }
    return totalLines;
}
```

Export the new constant in the `__test` block at the bottom — change it to:

```js
export const __test = {
    toPence, heuristicBucket, mapBucket, parseReportRows, parseBalanceSheetBanks,
    lastNMonths, mapInvoiceRow, mapPaymentRow, dedupeReceipts, ACCOUNTING_METHODS,
};
```

- [ ] **Step 4: Run the test — confirm PASS**

Run: `cd backend && npx vitest run test/quickbooks-sync.test.js`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/quickbooks-sync.js backend/test/quickbooks-sync.test.js
git commit -m "feat(profit): QuickBooks sync pulls cash + accrual P&L"
```

---

## Phase B — Backend: read path (filters)

### Task 3: Repository — select + filter accounting method & company

**Files:**
- Modify: `backend/src/repositories/monthlyFinancial.repository.js` (`allForOrg`)

Context: `allForOrg(orgId)` currently selects `period, dental_bucket, amount_pence, source, practice_id` for the analytics read path. We add `accounting_method` + `integration_account_id` to the projection and an optional filter for the company.

- [ ] **Step 1: Update `allForOrg` to accept filters and select the new columns**

Replace the `allForOrg` method:

```js
    // All rows for an org (both 'manual' and 'xero'/'quickbooks'), for the
    // analytics read path. Source + accounting_method are selected so the reader
    // can apply Xero-overrides-manual precedence and split cash vs accrual. An
    // optional integrationAccountId narrows to one QBO company.
    async allForOrg(orgId, { integrationAccountId = null } = {}) {
        const drop = new Set(await revokedSources(orgId, FINANCE_SOURCES));
        let q = supabase_1.serviceClient
            .from('monthly_financials')
            .select('period, dental_bucket, amount_pence, source, practice_id, accounting_method, integration_account_id')
            .eq('organisation_id', orgId);
        if (integrationAccountId) q = q.eq('integration_account_id', integrationAccountId);
        const { data, error } = await q.limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return (Array.isArray(data) ? data : []).filter((r) => !drop.has(r.source));
    },
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/repositories/monthlyFinancial.repository.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add backend/src/repositories/monthlyFinancial.repository.js
git commit -m "feat(profit): monthly_financials read path selects accounting_method + company"
```

---

### Task 4: Service — bucket by accounting method; thread filters

**Files:**
- Modify: `backend/src/services/monthlyFinancial.service.js` (`bucketsByPeriod`)
- Modify: `backend/src/services/analytics.service.js` (`_actualsBundle`, `financeSeries`)
- Test: `backend/test/finance-series-accounting-method.test.js` (create)

Context: `bucketsByPeriod(rows)` resolves Xero/QB-over-manual precedence per period+bucket but ignores accounting method. We make it filter rows to a chosen method first. Accrual basis includes manual + xero + accrual-QB rows (manual/xero are inherently accrual). Cash basis includes ONLY `accounting_method === 'cash'` rows (QB cash pull) — manual/xero do not appear under cash.

- [ ] **Step 1: Write the failing test**

Create `backend/test/finance-series-accounting-method.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { bucketsByPeriod } from '../src/services/monthlyFinancial.service.js';

const rows = [
  // accrual QB revenue + manual staff; cash QB revenue only
  { period: '2026-01', dental_bucket: 'revenue', amount_pence: 100000, source: 'quickbooks', accounting_method: 'accrual' },
  { period: '2026-01', dental_bucket: 'staff',   amount_pence: 40000,  source: 'manual',     accounting_method: 'accrual' },
  { period: '2026-01', dental_bucket: 'revenue', amount_pence: 90000,  source: 'quickbooks', accounting_method: 'cash' },
];

describe('bucketsByPeriod accounting method', () => {
  it('accrual basis includes manual + accrual-QB rows', () => {
    const m = bucketsByPeriod(rows, { accountingMethod: 'accrual' });
    expect(m.get('2026-01').revenue).toBe(100000);
    expect(m.get('2026-01').staff).toBe(40000);
  });

  it('cash basis includes only cash rows', () => {
    const m = bucketsByPeriod(rows, { accountingMethod: 'cash' });
    expect(m.get('2026-01').revenue).toBe(90000);
    expect(m.get('2026-01').staff).toBeUndefined();
  });

  it('defaults to accrual when no method given (back-compat)', () => {
    const m = bucketsByPeriod(rows);
    expect(m.get('2026-01').revenue).toBe(100000);
  });
});
```

- [ ] **Step 2: Run it — confirm failure**

Run: `cd backend && npx vitest run test/finance-series-accounting-method.test.js`
Expected: FAIL (accrual test gets 100000 today because method is ignored, but the cash test FAILS — it returns 100000, not 90000).

- [ ] **Step 3: Implement method filtering in `bucketsByPeriod`**

In `backend/src/services/monthlyFinancial.service.js`, update the signature + add an early filter. Replace the function header and the loop guard:

```js
export function bucketsByPeriod(rows, { accountingMethod = 'accrual' } = {}) {
    const acc = new Map(); // period -> bucket -> { synced, manual, hasSynced }
    for (const r of Array.isArray(rows) ? rows : []) {
        if (!r.period || !r.dental_bucket) continue;
        // Accounting basis: rows carry accounting_method ('accrual'|'cash'); rows
        // predating the column (or manual/xero) are treated as accrual. Cash basis
        // surfaces ONLY explicit cash rows (the QB cash pull).
        const rowMethod = r.accounting_method || 'accrual';
        if (rowMethod !== accountingMethod) continue;
        if (!acc.has(r.period)) acc.set(r.period, {});
        const byBucket = acc.get(r.period);
        const cell = byBucket[r.dental_bucket] ||
            (byBucket[r.dental_bucket] = { synced: 0, manual: 0, hasSynced: false });
        const amt = r.amount_pence || 0;
        if (SYNCED_SOURCES.has(r.source)) { cell.synced += amt; cell.hasSynced = true; }
        else { cell.manual += amt; }
    }
    const out = new Map();
    for (const [period, byBucket] of acc) {
        const resolved = {};
        for (const [bucket, cell] of Object.entries(byBucket)) {
            resolved[bucket] = cell.hasSynced ? cell.synced : cell.manual;
        }
        out.set(period, resolved);
    }
    return out;
}
```

- [ ] **Step 4: Thread the options through `_actualsBundle`**

In `backend/src/services/analytics.service.js`, replace `_actualsBundle`:

```js
    async _actualsBundle(orgId, practiceId = null, { accountingMethod = 'accrual', integrationAccountId = null } = {}) {
        const all = await monthlyFinancial_repository_1.monthlyFinancialRepository.allForOrg(orgId, { integrationAccountId });
        const rows = practiceId
            ? (Array.isArray(all) ? all : []).filter((r) => r.practice_id === practiceId)
            : all;
        const byPeriod = bucketsByPeriod(rows, { accountingMethod });
        const periods = [...byPeriod.keys()].sort();
        const recent = periods.slice(-12);
        const annual = {};
        for (const p of recent) {
            for (const [k, v] of Object.entries(byPeriod.get(p))) {
                annual[k] = (annual[k] || 0) + v;
            }
        }
        return { byPeriod, annual, hasAny: periods.length > 0, periodsCovered: recent.length };
    },
```

Note: the other `_actualsBundle` callers (lines ~530, ~565, ~1512, ~1754, ~1950, ~2300) pass no options object, so they default to accrual — unchanged behaviour. Do NOT modify those call sites.

- [ ] **Step 5: Thread options into `financeSeries`**

In `backend/src/services/analytics.service.js`, update the `financeSeries` signature + the `_actualsBundle` call inside it:

```js
    async financeSeries(orgId, { months = 12, now = () => new Date(), practiceId = null, from = null, to = null, accountingMethod = 'accrual', integrationAccountId = null } = {}) {
        const ref = now();
        const { keys, sinceISO, untilISO } = this._monthWindow(ref, months, from, to);
        const [actuals, dayRows, billedRows] = await Promise.all([
            this._actualsBundle(orgId, practiceId, { accountingMethod, integrationAccountId }),
            analytics_repository_1.analyticsRepository.settledReceiptsByDay(orgId, sinceISO, practiceId, untilISO),
            analytics_repository_1.analyticsRepository.billedRevenueByMonth(orgId, sinceISO, null, practiceId).catch(() => []),
        ]);
```

(Leave the rest of `financeSeries` unchanged.)

- [ ] **Step 6: Run the test — confirm PASS**

Run: `cd backend && npx vitest run test/finance-series-accounting-method.test.js`
Expected: all three PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/monthlyFinancial.service.js backend/src/services/analytics.service.js backend/test/finance-series-accounting-method.test.js
git commit -m "feat(profit): finance-series respects accounting basis + QBO company"
```

---

### Task 5: Model + controller — accept the new query params

**Files:**
- Modify: `backend/src/models/analytics.model.js` (`seriesQuerySchema`)
- Modify: `backend/src/controllers/analytics.controller.js` (`financeSeries`)

- [ ] **Step 1: Extend `seriesQuerySchema`**

In `backend/src/models/analytics.model.js`, replace `seriesQuerySchema`:

```js
export const seriesQuerySchema = zod_1.z.object({
    months: zod_1.z.coerce.number().int().min(1).max(24).default(12),
    practice_id: zod_1.z.string().uuid().optional(),
    from: dateStr,
    to: dateStr,
    accounting_method: zod_1.z.enum(['accrual', 'cash']).default('accrual'),
    integration_account_id: zod_1.z.string().uuid().optional(),
});
```

Note: `months` max is raised 36→24. Other consumers of `seriesQuerySchema` (`dashboardSummary`, `revenueSeries`) only ever pass `months ≤ 12`, so the lower cap is safe.

- [ ] **Step 2: Pass params through the controller**

In `backend/src/controllers/analytics.controller.js`, replace `financeSeries`:

```js
    async financeSeries(req, res) {
        const q = analytics_model_1.seriesQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.financeSeries(req.user.organisation_id, {
            months: q.months,
            practiceId: q.practice_id,
            from: q.from,
            to: q.to,
            accountingMethod: q.accounting_method,
            integrationAccountId: q.integration_account_id,
        }));
    },
```

- [ ] **Step 3: Syntax check + full backend suite**

Run: `cd backend && node --check src/models/analytics.model.js && node --check src/controllers/analytics.controller.js && npx vitest run`
Expected: syntax OK; suite shows the 4 pre-existing GHL failures ONLY (no new failures), plus the 2 new test files green. Pre-existing failures are `ghl-account.service`, `webhook-ghl-account`, `gohighlevel-practice-stamp` — do not touch them.

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/analytics.model.js backend/src/controllers/analytics.controller.js
git commit -m "feat(profit): finance-series accepts accounting_method + integration_account_id"
```

---

## Phase C — Frontend: compute helpers

### Task 6: `pl-matrix.ts` — pure pivot/rollup/compare helpers

**Files:**
- Create: `frontend/features/finance/pl-matrix.ts`

Context: input is the existing `FinanceMonth[]` (pounds, ascending by `month` 'YYYY-MM'). We produce a column-oriented matrix. No test runner on the frontend — these are pure functions validated by `npm run typecheck` and the browse-QA step in Task 9. Keep them total and side-effect free.

- [ ] **Step 1: Write the helpers**

```ts
// Pure P&L matrix helpers for /profit. Input: FinanceMonth[] in POUNDS, ascending
// by 'YYYY-MM'. Output: line-item rows × time-period columns, QuickBooks-style.
// No I/O, no Date.now — callers pass the report window. Money is whole pounds.
import type { FinanceMonth } from './api';

export type GroupBy = 'total' | 'month' | 'quarter' | 'year';

// The fixed P&L line items (order = render order). 'profit' and 'margin' are
// derived rows rendered after the cost lines.
export const PL_LINES = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'associate_pay', label: 'Associate pay' },
  { key: 'staff_costs', label: 'Staff' },
  { key: 'lab_materials', label: 'Lab/materials' },
  { key: 'opex', label: 'OpEx' },
] as const;

export type LineKey = (typeof PL_LINES)[number]['key'];

export interface MatrixColumn {
  key: string;          // stable id, e.g. '2026-01', '2026-Q1', '2026', 'total'
  label: string;        // display, e.g. 'Jan 2026', 'Q1 2026', '2026', 'Total'
  values: Record<LineKey, number>;
  profit: number;
  marginPct: number | null; // null when revenue is 0
  costsAvailable: boolean;  // any month in the column had real costs
}

const ZERO = (): Record<LineKey, number> => ({
  revenue: 0, associate_pay: 0, staff_costs: 0, lab_materials: 0, opex: 0,
});

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Which column a month falls into, for a given grouping.
function columnIdFor(month: string, groupBy: GroupBy): { key: string; label: string } {
  const [y, m] = month.split('-').map(Number);
  if (groupBy === 'total') return { key: 'total', label: 'Total' };
  if (groupBy === 'year') return { key: `${y}`, label: `${y}` };
  if (groupBy === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1;
    return { key: `${y}-Q${q}`, label: `Q${q} ${y}` };
  }
  return { key: month, label: `${MONTH_NAMES[m - 1]} ${y}` };
}

function emptyColumn(key: string, label: string): MatrixColumn {
  return { key, label, values: ZERO(), profit: 0, marginPct: null, costsAvailable: false };
}

function addMonth(col: MatrixColumn, mo: FinanceMonth): void {
  col.values.revenue += mo.revenue;
  col.values.associate_pay += mo.associate_pay;
  col.values.staff_costs += mo.staff_costs;
  col.values.lab_materials += mo.lab_materials;
  col.values.opex += mo.opex;
  col.profit += mo.profit;
  if (mo.costsAvailable) col.costsAvailable = true;
}

function finaliseMargin(col: MatrixColumn): MatrixColumn {
  col.marginPct = col.values.revenue > 0
    ? (col.profit / col.values.revenue) * 100
    : null;
  return col;
}

// Pivot months -> ordered columns. Months must already be sliced to the report
// window by the caller. Column order follows first appearance (ascending months).
export function buildColumns(months: FinanceMonth[], groupBy: GroupBy): MatrixColumn[] {
  const order: string[] = [];
  const byId = new Map<string, MatrixColumn>();
  for (const mo of months) {
    const { key, label } = columnIdFor(mo.month, groupBy);
    let col = byId.get(key);
    if (!col) { col = emptyColumn(key, label); byId.set(key, col); order.push(key); }
    addMonth(col, mo);
  }
  return order.map((k) => finaliseMargin(byId.get(k)!));
}

// Sum a window of months into a single column with the given label (used for
// previous-period / previous-year comparison totals).
export function totalColumn(months: FinanceMonth[], key: string, label: string): MatrixColumn {
  const col = emptyColumn(key, label);
  for (const mo of months) addMonth(col, mo);
  return finaliseMargin(col);
}

// Each line as % of the column's revenue. Returns null entries when revenue is 0.
export function pctOfIncome(col: MatrixColumn): Record<LineKey, number | null> {
  const rev = col.values.revenue;
  const out = {} as Record<LineKey, number | null>;
  for (const { key } of PL_LINES) {
    out[key] = rev > 0 ? (col.values[key] / rev) * 100 : null;
  }
  return out;
}

// Slice an ascending month array to [fromYM, toYM] inclusive (YYYY-MM compare).
export function sliceMonths(months: FinanceMonth[], fromYM: string | null, toYM: string | null): FinanceMonth[] {
  return months.filter((m) => (!fromYM || m.month >= fromYM) && (!toYM || m.month <= toYM));
}

// Shift a 'YYYY-MM' key by N months (N may be negative).
export function shiftYM(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (If `FinanceMonth` import path errors, confirm it is exported from `./api` — it is, line 13.)

- [ ] **Step 3: Commit**

```bash
git add frontend/features/finance/pl-matrix.ts
git commit -m "feat(profit): pure P&L matrix pivot/compare helpers"
```

---

### Task 7: api.ts + hooks.ts — new params + QBO company list

**Files:**
- Modify: `frontend/features/finance/api.ts` (`getFinanceSeries`; add `getQuickbooksAccounts`)
- Modify: `frontend/features/finance/hooks.ts` (`useFinanceSeries`; add `useQuickbooksAccounts`)

- [ ] **Step 1: Extend `getFinanceSeries` + add the QBO accounts fetcher**

In `frontend/features/finance/api.ts`, replace `getFinanceSeries` and append the accounts fetcher. First add an options type and rewrite the function:

```ts
export interface FinanceSeriesOpts {
  months?: number;                       // default 12 (max 24, backend-capped)
  accountingMethod?: 'accrual' | 'cash'; // default accrual
  integrationAccountId?: string | null;  // QBO company filter
}

export async function getFinanceSeries(
  practiceId?: string | null,
  range?: DateRange | null,
  opts?: FinanceSeriesOpts,
): Promise<{
  error?: string;
  basis?: 'actuals' | 'mixed' | 'revenue-only';
  costsAvailable: boolean;
  months: FinanceMonth[];
}> {
  const months = opts?.months ?? 12;
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const am = `&accounting_method=${opts?.accountingMethod ?? 'accrual'}`;
  const ia = opts?.integrationAccountId ? `&integration_account_id=${opts.integrationAccountId}` : '';
  const r = await api(`/api/analytics/finance-series?months=${months}${pp}${rangeQS(range)}${am}${ia}`);
  if (r?.error) return { error: r.error, costsAvailable: false, months: [] };
  return {
    basis: r.basis,
    costsAvailable: !!r.costsAvailable,
    months: (r.months ?? []).map((m: any) => ({
      month: m.month,
      revenue: p(m.revenue),
      associate_pay: p(m.associatePay),
      staff_costs: p(m.staffCosts),
      lab_materials: p(m.labMaterials),
      opex: p(m.opex),
      profit: p(m.profit),
      costsAvailable: !!m.costsAvailable,
    })),
  };
}

export interface QuickbooksAccount {
  id: string;
  company_name: string | null;
  label: string | null;
  status: string;
}

export async function getQuickbooksAccounts(): Promise<QuickbooksAccount[]> {
  const r = await api('/api/integrations/quickbooks/accounts');
  if (r?.error) return [];
  return (r.accounts ?? []).map((a: any) => ({
    id: a.id,
    company_name: a.company_name ?? null,
    label: a.label ?? null,
    status: a.status,
  }));
}
```

- [ ] **Step 2: Update `useFinanceSeries` + add `useQuickbooksAccounts`**

In `frontend/features/finance/hooks.ts`, replace `useFinanceSeries` and add the accounts hook. Update the import line to add the new symbols:

```ts
import {
  getFinanceSeries,
  getCashflow,
  getCashflowOutlook,
  getFinancial,
  getProfitBenchmark,
  getValuationBase,
  getPaymentSourceBreakdown,
  getQuickbooksAccounts,
  recordManualPayment,
  recordMonthlyFinancial,
  listMonthlyFinancials,
  deleteMonthlyFinancial,
  type ManualPaymentInput,
  type MonthlyFinancialInput,
  type FinanceSeriesOpts,
  type DateRange,
} from './api';
```

Replace `useFinanceSeries`:

```ts
export function useFinanceSeries(
  practiceId: string | null = null,
  range?: DateRange | null,
  opts?: FinanceSeriesOpts,
) {
  return useQuery({
    queryKey: [
      'finance-series', practiceId, range?.from ?? null, range?.to ?? null,
      opts?.months ?? 12, opts?.accountingMethod ?? 'accrual', opts?.integrationAccountId ?? null,
    ],
    queryFn: () => getFinanceSeries(practiceId, range, opts),
  });
}
```

Add after it:

```ts
export function useQuickbooksAccounts() {
  return useQuery({
    queryKey: ['quickbooks-accounts'],
    queryFn: getQuickbooksAccounts,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (Existing `useFinanceSeries(practiceId, range)` and `useFinanceSeries(practiceId, null)` calls in `ProfitScreen` still typecheck — `opts` is optional.)

- [ ] **Step 4: Commit**

```bash
git add frontend/features/finance/api.ts frontend/features/finance/hooks.ts
git commit -m "feat(profit): finance-series client params + QBO accounts hook"
```

---

## Phase D — Frontend: filter bar + matrix render

### Task 8: `QbFilterBar` component

**Files:**
- Create: `frontend/features/finance/components/QbFilterBar.tsx`

Context: this owns the QB filter UI and emits a single `QbFilters` object. It reuses the existing `DateRange` shape for the report period (so the existing `thisMonthRange`/`thisYearRange` helpers can seed presets). It does NOT fetch — the parent (`ProfitScreen`) maps filters to a `useFinanceSeries` call.

- [ ] **Step 1: Write the component**

```tsx
'use client';
// QuickBooks-style filter bar for the P&L page. Emits one QbFilters object:
// report period (DateRange; null=last 12 months), accounting method, columns-by,
// and the compare toggles. Pure controlled component — no data fetching.
import { useState } from 'react';
import type { DateRange } from './DateRangeFilter';
import { thisMonthRange, thisYearRange } from './DateRangeFilter';
import type { GroupBy } from '../pl-matrix';

export interface QbCompare {
  pctOfIncome: boolean;
  prevPeriod: boolean;
  prevYear: boolean;
}
export interface QbFilters {
  range: DateRange;            // {from:null,to:null} = last 12 months
  method: 'accrual' | 'cash';
  groupBy: GroupBy;
  compare: QbCompare;
}

export const DEFAULT_QB_FILTERS: QbFilters = {
  range: { from: null, to: null },
  method: 'accrual',
  groupBy: 'month',
  compare: { pctOfIncome: false, prevPeriod: false, prevYear: false },
};

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function lastNMonthsRange(n: number, ref = new Date()): DateRange {
  const to = fmt(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  const from = fmt(new Date(ref.getFullYear(), ref.getMonth() - (n - 1), 1));
  return { from, to };
}
function monthToRange(ym: string): DateRange {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: fmt(new Date(y, m, 0)) };
}

type PeriodPreset = 'recent' | 'this-month' | 'this-year' | 'last-12' | 'pick-month' | 'custom';

interface Props {
  value: QbFilters;
  onChange: (f: QbFilters) => void;
}

export default function QbFilterBar({ value, onChange }: Props) {
  const [preset, setPreset] = useState<PeriodPreset>('recent');

  const seg = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px', fontSize: 12, fontWeight: 600, borderRadius: 7,
    border: '1px solid var(--border)', background: active ? 'var(--brand)' : 'white',
    color: active ? 'white' : 'var(--ink)', cursor: 'pointer', whiteSpace: 'nowrap',
  });
  const field: React.CSSProperties = {
    padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6,
  };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginRight: 2 };
  const set = (patch: Partial<QbFilters>) => onChange({ ...value, ...patch });

  function pickPreset(pp: PeriodPreset) {
    setPreset(pp);
    if (pp === 'recent') set({ range: { from: null, to: null } });
    else if (pp === 'this-month') set({ range: thisMonthRange() });
    else if (pp === 'this-year') set({ range: thisYearRange() });
    else if (pp === 'last-12') set({ range: lastNMonthsRange(12) });
    // pick-month / custom wait for input
  }

  const wrap: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };
  const row: React.CSSProperties = { ...wrap, marginBottom: 10 };

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Report period */}
      <div style={row}>
        <span style={label}>Period</span>
        <button style={seg(preset === 'recent')} onClick={() => pickPreset('recent')}>Last 12mo</button>
        <button style={seg(preset === 'this-month')} onClick={() => pickPreset('this-month')}>This month</button>
        <button style={seg(preset === 'this-year')} onClick={() => pickPreset('this-year')}>This year</button>
        <button style={seg(preset === 'pick-month')} onClick={() => pickPreset('pick-month')}>Pick month</button>
        <button style={seg(preset === 'custom')} onClick={() => pickPreset('custom')}>Custom</button>
        {preset === 'pick-month' && (
          <input type="month" style={field}
            onChange={(e) => e.target.value && set({ range: monthToRange(e.target.value) })} />
        )}
        {preset === 'custom' && (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="date" style={field} value={value.range.from ?? ''}
              onChange={(e) => set({ range: { from: e.target.value || null, to: value.range.to } })} />
            <span className="text-ink-muted">to</span>
            <input type="date" style={field} value={value.range.to ?? ''}
              onChange={(e) => set({ range: { from: value.range.from, to: e.target.value || null } })} />
          </span>
        )}
      </div>

      {/* Method + columns + compare */}
      <div style={wrap}>
        <span style={label}>Method</span>
        <button style={seg(value.method === 'accrual')} onClick={() => set({ method: 'accrual' })}>Accrual</button>
        <button style={seg(value.method === 'cash')} onClick={() => set({ method: 'cash' })}>Cash</button>

        <span style={{ ...label, marginLeft: 10 }}>Columns</span>
        {(['total', 'month', 'quarter', 'year'] as GroupBy[]).map((g) => (
          <button key={g} style={seg(value.groupBy === g)} onClick={() => set({ groupBy: g })}>
            {g === 'total' ? 'Total' : g.charAt(0).toUpperCase() + g.slice(1)}
          </button>
        ))}

        <span style={{ ...label, marginLeft: 10 }}>Compare</span>
        <button style={seg(value.compare.pctOfIncome)}
          onClick={() => set({ compare: { ...value.compare, pctOfIncome: !value.compare.pctOfIncome } })}>% of income</button>
        <button style={seg(value.compare.prevPeriod)}
          onClick={() => set({ compare: { ...value.compare, prevPeriod: !value.compare.prevPeriod } })}>Prev period</button>
        <button style={seg(value.compare.prevYear)}
          onClick={() => set({ compare: { ...value.compare, prevYear: !value.compare.prevYear } })}>Prev year</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/finance/components/QbFilterBar.tsx
git commit -m "feat(profit): QuickBooks-style P&L filter bar"
```

---

### Task 9: `ProfitScreen` — matrix render + company filter + PDF

**Files:**
- Modify: `frontend/features/finance/components/ProfitScreen.tsx`

Context: rewrite the body to render the matrix from `pl-matrix` columns driven by `QbFilterBar`. Keep: header, "Enter actuals" + `ManualPLModal`, `PracticeTabs`, `FinanceToolbar`, the empty/error states, and the revenue/profit chart. Replace: `DateRangeFilter` → `QbFilterBar`; the month-row table → the pivoted matrix (line rows × period columns + optional compare columns). Add a QBO company `<select>`.

The fetch window must cover comparison history. Compute it from the filters:
- Determine the in-scope window `[scopeFrom, scopeTo]` as YYYY-MM. If `range` is null → last 12 months ending current month.
- Fetch enough history: if `compare.prevYear` → start 12 months earlier; else if `compare.prevPeriod` → start one window-length earlier; else just the scope. Convert to a `months` count (when range is null) or a `from/to` range, capped at 24 months.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `frontend/features/finance/components/ProfitScreen.tsx`:

```tsx
'use client';
// Profit & Loss — QuickBooks-style matrix. Line items (rows) × time-period
// columns (Total/Month/Quarter/Year) driven by QbFilterBar, with optional
// %-of-income, previous-period and previous-year comparison. Real data from
// GET /api/analytics/finance-series (settled-cash revenue + monthly_financials
// costs, per accounting basis + QBO company). Money in pounds at this layer.
import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Skeleton } from '@/components/ui';
import { poundsCompact, monthShort } from '../mock';
import { useFinanceSeries, useQuickbooksAccounts } from '../hooks';
import FinanceToolbar from './FinanceToolbar';
import ManualPLModal from './ManualPLModal';
import PracticeTabs from '@/features/practices/PracticeTabs';
import QbFilterBar, { DEFAULT_QB_FILTERS, type QbFilters } from './QbFilterBar';
import {
  PL_LINES, buildColumns, totalColumn, pctOfIncome, sliceMonths, shiftYM,
  type MatrixColumn, type LineKey,
} from '../pl-matrix';
import type { FinanceMonth } from '../api';

const BASIS_LABEL: Record<string, string> = {
  actuals: 'real actuals (Xero / QuickBooks / manual)',
  mixed: 'real costs where entered, £0 elsewhere',
  'revenue-only': 'real revenue (settled payments) · costs/profit £0 until a cost source connects',
};
const BRAND = 'var(--brand)';
const ACCENT = 'var(--accent)';

const pad = (n: number) => String(n).padStart(2, '0');
function ym(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

// The in-scope month window [from,to] (YYYY-MM) for the chosen report period.
function scopeWindow(range: QbFilters['range'], ref = new Date()): { from: string; to: string } {
  if (range.from && range.to) return { from: range.from.slice(0, 7), to: range.to.slice(0, 7) };
  const to = ym(ref);
  const from = ym(new Date(ref.getFullYear(), ref.getMonth() - 11, 1));
  return { from, to };
}
// Count of months in [from,to] inclusive.
function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm) + 1;
}

function Kpi({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {delta && <div className="text-xs font-semibold mt-1" style={{ color: 'var(--success)' }}>{delta}</div>}
    </div>
  );
}

export default function ProfitScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<QbFilters>(DEFAULT_QB_FILTERS);
  const [plModalOpen, setPlModalOpen] = useState(false);
  const { data: qbAccounts } = useQuickbooksAccounts();

  // Fetch window: wide enough for the requested comparison columns, capped at 24mo.
  const scope = useMemo(() => scopeWindow(filters.range), [filters.range]);
  const spanMonths = monthSpan(scope.from, scope.to);
  const fetchMonths = useMemo(() => {
    let m = spanMonths;
    if (filters.compare.prevYear) m = spanMonths + 12;
    else if (filters.compare.prevPeriod) m = spanMonths * 2;
    return Math.min(24, Math.max(1, m));
  }, [spanMonths, filters.compare.prevYear, filters.compare.prevPeriod]);

  // Always fetch by month-count ending now; slice locally. (range.from in the past
  // beyond 24mo is out of scope — the matrix shows what the window covers.)
  const { data, isLoading, isError } = useFinanceSeries(practiceId, null, {
    months: fetchMonths,
    accountingMethod: filters.method,
    integrationAccountId: companyId,
  });

  const allMonths: FinanceMonth[] = data?.months ?? [];
  const basisLabel = BASIS_LABEL[data?.basis ?? 'revenue-only'] ?? BASIS_LABEL['revenue-only'];

  // In-scope months + the pivoted columns.
  const scopeMonths = useMemo(() => sliceMonths(allMonths, scope.from, scope.to), [allMonths, scope.from, scope.to]);
  const columns = useMemo(() => buildColumns(scopeMonths, filters.groupBy), [scopeMonths, filters.groupBy]);

  // Comparison total columns (appended after the period columns).
  const compareCols = useMemo(() => {
    const out: MatrixColumn[] = [];
    if (filters.compare.prevPeriod) {
      const pf = shiftYM(scope.from, -spanMonths);
      const pt = shiftYM(scope.to, -spanMonths);
      out.push(totalColumn(sliceMonths(allMonths, pf, pt), 'prev-period', 'Prev period'));
    }
    if (filters.compare.prevYear) {
      const pf = shiftYM(scope.from, -12);
      const pt = shiftYM(scope.to, -12);
      out.push(totalColumn(sliceMonths(allMonths, pf, pt), 'prev-year', 'Prev year'));
    }
    return out;
  }, [allMonths, scope.from, scope.to, spanMonths, filters.compare.prevPeriod, filters.compare.prevYear]);

  const renderCols = [...columns, ...compareCols];
  const costsAvailable = scopeMonths.some((m) => m.costsAvailable);
  const hasRevenue = scopeMonths.some((m) => m.revenue > 0);
  const grand = useMemo(() => totalColumn(scopeMonths, 'grand', 'Total'), [scopeMonths]);

  // KPI strip (always over the in-scope window).
  const revenueMonths = scopeMonths.filter((m) => m.revenue > 0).length;
  const avgMonthlyRevenue = revenueMonths > 0 ? Math.round(grand.values.revenue / revenueMonths) : 0;

  const chartData = scopeMonths.map((m) => ({ month: monthShort(m.month), Revenue: m.revenue, Profit: m.profit }));

  const fmtCell = (v: number, real: boolean) => (real ? poundsCompact(v) : '—');
  const pctCells = filters.compare.pctOfIncome ? renderCols.map((c) => pctOfIncome(c)) : null;

  function exportPdf() {
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    const head = `<tr><th>Line</th>${renderCols.map((c) => `<th class=r>${esc(c.label)}</th>`).join('')}</tr>`;
    const lineRow = (key: LineKey, label: string) => `<tr><td>${label}</td>${renderCols
      .map((c) => `<td class=r>${costsAvailable || key === 'revenue' ? poundsCompact(c.values[key]) : '—'}</td>`).join('')}</tr>`;
    const body = PL_LINES.map((l) => lineRow(l.key, l.label)).join('');
    const profitRow = `<tr class=tot><td>Net profit</td>${renderCols
      .map((c) => `<td class=r>${costsAvailable ? poundsCompact(c.profit) : '—'}</td>`).join('')}</tr>`;
    const marginRow = `<tr><td>Margin %</td>${renderCols
      .map((c) => `<td class=r>${c.marginPct == null ? '—' : c.marginPct.toFixed(1) + '%'}</td>`).join('')}</tr>`;
    const html = `<!doctype html><html><head><meta charset=utf-8><title>P&L</title><style>body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1F2937;margin:32px}h1{font-size:20px;margin:0}.sub{color:#6B7280;font-size:11px;margin:4px 0 18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px 10px;border-bottom:1px solid #E5E7EB;text-align:left}.r{text-align:right}.tot td{font-weight:700;border-top:2px solid #1F2937}@media print{body{margin:14mm}}</style></head><body><h1>Profit &amp; Loss</h1><div class=sub>${esc(filters.method)} basis · ${esc(basisLabel)} · ${esc(new Date().toLocaleString('en-GB'))}</div><table><thead>${head}</thead><tbody>${body}${profitRow}${marginRow}</tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus();
    w.onload = () => w.print();
    setTimeout(() => { try { w.print(); } catch { /* closed */ } }, 400);
  }

  const cellPad = '10px 14px';
  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-bold">Profit &amp; Loss</h1>
          <p className="text-sm text-ink-muted">{filters.method === 'cash' ? 'Cash' : 'Accrual'} basis · {basisLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setPlModalOpen(true)} className="font-semibold"
            style={{ padding: '9px 16px', fontSize: 13, border: 'none', borderRadius: 6, background: 'var(--brand)', color: 'white', cursor: 'pointer' }}>
            Enter actuals
          </button>
          <button type="button" onClick={exportPdf} disabled={renderCols.length === 0} className="font-semibold"
            style={{ padding: '9px 16px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'white', opacity: renderCols.length ? 1 : 0.5, cursor: renderCols.length ? 'pointer' : 'default' }}>
            Export to PDF
          </button>
        </div>
      </div>

      <ManualPLModal open={plModalOpen} onClose={() => setPlModalOpen(false)} practiceId={practiceId} />

      <PracticeTabs value={practiceId} onChange={setPracticeId} />

      {(qbAccounts?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>QuickBooks company</span>
          <select value={companyId ?? ''} onChange={(e) => setCompanyId(e.target.value || null)}
            style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
            <option value="">All companies</option>
            {qbAccounts!.map((a) => (
              <option key={a.id} value={a.id}>{a.company_name || a.label || a.id.slice(0, 8)}</option>
            ))}
          </select>
        </div>
      )}

      <QbFilterBar value={filters} onChange={setFilters} />
      <FinanceToolbar />

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load P&amp;L</div>
          <div className="text-sm text-ink-muted">The analytics service did not respond. Refresh to retry.</div>
        </div>
      )}
      {!hasRevenue && !isError && !isLoading && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">No settled payments in this period</div>
          <div className="text-sm text-ink-muted">Revenue here is real settled payments{practiceId ? ' for this practice' : ''}. Once payments land, the P&amp;L fills in automatically.</div>
        </div>
      )}
      {!costsAvailable && !isError && !isLoading && hasRevenue && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">Costs &amp; profit shown as £0</div>
          <div className="text-sm text-ink-muted">
            {filters.method === 'cash'
              ? 'No cash-basis cost data yet. Cash figures appear after a QuickBooks re-sync; Xero/manual actuals are accrual-only.'
              : 'Revenue is real (settled payments) but we have no cost data for this period. Connect Xero/QuickBooks or enter P&L actuals.'}
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Revenue (period)" value={isLoading ? '…' : poundsCompact(grand.values.revenue)} delta="Real settled payments" />
        <Kpi label="Net profit (period)" value={isLoading ? '…' : (costsAvailable ? poundsCompact(grand.profit) : '£0')} delta={costsAvailable && grand.marginPct != null ? `${grand.marginPct.toFixed(1)}% margin` : 'no cost data (£0)'} />
        <Kpi label="Avg monthly revenue" value={isLoading ? '…' : poundsCompact(avgMonthlyRevenue)} delta={revenueMonths > 0 ? `over ${revenueMonths} mo with revenue` : undefined} />
        <Kpi label="Columns" value={String(renderCols.length)} delta={`${filters.groupBy} view`} />
      </div>

      {/* Revenue & profit chart */}
      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-5">Revenue &amp; profit</h2>
        {isLoading ? (
          <Skeleton className="w-full" style={{ height: 240 }} />
        ) : !hasRevenue ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>No settled payments in this period{practiceId ? ' for this practice.' : '.'}</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--ink-muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--ink-soft)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => poundsCompact(v)} width={56} />
              <Tooltip formatter={(v: number, name: string) => [poundsCompact(v), name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="Revenue" fill={BRAND} radius={[2, 2, 0, 0]} />
              <Bar dataKey="Profit" fill={ACCENT} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* P&L matrix */}
      {renderCols.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <h2 className="display text-lg font-semibold">Profit &amp; Loss statement</h2>
          </div>
          <table className="w-full" style={{ fontSize: 13, minWidth: 520 }}>
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: cellPad }}>Line</th>
                {renderCols.map((c) => (
                  <th key={c.key} className="text-right" style={{ padding: cellPad }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PL_LINES.map((l) => (
                <tr key={l.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: cellPad }}><strong>{l.label}</strong></td>
                  {renderCols.map((c, ci) => {
                    const real = l.key === 'revenue' ? true : costsAvailable;
                    const pct = pctCells?.[ci]?.[l.key as LineKey];
                    return (
                      <td key={c.key} className="text-right text-ink-muted" style={{ padding: cellPad }}>
                        {fmtCell(c.values[l.key as LineKey], real)}
                        {filters.compare.pctOfIncome && pct != null && (
                          <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}> ({pct.toFixed(0)}%)</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--ink)' }} className="font-bold">
                <td style={{ padding: cellPad }}>Net profit</td>
                {renderCols.map((c) => (
                  <td key={c.key} className="text-right" style={{ padding: cellPad, color: costsAvailable ? 'var(--success)' : undefined }}>
                    {costsAvailable ? poundsCompact(c.profit) : '—'}
                  </td>
                ))}
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: cellPad }}>Margin %</td>
                {renderCols.map((c) => (
                  <td key={c.key} className="text-right" style={{ padding: cellPad }}>
                    {c.marginPct == null ? <span className="text-ink-muted">—</span> : (
                      <span className={`chip ${c.marginPct >= 10 ? 'chip-emerald' : 'chip-amber'}`}>{c.marginPct.toFixed(1)}%</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no type errors; lint clean (or only pre-existing warnings).

- [ ] **Step 3: Manual QA via browse**

Start the app (`cd frontend && npm run dev`, backend running too) and use the `/browse` skill to:
- Load `/profit`; confirm the matrix renders with Month columns by default.
- Toggle Columns: Total / Quarter / Year — column headers change, totals reconcile (Year column = sum of its months).
- Toggle Compare: % of income (shows `(NN%)` next to cost lines), Prev period, Prev year (adds total columns).
- Toggle Accrual/Cash — sub-label flips; Cash shows the cash empty-state when no cash rows exist.
- If a QBO company is connected, the company `<select>` filters the figures.
- Export to PDF opens a print window with the same columns.
Capture a screenshot as evidence.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/finance/components/ProfitScreen.tsx
git commit -m "feat(profit): QuickBooks-style P&L matrix render + company filter + PDF"
```

---

## Phase E — Docs + final verification

### Task 10: Docs + full-suite gate

**Files:**
- Modify: `docs/FORMULAS.md` (note dual accounting basis on the P&L read path)
- Modify: `docs/API.md` (finance-series new query params)

- [ ] **Step 1: Update FORMULAS.md**

Add a short subsection under the P&L / monthly_financials section noting: `monthly_financials.accounting_method` ('accrual'|'cash'); the finance-series read path resolves buckets per basis; cash basis surfaces only QB cash-pull rows; manual/Xero are accrual-only. (Match the file's existing heading style.)

- [ ] **Step 2: Update API.md**

Under `GET /api/analytics/finance-series`, document the new query params: `accounting_method` (`accrual`|`cash`, default `accrual`), `integration_account_id` (uuid, optional QBO company filter), and `months` (max now 24).

- [ ] **Step 3: Full backend suite (regression gate)**

Run: `cd backend && npx vitest run`
Expected: the only failures are the 4 pre-existing GHL tests (`ghl-account.service`, `webhook-ghl-account`, `gohighlevel-practice-stamp`). The 2 new finance test files pass. No NEW failures.

- [ ] **Step 4: Frontend typecheck (regression gate)**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add docs/FORMULAS.md docs/API.md
git commit -m "docs(profit): dual accounting basis + finance-series params"
```

---

## Deferred / out of this plan
- Applying `000089` on hosted Supabase + `NOTIFY pgrst` (ops step at deploy time).
- A QuickBooks **full re-sync** to populate cash rows (until then Cash view is empty-state).
- Full QB account-level hierarchy (Income/COGS/Expense named rows) — bucket granularity only.

## Self-review notes
- Spec coverage: layout (Task 9), columns Total/Month/Quarter/Year + custom (Tasks 6,8,9), compare %-income/prev-period/prev-year (Tasks 6,9), cash+accrual (Tasks 1,2,4,5,9), practice + QBO company filters (Tasks 3,4,7,9), migration 000089 (Task 1). All present.
- Type consistency: `MatrixColumn`/`LineKey`/`GroupBy`/`QbFilters`/`FinanceSeriesOpts` are defined once and imported where used; `bucketsByPeriod(rows, {accountingMethod})` signature matches all call sites; `_actualsBundle`/`financeSeries` optional-arg additions are back-compatible with untouched callers.
