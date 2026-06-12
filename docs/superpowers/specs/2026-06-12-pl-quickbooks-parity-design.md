# P&L QuickBooks-parity redesign — design

Date: 2026-06-12
Branch/worktree: `worktree-feat+pl-quickbooks-parity`
Status: approved (design), pending implementation plan

## Goal

Rework the `/profit` (Profit & Loss) page so it reads and filters like the QuickBooks
Online **Profit and Loss** report, while keeping the existing 5-bucket cost
granularity (Revenue, Associate pay, Staff, Lab/materials, OpEx) rather than the
full QB account hierarchy. Add the QuickBooks filter set: report period + custom
range, accounting method (Accrual | Cash), display-columns-by (Total / Month /
Quarter / Year), and comparison columns (% of income, previous period, previous
year). Keep practice scope; add a QBO-company filter.

## Non-goals

- Full QB account-level hierarchy (Income -> COGS -> each named account). We stay at
  the 5-bucket granularity. (Account names remain in `monthly_financials.account_code`
  but are not surfaced as individual rows in this pass.)
- Replacing the manual-actuals entry flow (`ManualPLModal`) — unchanged.
- Touching Xero sync, the benchmark screen, or any GHL code.

## Data sources (current reality)

`monthly_financials` rows (one per period + account + company + source):
- `period` (YYYY-MM), `account_code` (QB account name), `dental_bucket`
  (revenue|staff|lab|materials|overhead|tax|other), `amount_pence`,
  `integration_account_id` (QBO company), `source` (quickbooks|xero|manual),
  `practice_id` (QBO lands on org's first practice; company is the real
  discriminator).
- Revenue line of the on-screen P&L comes from settled `payments` (cash receipts)
  in `analytics.service.financeSeries`; costs come from `monthly_financials`
  buckets. **Note:** today QB only syncs the **accrual** ProfitAndLoss report.

## Architecture

### 1. Page / components (frontend)

- `/profit` -> reworked `ProfitScreen` renders a **P&L matrix**:
  - Rows (fixed line items): Revenue, Associate pay, Staff, Lab/materials, OpEx,
    **Net profit**, **Margin %**.
  - Columns: time periods driven by "columns by" choice (single Total column, or
    one column per Month / Quarter / Year within the report period; custom range =
    single column), plus optional comparison columns.
- New `QbFilterBar` component (replaces/extends the current `DateRangeFilter` row):
  - **Report period**: presets (This month-to-date, This quarter, This year-to-date,
    Last month, Last quarter, Last year, Last 12 months) + **custom range**.
  - **Accounting method** toggle: Accrual | Cash.
  - **Columns by**: Total | Month | Quarter | Year.
  - **Compare** (multiselect): % of income | Previous period | Previous year.
- `PracticeTabs` (practice scope) stays. Add **QBO company** dropdown filtering by
  `integration_account_id` (null = all companies). Sourced from the existing QBO
  accounts list endpoint.
- PDF export updated to emit the same matrix (rows x chosen columns).

### 2. Compute split

Backend stores both accounting bases and returns a **monthly** bucket series for the
chosen method + scope. **Frontend** performs the pivot and all derived columns:
- `rollup(months, groupBy)` — bucket the monthly series into Total/Quarter/Year.
- `pctOfIncome(col)` — each row as % of that column's Revenue.
- `prevPeriod(cols)` / `prevYear(cols)` — window-shifted comparison columns derived
  from the same fetched series (backend returns a wide enough window — 24 months —
  so prev-year is in hand without a second request).

Rationale: keeps the backend change minimal (one new param + storage column); the
period math is pure and testable on the frontend.

### 3. Backend

- **finance-series endpoint** (`GET /api/analytics/finance-series`) gains params:
  - `accounting_method` = `accrual` (default) | `cash`.
  - `integration_account_id` (optional) = filter costs to one QBO company.
  - Default fetch window widened to **24 months** (so the frontend can build
    previous-year columns). Existing `months`/`from`/`to` still honoured.
- `analytics.service.financeSeries` + `_actualsBundle` + `monthlyFinancial`
  repo/service thread `accounting_method` and `integration_account_id` filters into
  the `monthly_financials` query.
- Manual + Xero rows are treated as `accrual` (cash basis is a QB-only concept);
  under the Cash view they are excluded unless a cash row exists.

### 4. QuickBooks sync (cash + accrual)

- `quickbooks-sync.js` `pullProfitAndLoss` runs the QB ProfitAndLoss report **twice
  per period** — once accrual (default) and once with `accounting_method=Cash` —
  stamping each written row with `accounting_method`. Delete-then-insert is scoped
  by `(org, period, source, integration_account_id, accounting_method)`.

### 5. Data model / migration `000089`

- `ALTER TABLE monthly_financials ADD COLUMN accounting_method text NOT NULL
  DEFAULT 'accrual'` + CHECK (`accounting_method in ('accrual','cash')`).
- Replace the existing unique index with one that also keys on `accounting_method`
  so cash + accrual rows coexist per period/account/company/source.
- Backfill: existing rows = `accrual` (covered by the DEFAULT). Idempotent.
- Run `NOTIFY pgrst, 'reload schema';` after applying (PostgREST cache).

## Behavioural notes / edge cases

- **Cash view before re-sync**: until a QB re-sync writes cash rows, the Cash view
  has no cost data -> shows the same "costs shown as £0 / connect a source" empty
  state the page already has. Documented in the UI sublabel.
- **Revenue vs accounting method**: the on-screen Revenue row is settled cash
  receipts regardless of method (that is what the page has always shown). The
  accounting-method toggle drives the **cost/expense** rows. Sub-label clarifies.
- **Margin %** row: Net profit / Revenue for the column; `—` when Revenue is 0 or
  no cost data.
- **% of income** with zero income -> `—`, never divide-by-zero.
- **Prev period / prev year** when no prior data -> blank comparison cells, not 0.

## Testing

- Backend (vitest): cash/accrual split in `pullProfitAndLoss` mapping; finance-series
  honours `accounting_method` + `integration_account_id` filters; existing
  finance-series tests still green.
- Frontend: no test framework. Rely on `npm run typecheck` + manual QA via `/browse`
  against the running app. Pure helpers (`rollup`/`pctOfIncome`/`prevPeriod`/
  `prevYear`) written side-effect-free for easy reasoning.

## Rollout

- Migration `000089` applied on hosted, then `NOTIFY pgrst`.
- A QB **full re-sync** (`opts.full`) needed to populate cash rows; until then Cash
  view is empty-state. Accrual view works immediately with existing data.

## Files (anticipated)

Backend:
- `supabase/migrations/20260101000089_monthly_financials_accounting_method.sql` (new)
- `src/lib/integrations/quickbooks-sync.js` (cash+accrual pull)
- `src/services/analytics.service.js` (financeSeries / _actualsBundle params)
- `src/services/monthlyFinancial.service.js` + `repositories/monthlyFinancial.repository.js`
- `src/controllers/analytics.controller.js` (parse new query params)
- tests under `backend/test/`

Frontend:
- `features/finance/components/ProfitScreen.tsx` (matrix render)
- `features/finance/components/QbFilterBar.tsx` (new; supersedes inline DateRangeFilter usage on this page)
- `features/finance/pl-matrix.ts` (new; pure rollup/compare helpers)
- `features/finance/api.ts` + `hooks.ts` (new params, QBO company list)
