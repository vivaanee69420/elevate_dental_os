# Reconciliation Rules

The trust layer. Numbers don't get shown to the owner until they reconcile within tolerance.

The five controls below run on a schedule, write to `reconciliation_runs`, and create entries in `reconciliation_exceptions` whenever a variance breaches tolerance or a record fails to match.

---

## The five controls

| Control code | Compares | Tolerance | Frequency | Owner |
|---|---|---|---|---|
| `cash_received` | Dentally payments vs accounting receipts | 0.5% | Daily | Finance |
| `revenue_by_practice` | Dentally invoiced value vs accounting P&L by tracking/class | 1.0% | Weekly | Finance |
| `aged_debt` | Dentally account balances vs AR report | Patient/invoice exact match | Weekly | Finance + PM |
| `treatment_starts` | GHL opportunities won vs Dentally treatment started | Lead-level exact match | Daily | Growth ops |
| `entity_totals` | Practice totals vs group close pack | 0.5% | Monthly | Finance lead |

---

## Tolerance status

For each run:

- `variance_pct = abs(variance) / max(abs(source_value), abs(target_value))`
- `green` if `variance_pct <= tolerance_pct`
- `amber` if `variance_pct <= tolerance_pct * 2`
- `red` if `variance_pct > tolerance_pct * 2`

For exact-match controls (`aged_debt`, `treatment_starts`):
- `green` if zero unmatched records
- `amber` if 1-5 unmatched records
- `red` if 6+ unmatched records

---

## Exception categories

Every exception uses one of these fixed categories. Anything else needs owner sign-off via a manual `manual_override_pending` exception.

| Category | When |
|---|---|
| `timing_difference` | Same transaction in both systems but on different dates · clears within 3 days |
| `unmapped_account_code` | An accounting account isn't mapped to a `dental_bucket` |
| `missing_practice_mapping` | A transaction has no Xero tracking / QB class / location, so it can't be allocated to a practice |
| `duplicate_payment` | Same external ID landed twice — one needs voiding |
| `deleted_or_reversed` | Source system shows the record but it's been reversed and the target hasn't caught up |
| `manual_override_pending` | A manual journal or upload has been queued but not approved yet |
| `crm_patient_match_failure` | A GHL contact / opportunity can't be matched to a Dentally patient |

---

## Control 1: `cash_received`

**What:** Dentally payment totals match accounting receipts.

**Frequency:** Daily, 02:00 local. Runs against the prior closed day.

**Source value:** Sum of `payments.amount` where `paid_at::date = T-1` and `reversed = false`, grouped by practice.

**Target value:** Sum of `accounting_transactions.amount_base` where `txn_date = T-1`, `txn_type = 'payment'`, and the account is in the `revenue.*` bucket family, grouped by `practice_id`.

**Tolerance:** 0.5% per practice.

**Common causes of amber/red:**
1. Card payments posted to merchant clearing account one day later (timing → green next day)
2. Cash takings batched and posted weekly (timing)
3. Refunds/voids hitting one side but not the other
4. New payment method not yet mapped to an account

**Sample query:**

```sql
WITH dentally_side AS (
  SELECT practice_id, SUM(amount) AS total
  FROM payments
  WHERE paid_at::date = CURRENT_DATE - 1 AND NOT reversed
  GROUP BY practice_id
),
accounting_side AS (
  SELECT atc.practice_id, SUM(at.amount_base) AS total
  FROM accounting_transactions at
  JOIN accounting_accounts aa ON aa.id = at.account_id
  LEFT JOIN accounting_tracking_categories atc ON atc.option_value = at.reference
  WHERE at.txn_date = CURRENT_DATE - 1
    AND at.txn_type = 'payment'
    AND aa.dental_bucket LIKE 'revenue.%'
  GROUP BY atc.practice_id
)
SELECT d.practice_id,
       d.total AS source_value,
       COALESCE(a.total, 0) AS target_value,
       d.total - COALESCE(a.total, 0) AS variance,
       ABS(d.total - COALESCE(a.total, 0)) / NULLIF(GREATEST(ABS(d.total), ABS(COALESCE(a.total, 0))), 0) AS variance_pct
FROM dentally_side d
LEFT JOIN accounting_side a USING (practice_id);
```

---

## Control 2: `revenue_by_practice`

**What:** Dentally invoiced revenue matches accounting P&L revenue.

**Frequency:** Weekly, Sunday 02:30. Runs against the prior 7 days.

**Source value:** Sum of `invoices.total_amount` where `issued_at` falls in the week, grouped by practice.

**Target value:** Sum of revenue-bucket transactions in `accounting_transactions` for the same week, grouped by practice (via tracking category mapping).

**Tolerance:** 1.0% per practice.

**Common causes:**
1. Accrual vs cash basis differences for the same period
2. Treatment plan items invoiced but not yet completed (some practices delay)
3. Lab cost rebates or supplier credits posted as negative revenue
4. NHS UDA claims paid out of cycle

---

## Control 3: `aged_debt`

**What:** Dentally account balances match accounts-receivable report from accounting.

**Frequency:** Weekly, Sunday 03:00.

**Match:** Exact at the patient × invoice level.

**Source:** `accounts_receivable` snapshot (rebuilt nightly).

**Target:** Accounting AR aging report, joined to patients via Xero/QB contact ID.

**Common causes:**
1. Patient marked as paid in Dentally but the payment hasn't synced to accounting yet
2. Patient finance plans where the financier paid the practice but the patient still owes the financier
3. Direct debit batches not yet settled

---

## Control 4: `treatment_starts`

**What:** Every won GHL opportunity should correspond to a started Dentally treatment plan within 30 days.

**Frequency:** Daily, 02:15. Checks won opportunities from the prior 30 days.

**Match:** Lead-level. Uses the matching cascade from `DATA_MODEL.md` (phone → email → name+DOB).

**Exceptions raised when:**
1. Won opp + no matching patient → `crm_patient_match_failure`
2. Won opp + matching patient + no treatment plan started → growth ops investigates

This is the most operationally important control. Conversion rate is meaningless if the won leads don't actually become treatment starts.

---

## Control 5: `entity_totals`

**What:** Sum of practice-level monthly totals equals the entity-level close.

**Frequency:** Monthly, on the close date.

**Source value:** Sum of all `monthly_financials.revenue_total` for the period at practice level.

**Target value:** `monthly_financials.revenue_total` at entity level (where `practice_id IS NULL`).

**Tolerance:** 0.5%.

**Common causes:**
1. Group-level costs allocated to practices via journal that hasn't synced
2. Inter-practice transfers
3. Adjustments posted between close date and report date

---

## Approval flow

```
Exception created
     │
     ▼
Status: open
     │
     ├─→ "Route" action → assigns to a user (e.g. practice manager)
     │     Status: routed
     │
     └─→ "Resolve" action by owner / finance_lead
           Records note + writes audit
           Status: resolved
```

`manual_override_pending` exceptions require **dual sign-off** — the user who created the override is not the same user who approves it.

---

## Sign-off on a run

A run can be signed off only when:
1. Its status is `green`, **or**
2. Its status is `amber`/`red` AND every related exception has status `resolved` or `dismissed`.

`reconciliation_runs.signed_off_by` + `signed_off_at` are set. The run becomes immutable. Audit entry written.

A board pack cannot be marked `final` until every reconciliation run for the period is signed off.

---

## Re-running a control

If new data arrives after a run (late webhook, manual upload), the run is **not** mutated. Instead:
- Create a new run with `superseded_by` (add this column when needed) pointing forward
- The previous run stays in the audit trail

This preserves the historical record of what the numbers looked like when the owner signed off.

---

## Job orchestration

Use a job queue (Redis-backed, e.g. BullMQ) so reconciliation runs are:
- Retried on transient failures (max 3 attempts, exponential backoff)
- Logged with `started_at` / `finished_at` for SLA tracking
- Concurrency-limited per control (no two `cash_received` runs at the same time for the same practice)
- Alertable when they fail repeatedly

The runner file structure:

```
src/reconciliation/
├── runner.js           ← orchestrates which control runs when
├── controls/
│   ├── cash-received.js
│   ├── revenue-by-practice.js
│   ├── aged-debt.js
│   ├── treatment-starts.js
│   └── entity-totals.js
└── exceptions.js       ← shared exception creation + categorisation
```

---

## What "trust the dashboards" means in practice

A KPI snapshot is only marked `source_quality = 'reconciled'` once:
- Every control covering its period has at least one signed-off run
- Zero open exceptions for the period
- Manual feed uploads (if any) are approved

If any of those is false, the snapshot is marked `provisional` and the UI shows it with a small amber dot — same data, lower trust.
