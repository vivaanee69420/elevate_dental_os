# EOD — 2026-09-09 · Finance section audit

**Branch:** `fix/finance-section` → merged and fast-forwarded onto `main` (`9b3b0ba`).
**Worktree:** `/Users/ruhithpasha/code/work/Dental-os-finance`.
**State:** backend 326 files / 3,693 tests green · 0 lint errors (13 pre-existing
warnings) · frontend typecheck, lint and production build clean · ggshield clean
across `origin/main..HEAD`.

---

## What this session was

It began as "fix the cashflow page" and became an audit of every screen in the
Finance tab strip. The pattern that kept repeating: **the arithmetic was
correct and the meaning was not.** Nearly every figure reconciled to its own
formula while describing something other than what the label claimed.

Every fix below was measured on live data before and after, and every one is
tenant-general — service-level, no org-specific branches.

---

## The defects, in the order they were found

### 1. Cashflow's weekly table invented a bank balance
It seeded the opening balance **thirteen weeks ago** with *today's* bank figure
and added receipts forward, with `paymentsPence` hardcoded to `0`. The closing
column was therefore `today's balance + every receipt in the window`.

| | |
|---|---|
| Real bank position | £783,422 |
| Displayed as | £1,846,524 |
| Fabricated | £1,063,102 |

…rendered directly beneath an outlook card anchoring the *same day* to the real
number. Before deleting the columns I checked whether a balance was buildable:
**`bank_transactions` is empty for every organisation and no code reads it**, so
there is no per-week outflow anywhere in the system. The panel now shows
receipts — what it always claimed to show — with a running total.

### 2. The cashflow page read ACCRUAL costs
QuickBooks is pulled on **both** bases and both are already in
`monthly_financials` (1,564 accrual rows, 1,537 cash, same 15 periods). The
outlook's own header called its figure *"an accrual proxy for cash out"* — a
proxy for data sitting in the same table. Differences are real: Jun +£5,492,
Jul −£8,207, Aug −£6,396.

There is now a **Cash / Accrual** toggle defaulting to cash. It **falls back**
rather than honouring the request literally, because `bucketsByPeriod` surfaces
only explicit cash rows and a Xero or manual-entry tenant has none — honouring
it would delete their whole cost side.

### 3. The current month's costs are a stub
Receipts land daily; payroll, rent and lab bills post late. On 9 Sep the feed
held **14 cost accounts against 65–72** in each prior month — £13,449 against
£298k–£428k — subtracted from nine days of takings and shown as
**"Net cash this month +£62,518"** in confident green.

No heuristic needed: a month cannot be complete before it ends. The month in
progress is now flagged wherever it appears.

### 4. Profit Benchmarking graded a part-month against annual ratios

| Month | Staff % of revenue | Net margin |
|---|---|---|
| Jul 2026 | 8.5% | 31.0% |
| Aug 2026 | 6.9% | 18.2% |
| **Sep, 9 days in** | **0.3%** | **66.6%** |

It opened on "This month" and rendered that 66.6% as **"+56.6 pts vs benchmark"
in green** — a spectacular false positive on the one page whose entire job is a
verdict. Now defaults to the last complete month, and **withholds the verdict
colour** (keeping the figures) when the window runs into the current month.

### 5. P&L & Margin's total carried another month's money
Each entity fell back to **its own** trailing twelve months when the window held
nothing for it. The single untagged row set in the ledger — **June** — was added
to September's total while being excluded from the visible rows:

| | Rows sum to | Total showed | Gap |
|---|---|---|---|
| Revenue | £42,876.59 | £57,674.16 | £14,797.57 |
| Other opex | £8,992.49 | £12,069.08 | £3,076.59 |

September revenue read **34.5% high**, net profit **41% high**. The "Mixed
month/annual" badge was the symptom. The fallback is now a decision about the
**whole statement**, and the untagged bucket is a visible row whenever there are
others to reconcile against.

### 6. The workbench's "real case fee" was averaged over an eleventh of the data
`invoice_case_rollup` returns one row per invoice; **PostgREST caps a
set-returning function at 1000 rows** exactly as it caps a table, and that
function has no `ORDER BY`. Against 8,816 invoices:

| | Page said | Truth |
|---|---|---|
| Full Arch invoices | 11 | **163** |
| Mean case fee | £7,785.06 | **£6,028.06** |

A **29% overstatement** of the one figure claiming to be measured, inherited by
net profit, margin, annual profit and target price. New `invoice_case_stats`
RPC aggregates in SQL, scopes by practice and window, and returns real case
**volume** — the throughput had been a hardcoded 1 surgery × 2 cases for every
tenant, against a real 13.6 Full Arch/month.

### 7. Revenue Leakage reported 77% of turnover as recoverable
Four separate faults:

- **The plans pool never measured acceptance.** It used
  `treatment_plans.completed`, and **Dentally sends no acceptance state at
  all**. The completed share of plan value ran **1.1%–6.5% in every one of the
  last thirteen months**, including months a year old — the flag is not
  populated. "Unaccepted" was essentially the entire presented value: £733,041,
  **93% of the headline**, counting work in progress as lost.
- **Collections was structurally always £0.00** — `revenue − cashCollected`,
  with settled receipts passed as *both*. Zero for every org forever. Now reads
  the real outstanding invoice balance (£3,183.30 → £27,111.11/yr, verified).
- **Measured and modelled pools were summed** and called recoverable.
- **The practice filter did nothing** — the page has always sent `scope`; the
  controller never read it.

### 8. The P&L revenue card misnamed its own source
It said **"Real settled payments"** while showing QuickBooks accrual revenue:
£5,290,546 against £4,348,681 of settled payments — a **£942k** gap between the
label and the number, wrong for any tenant with an accounting feed.

---

## What the pages do now

- **Every figure opens its working** in a dialog: where it came from, the
  arithmetic step by step, and whether it is **measured** or **modelled**.
- **Cash Flow** — animated area trend drawing a trailing series rather than the
  one-month picker (a single bar is not a trend); receipts table; six-card strip
  mixing Dentally and QuickBooks with comparisons.
- **Treatment Workbench** — **finally saves** (`treatment_models`), can hold
  treatments an organisation invents, and exposes three cost fields that fed the
  maths with no control on the page (Full Arch was carrying an invisible £600 of
  surgery run cost). Browser `window.prompt`/`confirm` replaced with real
  dialogs.
- **Profit Benchmarking** — its own route `/profit-benchmark`, nav entry, and
  `finance.view` in **both** permission maps.
- **Revenue Leakage** — "+ Task" removed: it turned a modelled upper bound into
  an assigned job, and one already existed telling someone to recover
  £733,041 that was never lost.
- Finance screens are full-width and consistent; filter rows share one aligned
  label column.

---

## Migrations

Both **applied on hosted and verified** (RLS on, `anon`/`authenticated`
revoked, `service_role` granted, `NOTIFY pgrst` run):

- `20260101000180_treatment_models.sql` — per-org treatment economics. A row
  keyed to a built-in **overrides** it; deleting restores the default. Lab,
  component and surgery costs exist in **no feed**, so these rows are the only
  copy.
- `20260101000181_invoice_case_stats.sql` — case fee **and volume** aggregated
  in SQL so the 1000-row cap cannot truncate it. Match rules are passed in as
  jsonb so `formulas.TREATMENT_CASE_RULES` stays the single definition.

⚠️ **Both numbers collide with migrations the parallel session added the same
day** (`000180_crm_aggregates`, `000180_pipeline_channel_autodetect`,
`000181_communications_thread_key`, `000181_single_practice_automap`).
Duplicate numbers are already the norm in this repo (15 pre-existing pairs) and
neither set depends on the other, so ordering stays deterministic — but worth
knowing before adding the next one. **Next free number is 000190.**

---

## Open / deliberately not done

- **Forward projection is still off** (`forward = 0`). The reason it was
  disabled — a part-month dragging the run-rate — is now fixed, so re-enabling
  it would make "Will I run out of money?" answerable again. **Product decision,
  not mine to flip.**
- **Recall and lapsed remain modelled** flat shares of revenue. Real figures
  need patient-level Dentally cohorts — a sync change, not a display one.
- **Group margin has no delta.** It is trailing-twelve-month, so a
  period-over-period comparison would compare overlapping years.
- **Marketing spend / ROAS have no comparison** — they come from the ROI feed,
  which needs a second call like the Facebook panel does.
- **`calculateCashFlow` in `formulas.js` is dead code** — the ghost of a design
  that assumed an outflow feed that never arrived.
- **Other Intelligence pages may drop `scope` too.** The leakage controller
  silently ignored a parameter the client was already sending; worth sweeping
  the rest rather than finding the next one by accident.
- **A stale "Recover: …" task** may still sit in the Task Manager from the
  removed button. Existing rows were not touched.

---

## Notes for whoever picks this up

- **`rules.md`** at the repo root is the working contract agreed at the start of
  this session — multi-tenant by default, fix for every account not the reported
  one, ask agency-vs-sub-account before building, no keys in any file, no
  patient records without permission. Imported by `CLAUDE.md` and printed by a
  `SessionStart` hook. A `PreToolUse` hook runs ggshield on every
  `git commit`/`git push`.
- **The dev servers are detached** (`nohup … & disown`), logging to the session
  scratchpad. They were killed twice as harness-managed background tasks — the
  machine was 51% free, so it was the task supervisor, not the OS.
- **`.env` files were copied into this worktree** (gitignored, never staged) —
  `git worktree add` does not bring them and the servers will not boot without
  them.
