# Dentally A/R reconciliation — scope

Goal: reproduce Dentally's **Practice accounts** report (Opening A/R, Net charges,
Net payments, Closing A/R, % collected, split Sundries vs Treatments) inside our
app, per practice + month. Reference figures (GM Dental Ashford, May 2026):

| Metric        | Dentally   | Our DB (pre-fix) | Status |
|---------------|-----------:|-----------------:|--------|
| Opening A/R   | £50,829.92 | not derivable    | ❌ |
| Net charges   | £182,468.29| £183,856.17      | ✅ ~0.8% drift |
| Net payments  | £169,511.96| £126,989.40      | ❌ short £42.5k |
| Closing A/R   | £63,707.35 | £57,204.59 (outstanding) | ❌ ballpark |

## Why it doesn't reconcile today

1. **Method taxonomy was destroyed on ingest** — FIXED (commit `2aac1da`).
   Dentally sends `method` as Title-Case ("Credit Card", "Debit Card", "Cash",
   "BACS"); the old lowercase-snake whitelist null'd ~94% of rows. Re-sync
   backfills the canonical values.

2. **The "Adjustments" leg is not in `/payments`.** Dentally's Net payments =
   `Payments` (cash receipts) + `Adjustments` (invoice-side credits / write-offs
   / plan & insurance allocations). The Adjustments figure (£106,745.31 for May)
   is **not** a payment object and there is **no `/adjustments` endpoint**. It is
   reconstructable only from invoice settlements.

3. **We discard the allocation model.** Each `/payments` row carries:
   - `amount`, `amount_unexplained`, `fully_explained`, `status`
     (`paid` | `unexplained` | `partially_explained`), `deleted`
   - `explanations[]` — array of `{ invoice_id, invoice_reference, amount }`
     allocating the payment across invoices.
   We store only `amount` + `method` + `status`, so we cannot tell how much of a
   payment was applied to which invoice, in which period — the core of A/R.

4. **Invoice history is incomplete.** `invoices` only goes back ~2024-02 and holds
   far fewer rows than `payments` (cumulative payments £3.6M >> charges £1.6M
   pre-May — impossible in a real ledger). Opening A/R = Σcharges − Σsettlements
   before the month, so it needs the full charge history.

## Data needed (Dentally API, verified shapes)

- **`/payments`** — already pulled. Must additionally persist `explanations[]`,
  `amount_unexplained`, `fully_explained`. Raw `method`/`status` now mapped.
- **`/invoices`** — pulled. Has `amount` (net), `amount_outstanding`, `dated_on`,
  `paid`. The per-invoice adjustment = gross line items − `amount` (charge side).
- **`/invoice_items`** — pulled (gross per-line fees, `nhs_charge` flag → drives
  the Sundries vs Treatments split).
- **Sundries vs Treatments**: classify by invoice_item type / `nhs_charge` /
  treatment name. Dentally tags "Sundries" distinctly — confirm the field in the
  sandbox; line items expose `name`/category.

## Proposed model

- Add `payment_explanations` table (or `explanations jsonb` on `payments`):
  `payment_id, invoice_id, invoice_reference, amount_pence, dated_on`. Keyed by
  Dentally `explanation.id`; upsert on re-sync.
- A `practice_accounts(practice_id, period, type)` RPC computes, from
  explanations + invoices:
  - **Net charges** = Σ invoice charges dated in month (− invoice adjustments)
  - **Payments** = Σ explanation amounts where the *payment* method is a real
    receipt, dated in month
  - **Adjustments** = Σ explanation/settlement amounts via non-cash means
    (write-off / credit / plan / insurance)
  - **Opening A/R** = Σ charges − Σ settlements with `dated_on < month start`
  - **Closing A/R** = Opening + Net charges − Net payments
  - **% collected** = Net payments ÷ Net charges

## Open questions / verification (sandbox)

- Exact Dentally `method` vocabulary (full list) and which map to the report's
  "Adjustments" bucket vs "Payments".
- Does `/payments` `per_page` cap server-side? A probe returned 25 rows for
  `per_page=250` — confirm `streamPages` (PER_PAGE=100) isn't under-pulling.
- Sundries classification field on invoice_items.
- Whether a deeper-than-2-year backfill is needed for a correct Opening A/R
  (product rule currently caps history at 2 years).

## Sequence

1. ✅ Fix method/status ingest + skip deleted (`2aac1da`).
2. Re-sync full backfill → canonical methods on existing rows.
3. Persist `explanations[]` + `amount_unexplained`/`fully_explained` (migration).
4. `practice_accounts` RPC + period-scoped query.
5. Frontend: Accounts/Statement screen matching the Dentally layout.
6. Reconcile against Dentally May 2026 to the penny; document residual drift.
