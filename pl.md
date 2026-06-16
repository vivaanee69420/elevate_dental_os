# P&L & Margin tab — data lineage & verification

Branch: `worktree-feat-pl-margin-quickbooks`
Scope of this work: the **P&L & Margin** tab only (route `/financial`). The separate
**Profit & Loss** tab (`ProfitBenchmarkScreen` / `/profit`) is owned by another agent —
untouched here.

This doc explains exactly where every number on the tab comes from, what was wrong,
what was changed, and the real figures to verify against the live org.

---

## 1. What the tab is

- **Route:** `frontend/app/(dashboard)/financial/page.tsx` → renders `PLMarginScreen`.
- **Component:** `frontend/features/intelligence/components/PLMarginScreen.tsx`.
- **Cards on it:**
  1. KPI row — Revenue, Net operating profit (+ margin%), Staff & clinician ratio.
  2. **Profit & Loss — group statement** (Revenue → Lab & materials → Gross →
     Staff & clinician pay → Other operating costs → Net operating profit → Net margin).
  3. **P&L by Entity / by Company** (per-entity breakdown table) — the card in the screenshot.

---

## 2. Where the data comes from (full chain)

```
PLMarginScreen.tsx
  └─ usePLMargin(opts)                         frontend/features/intelligence/pl-margin-hooks.ts
       └─ fetchPLMargin(scope, win, opts)      frontend/features/intelligence/pl-margin-api.ts
            └─ GET /api/analytics/pl-margin?scope&since&until&source&account_id&accounting_method
                 (same-origin proxy app/api/backend/[...path] injects the tenant Bearer token)
                 └─ analytics.routes.js  GET /pl-margin  (requirePermission 'finance.view')
                      └─ analytics.controller.js  plMargin()        parses scopeQuerySchema
                           └─ analytics.service.js  plMargin(orgId, {scope, period, since, until,
                                                              source, accountId, accountingMethod})
                                └─ monthlyFinancialRepository.allForOrg(orgId, {source, accountId})
                                     └─ Supabase table: public.monthly_financials
                                └─ quickbooksFinanceRepository.accounts(orgId)   (company labels)
                                     └─ Supabase table: public.integration_accounts
```

### The source table: `public.monthly_financials`

Every P&L number is a sum over this one table. Columns used:

| column                  | meaning                                                                    |
|-------------------------|----------------------------------------------------------------------------|
| `organisation_id`       | tenant guard (explicit `.eq`, serviceClient bypasses RLS)                   |
| `practice_id`           | Dentally practice tag — **NULL for all QuickBooks rows** (QBO isn't practice-mapped) |
| `integration_account_id`| the **QuickBooks company** (FK → `integration_accounts.id`) — set on QBO rows |
| `period`                | `'YYYY-MM'`                                                                 |
| `dental_bucket`         | `revenue \| associates \| staff \| lab \| materials \| overhead \| other \| tax` |
| `amount_pence`          | integer pence                                                              |
| `source`                | `'quickbooks' \| 'xero' \| 'manual'`                                        |
| `accounting_method`     | `'accrual' \| 'cash'` (QBO pulls BOTH; pre-column/manual/xero rows = accrual) |

QuickBooks rows are written by the QBO sync (migrations `000085` integration_accounts,
`000086` integration_account_id columns, `000089` accounting_method). Revenue
misclassification (Cost-of-Sales folding into revenue) was already fixed in a prior
session — buckets in this table are trustworthy.

### Bucket → P&L line mapping (`plLineFromBuckets`, analytics.service.js)

| P&L line                | buckets summed                          |
|-------------------------|-----------------------------------------|
| Revenue                 | `revenue`                               |
| Lab & materials (direct)| `lab` + `materials`                     |
| Gross profit            | Revenue − Lab & materials               |
| **Staff & clinician pay** | `staff` + **`associates`**            |
| Other operating costs   | `overhead` + `other`                    |
| Net operating profit    | Revenue − Lab&mat − Staff − Other opex  |
| Net margin              | Net ÷ Revenue                           |
| `tax`                   | **excluded** (below the operating line) |

---

## 3. What was wrong (and is now fixed)

### Bug A — `associates` bucket was dropped → net profit & margin wildly overstated

`plLineFromBuckets` computed `staffPence = b.staff` only, **ignoring the `associates`
bucket entirely**. Xero folds clinician pay into `staff` (so `associates`=0 there, no
harm), but **QuickBooks classifies clinician pay into its own `associates` bucket**.
For the live org that bucket is **£1,550,707.65** of cost that simply vanished from the
statement.

- Before fix (group, trailing 12mo accrual): Net ≈ **£2,519,417 / 49.7% margin** — wrong.
- After fix: Net ≈ **£968,710 / 19.1% margin** — correct.

Fix: `staffPence = (b.staff || 0) + (b.associates || 0)`. This matches the sibling
helpers `plInputFromBuckets` and `financeSeriesRowFromBuckets`, which both already
included associates, and the label "Staff & clinician pay" (`dentistStaffSeparable:false`).

### Bug B — "P&L by Entity" was permanently empty for QuickBooks

The per-entity split keyed only on `practice_id`. QBO rows have `practice_id = NULL`, so
every QBO row collapsed into the group bucket → `perEntityAvailable:false` → the empty
state in the screenshot ("Your accounting feed posts at group level…").

But QBO rows **do** carry `integration_account_id` — the QuickBooks **company**, which is
a real legal entity. Fix: entity key is now
`practice_id ? practice_id : (integration_account_id ? 'qbo:'+id : '__org__')`. QBO data
now splits **per company**, labelled from `integration_accounts.config.company_name`. The
card renders as "P&L by Company".

### Bug C — no accrual/cash control, and (potential) double counting

`bucketsByPeriod` defaults to `accrual`, so the old screen showed accrual only with no way
to see cash basis. The screen now passes the selected `accountingMethod`; choosing **Cash**
surfaces the QBO cash-basis rows instead. (Because the helper filters by method, accrual
and cash are never summed together — no double count.)

---

## 4. Dentally filters removed, QuickBooks filters added

- **Removed:** the practice (Dentally) scope pill row. `<ScopePeriodBar dentallyOnly />`
  → `<ScopePeriodBar hideScope={hasQbo} dentallyOnly />`. When QuickBooks is connected the
  practice scope is hidden (QBO can't honour it — it's not practice-mapped). The **period**
  pills stay.
- **Added** (`QboFilterBar` in `PLMarginScreen.tsx`, shown only when ≥1 active QBO company):
  - **QuickBooks company** selector — "All companies" + each connected company
    (`integration_account_id`). Drives `account_id`.
  - **Accounting basis** toggle — Accrual / Cash. Drives `accounting_method`.
- Filters flow: state in `PLMarginScreen` → `usePLMargin(opts)` (in the query key, so it
  refetches) → `fetchPLMargin` query params → controller → service.

### Adaptive behaviour (so non-QBO orgs are unchanged)

- **QBO connected** → QuickBooks-first: `source=quickbooks`, company + basis filters, P&L
  by Company.
- **No QBO connected** → falls back to the previous all-feeds view (`source=combined`,
  accrual) **with** the practice scope bar, so Xero/manual orgs behave exactly as before.

---

## 5. Edge cases handled

| Case | Behaviour |
|------|-----------|
| No QuickBooks connected | Practice scope + all-feeds combined view (legacy path, unchanged) |
| QBO connected, "All companies" | Group statement + one row per company |
| QBO connected, one company picked | Repo filters to that `integration_account_id`; single-entity statement |
| Stale/disconnected company still selected in UI | Silently falls back to "All companies" (`selected` guard) |
| Accrual vs Cash | `accounting_method` filter; helper never mixes the two |
| Company/period with no rows | Honest empty state ("No QuickBooks P&L for this company/period…") |
| Untagged QBO rows (no `integration_account_id`) | Stay in the group total; not shown as a company row; QBO-aware empty-state copy if that's all there is |
| Disconnected accounting integration | `revokedSources` still drops its imported lines (unchanged) |
| `account_id` tampering | `scopeQuerySchema` rejects non-UUID; `orgId` bound server-side (tenant isolation) |
| Tax bucket | Excluded from operating P&L (unchanged, matches baseline P&L) |

---

## 6. Real figures to verify against (live org `1a5f888a-0dfe-4802-acf8-6003665089ad`)

Trailing 12 months in the table: **2025-07 → 2026-06**. All values £ (pence ÷ 100).
`Staff` column = staff + associates (the fix).

### Accrual basis — P&L by Company

| Company             | Revenue      | Lab & mat   | Staff (incl. assoc.) | Other opex  | Net profit  | Margin |
|---------------------|-------------:|------------:|---------------------:|------------:|------------:|-------:|
| G Mehta Limited     | 2,256,069.90 | 279,497.73  | 823,701.74           | 380,413.57  |  772,456.86 | 34.2%  |
| Gmvalley Limited    | 1,326,767.26 | 357,057.14  | 835,129.70           | 138,340.62  |   −3,760.20 | −0.3%  |
| Smilevalley Limited | 1,117,707.69 | 162,441.34  | 364,176.16           | 408,857.61  |  182,232.58 | 16.3%  |
| Gmd Bexleyheath Ltd |   348,914.53 |  46,527.40  |  75,989.42           | 220,338.14  |    6,059.57 |  1.7%  |
| (Untagged rows)     |    14,797.57 |       0.00  |       0.00           |   3,076.59  |   11,720.98 | 79.2%  |
| **Group total**     | **5,064,256.95** | **845,523.61** | **2,098,996.02** | **1,151,026.53** | **968,710.79** | **19.1%** |

(Untagged = 10 stray QBO rows with no `integration_account_id`; they sit in the group
total but are not shown as a company row.)

### Group statement quick-check (accrual, trailing 12mo)
- Revenue **£5,064,256.95**
- − Lab & materials £845,523.61 → Gross **£4,218,733.34**
- − Staff & clinician pay £2,098,996.02
- − Other operating costs £1,151,026.53
- = **Net operating profit £968,710.79**, **Net margin 19.1%**
- (`associates` portion folded into Staff = £1,550,707.65 — the figure that was missing before.)

### Cash basis
Cash-basis rows for this org are near-identical to accrual at company level (G Mehta, Gmvalley,
Smilevalley, Gmd Bexleyheath all match); the only group difference is the untagged accrual-only
rows, so cash group revenue is **£5,049,459.38**. Toggle **Cash** to see the cash-basis pull.

### How to reproduce the numbers (SQL)
```sql
select coalesce(ia.config->>'company_name', ia.label, 'Untagged') company,
       mf.accounting_method method,
       sum(amount_pence) filter (where dental_bucket='revenue') rev,
       sum(amount_pence) filter (where dental_bucket in ('lab','materials')) labmat,
       sum(amount_pence) filter (where dental_bucket in ('staff','associates')) staff_assoc,
       sum(amount_pence) filter (where dental_bucket in ('overhead','other')) otheropex
from monthly_financials mf
left join integration_accounts ia on ia.id = mf.integration_account_id
where mf.organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad' and mf.source='quickbooks'
group by 1,2 order by 2,3 desc;
```

---

## 7. Files changed

Backend:
- `backend/src/services/analytics.service.js`
  - `plLineFromBuckets`: fold `associates` into `staffPence` (accuracy fix).
  - `plMargin`: new params `source` / `accountId` / `accountingMethod`; entity grouping by
    QBO company (`integration_account_id`) as well as `practice_id`; company labels from
    `integration_accounts`; pass `accountingMethod` to `bucketsByPeriod`; return
    `source`, `accountingMethod`, `perEntityKind`.
  - import `quickbooksFinanceRepository`.
- `backend/src/controllers/analytics.controller.js` — pass the 3 new params through.
- `backend/src/models/analytics.model.js` — `scopeQuerySchema` gains `source`,
  `account_id` (UUID), `accounting_method`.

Frontend:
- `frontend/features/intelligence/pl-margin-api.ts` — `PLEntity.kind` adds `'company'`;
  `PLMargin` adds `source`/`accountingMethod`/`perEntityKind`; `PLMarginOpts`;
  `fetchPLMargin` sends the QB query params.
- `frontend/features/intelligence/pl-margin-hooks.ts` — `usePLMargin(opts)` (opts in key).
- `frontend/features/intelligence/components/PLMarginScreen.tsx` — `QboFilterBar`
  (company + accrual/cash), adaptive scope bar, P&L by Company copy/headers/empty-states.

Tests:
- `backend/test/pl-margin.test.mjs` — 3 new cases: associates folded into staff,
  per-company split with labels, cash-vs-accrual no double count.

---

## 8. Verification run

- `npx vitest run test/pl-margin.test.mjs` → **8/8 pass**.
- Full backend suite: 995 pass; the 11 failures are **pre-existing on the base branch**
  (ghl-dashboard, gohighlevel-sync, chair-utilisation, finance-quickbooks) — confirmed by
  re-running them with this branch's changes stashed. None touch the P&L path.
- Frontend `tsc --noEmit` clean; `next lint` clean; webpack **Compiled successfully**.
  (The `npm run build` prerender error on `/forgot-password` is missing Supabase env vars in
  the worktree, not a code issue — CI builds with env set.)
