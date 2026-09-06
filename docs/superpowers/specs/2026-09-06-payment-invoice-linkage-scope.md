# Payment → invoice linkage: scope

**Question asked:** the "Treatment Plan Fees Collected" card says money was
collected. What proves it?

**Answer today: nothing.** And the fix is not new data — it is data Dentally
already sends us and we throw away on ingest.

---

## 1. What the card actually computes

`treatments_closed_revenue_by_practice` (and `plan_fees_collected_lines`) derive
"collected" **entirely from the invoice header**:

```sql
fee_pence * (invoice.amount_pence - invoice.amount_outstanding_pence)
          / invoice.amount_pence
```

The `payments` table is never read. It *cannot* be: `payments` has no
`invoice_id` / `pms_invoice_id` column, only `contact_id` and its own
`external_id`. There is no join between a payment and an invoice anywhere in
this database.

`docs/API.md` describes `collected_pence` as "each line's share of its invoice's
**actual payments**". That sentence is wrong and should be corrected whatever
else we do — it is the reason the number is trusted.

## 2. Why that is not a proxy for cash

Dentally settles an invoice by **two** different mechanisms:

- **Payments** — real cash receipts (card, cash, BACS…).
- **Adjustments** — invoice-side credits: write-offs, plan allocations,
  insurance. These are *not* payment objects and Dentally exposes **no
  `/adjustments` endpoint** (see `docs/DENTALLY_AR_RECONCILIATION.md`).

`amount_outstanding = 0` therefore means **"settled by any means"**, not "paid".

This is not a rare edge. Measured at GM Dental Ashford, May 2026: adjustments
were **£106,745.31** against net payments of **£169,511.96** — non-cash
settlement is roughly 63% the size of cash settlement.

### Measured impact (Rochester, 1–6 Sep 2026)

Of the £11,428.62 the card called "collected":

| | invoices | amount |
|---|---:|---:|
| No settled payment within ±3 days of the invoice | 18 of 40 | £9,211.12 (81%) |
| Patient has **never** had a settled payment | 13 | £3,520.66 (31%) |

The payments feed is **not** incomplete — over a quarter it reconciles: Rochester
since June invoiced £517,688.90, invoices claim £450,143.85 settled, actual
settled payments £458,515.87 (1.8% apart). So the £3,520.66 is not missing data;
it is settlement by adjustment, counted as collection.

Two defects follow, and they are separate:

1. **Wrong clock.** "Collected" is dated by the **invoice**, never the payment.
   The card answers "of fees billed 1–6 Sep, how much has since been settled,
   whenever that happened". Over a quarter that converges on truth; over six days
   it is 81% wrong as a statement about that week. It sits beside Takings, which
   *is* payment-dated — two money cards, one window label, two clocks.
2. **Wrong definition.** Write-offs and credits are counted as money collected.

## 3. The linkage already exists in the feed

Each Dentally `/payments` row carries (shapes verified against the live API,
recorded in `DENTALLY_AR_RECONCILIATION.md`):

- `amount`, `amount_unexplained`, `fully_explained`, `deleted`
- `status` — `paid` | `unexplained` | `partially_explained`
- **`explanations[]` — `{ invoice_id, invoice_reference, amount }`**, allocating
  one payment across the invoices it settles.

`paymentRow()` in `dentally-sync.js:745` reads `id`, `site_id`, `patient_id`,
`amount`, `method`, `dated_on` — and nothing else. **`explanations[]` is
discarded on every sync.** That array is the entire missing link: it gives
payment → invoice → invoice_item → treatment plan, with its own amount and date.

A payment splits across invoices and an invoice is settled by several payments,
so this is many-to-many and needs its own table, not a column on either side.

## 4. Minimal scope to make "collected" provable

Deliberately narrower than full A/R reconciliation (opening balance, sundries
split, `practice_accounts`) — that is the wider goal in
`DENTALLY_AR_RECONCILIATION.md` and should not gate this.

1. **Migration** — `payment_explanations`:
   `(organisation_id, payment_id, pms_invoice_id, amount_pence, dated_on)`,
   unique on the Dentally explanation id, `organisation_id` on the row (rule 3),
   indexed `(organisation_id, pms_invoice_id)` and `(organisation_id, dated_on)`.
   Add `amount_unexplained_pence` + `fully_explained` to `payments`.
2. **Sync** — persist `explanations[]` in the existing payments phase; no new
   endpoint, no extra API calls. Then a full re-sync to backfill history.
3. **RPC** — `plan_fees_collected_by_payment(p_org, p_since, p_until, p_practice)`:
   sum explanation amounts **dated in the window**, allocated to plan invoice
   lines pro-rata, returning cash and adjustment legs **separately**.
4. **Card** — date by payment, and show the two legs. "Collected" then means
   money received, and the difference from billed is visible rather than hidden.

Until step 4 ships, the card should say what it computes:
*"Plan fees billed 1–6 Sep, settled to date"*.

## 5. Risks and unknowns — resolve before building

- **Method vocabulary.** Which `method` values are cash receipts and which are
  adjustments must be enumerated from live data, not guessed. Getting this wrong
  silently reclassifies money. Blocking for step 3.
- **`/payments` page cap.** A probe returned 25 rows for `per_page=250`;
  `streamPages` uses 100. If the server caps below that we are already
  under-pulling payments, which would change every figure here. Verify first.
- **Volume.** One payment → N explanations. Sizing needs a live count before the
  table is created.
- **Re-sync cost.** Backfill is a full payments re-pull; `dentally-sync` has a
  known OOM on long backfills (see `dentally-sync-invoice-items-stall`) and
  Dentally rate-limits as HTTP 403, not 429 (`dentally-403-rate-limit`).
- **Verify the shape first.** `explanations[]` is documented as verified but not
  exercised in code. Step 0 is to pull one payment and confirm the field, before
  any migration is written.

## 6. What this does not fix

Practice attribution. "Treatments Completed" is stamped by the practitioner's
primary site (`restamp_treatment_item_practices`), "Treatments Closed" by
`invoice_items.practice_id`. For Rochester 1–6 Sep that moves £1,262.32 (12% of
that card) between practices. Separate issue, separate fix.
