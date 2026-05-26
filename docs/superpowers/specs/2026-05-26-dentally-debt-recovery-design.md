# Dentally → Debt Recovery: design

Date: 2026-05-26
Status: approved-pending-review
Branch context: feat/operations-chair-util-associates (debt work to land per branch model)

## Problem

The Debt Recovery page (`frontend/app/(dashboard)/debt/page.tsx` →
`frontend/features/intelligence/components/DebtScreen.tsx`) is 100% mock: a
hardcoded `DEBTORS` array in `frontend/features/intelligence/data.ts`. There is
no backend endpoint and no real data source. We want it driven by real Dentally
data.

## Data source decision

Dentally exposes patient financials through endpoints our connector does **not**
currently pull:

- `GET /v1/invoices` — `id`, `patient_id`, `site_id`, `account_id`, `amount`,
  `amount_outstanding`, `dated_on`, `due_on`, `paid`, `paid_on`, `reference`,
  `invoice_items[]` (treatment + practitioner). Filters: `patient_id`,
  `site_id`, `dated_on_after/before`, `updated_after`; paginated.
- `GET /v1/accounts` — `current_balance`, `amount_outstanding` per patient, but
  **no per-item dates** → cannot be aged.

The Debt Recovery page needs aged bands (0-30 / 31-60 / 61-90 / 91-120 / 120+
days), which require per-invoice dates. Therefore **invoices** are the feed, not
accounts. Unpaid invoices (`amount_outstanding > 0`) are the debtors.

Rejected alternatives:
- **Balance on `contacts` from `/accounts`** — no dates, cannot build bands.
- **Hybrid (invoices + accounts headline)** — marginal value, more work; YAGNI.

## Architecture

Four units, each independently testable:

### 1. Migration — `invoices` table

New table `supabase/migrations/20260101000025_invoices.sql` (next ledger
number; verify it is unused at implementation time). Mirror the conventions of
`payments` (migration `…000001` + `…000014` source/external_id additions):

| column                    | type        | notes                                              |
|---------------------------|-------------|----------------------------------------------------|
| id                        | uuid PK     | `gen_random_uuid()`                                |
| organisation_id           | uuid NOT NULL FK | tenant isolation                              |
| practice_id               | uuid NOT NULL FK | resolved from `site_id` via practices map     |
| contact_id                | uuid FK NULL | resolved from `patient_id`; null if unlinked      |
| source                    | text NOT NULL DEFAULT 'dentally' |                               |
| external_id               | text        | Dentally invoice id                                |
| amount_pence              | integer NOT NULL DEFAULT 0 |                                     |
| amount_outstanding_pence  | integer NOT NULL DEFAULT 0 | the debt figure                     |
| dated_on                  | date        | invoice date                                       |
| due_on                    | date        | payment due date (null → fall back to dated_on)    |
| paid                      | boolean DEFAULT false |                                          |
| treatment                 | text        | summarised from `invoice_items` (first item name, or "Multiple items") |
| patient_name              | text        | fallback display name when contact_id is null      |
| created_at, updated_at    | timestamptz DEFAULT now() |                                       |

- Unique index `uq_invoices_src_ext (organisation_id, source, external_id)` —
  idempotent upsert arbiter, matching `uq_payments_src_ext`.
- RLS policy + the explicit-`organisation_id`-filter convention (repos use
  `serviceClient`; isolation is manual — see CLAUDE.md "Reality vs intent").
- Keep `db/01_schema.sql` in sync (unmanaged source copy).
- Idempotent (`create table if not exists`, `create index if not exists`).
- After hosted apply: `NOTIFY pgrst, 'reload schema';`.

`invoices` is for **patient** invoices and is distinct from the existing
`lab_invoices` table (lab-supplier bills). Do not conflate.

### 2. Connector — extend `backend/src/lib/integrations/dentally-sync.js`

- `invoiceRow(orgId, inv, siteMap, contactMap)` — pure row builder, same shape
  as `paymentRow`. Returns null when `site_id` maps to no practice (practice_id
  is NOT NULL). Money via the existing `toPence()` helper.
  - `treatment`: derive from `inv.invoice_items` — first item's treatment/name,
    or "Multiple items" when >1, or null.
  - `patient_name`: from invoice if present, else null.
- `pullInvoices(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages)`
  — paginate `/invoices`, map, `upsertChunked('invoices', rows,
  'organisation_id,source,external_id')`. Mirror `pullPayments`.
- Wire into `syncOneOrg`: add `'invoices'` as a 4th progress phase (extend
  `PHASES`, `fetchPageCount`, `phaseTotals`, `reporter(3)`). Use the same window
  params as payments (`{ updated_since: since }` → Dentally `updated_after`;
  confirm the exact param name during UAT — payments use `updated_since`, the
  connector's existing convention).
- Wire into `bootstrapOnConnect`: invoices come along automatically via
  `syncOneOrg` (no separate call needed).
- Wire into `applyWebhookEvent`: handle `resourceType === 'invoice'` →
  `invoiceRow` → upsert.
- Add `invoiceRow`/`pullInvoices` internals to the `__test` export as needed.

**UAT caveat (carry the file's existing convention):** Dentally money
units are ambiguous (docs say invoice `amount` is "integer"; the payments path
treats `amount` as pounds-decimal via `toPence` ×100). Use `toPence()` for
consistency and add a code comment flagging pence-vs-pounds for sandbox
verification, exactly as the existing mappers do.

### 3. Backend slice — `GET /api/debt`

Standard layering: route → controller → service → repository.

- **route** `backend/src/routes/debt.routes.js` — `router.get('/', asyncHandler(debtController.list))`.
  Mount in `app.js` at `/api/debt`, **behind the existing `authenticate` + `audit`**
  (no `requireRole`) — matching `payments.routes.js`, which has no route-level
  role gate. Finance/Reception visibility is enforced at the frontend nav layer
  (unchanged).
- **model** `backend/src/models/debt.model.js` — Zod `DebtListQuerySchema`
  (`practice?` uuid, optional `band?` enum).
- **controller** `backend/src/controllers/debt.controller.js` — validate query,
  pass `req.user.organisation_id`, shape HTTP response. No logic.
- **service** `backend/src/services/debt.service.js` — fetch unpaid invoices,
  compute `age_days = today − (due_on ?? dated_on)` (clamped ≥ 0; not-yet-due =
  0 / current), assign band, aggregate KPIs. Returns:
  ```
  {
    outstanding_pence,        // Σ amount_outstanding_pence
    overdue90_pence,          // Σ where age_days ≥ 91
    bands: [{ key, label, count, total_pence }, …],  // 0-30,31-60,61-90,91-120,120+
    debtors: [{ name, practice, treatment, amount_pence, age_days }]  // sorted age desc
  }
  ```
  `name` = contact full name, else `patient_name`, else "Unknown patient".
  `practice` = practices.name via practice_id.
- **repository** `backend/src/repositories/debt.repository.js` — `serviceClient`
  with explicit `.eq('organisation_id', orgId)` (mandatory — no auto isolation
  on the service-client path), `.gt('amount_outstanding_pence', 0)`, optional
  `.eq('practice_id', …)`. Join/resolve contacts + practices names.

Money is integer pence throughout (rule 2). No new formula → no `FORMULAS.md`
change (aging is date arithmetic, not a financial formula). Add a unit test for
`debt.service` band/aging logic and a cross-org isolation test (per existing
test conventions). Update `docs/API.md` with the new endpoint.

### 4. Frontend — wire `DebtScreen`

- Replace the `DEBTORS` mock import with a React Query fetch to
  `/api/backend/debt` (the tenant proxy that injects the Bearer token).
- Keep the existing UI exactly; the endpoint returns aggregates so the component
  can render KPIs/bands/table directly (or keep its current client-side
  band computation off `debtors[]` — implementer's choice, but server values are
  authoritative for KPIs).
- Loading / empty / error states (no mock fallback).
- Money displayed `(pence/100).toLocaleString('en-GB')` (rule 2); British
  English (rule 4).
- Leave the `DEBTORS` constant + `Debtor` type removal to the implementer once
  no other module imports them (verify).

## Data flow

```
Dentally /v1/invoices
  → pullInvoices (paginate) → invoiceRow (map, resolve practice+contact)
  → upsert invoices table (idempotent on org+source+external_id)
  ⇄ webhook: applyWebhookEvent('invoice', record) → same invoiceRow → upsert
GET /api/debt
  → debt.repository (unpaid invoices, org-scoped, +practice filter)
  → debt.service (age, band, aggregate)
  → debt.controller (HTTP shape)
  → frontend /api/backend/debt proxy → DebtScreen (React Query)
```

## Error handling

- Connector: one bad invoice row never drops a chunk (existing `upsertChunked`
  row-by-row retry). Unmatched practice → row skipped (counted), as with
  payments.
- Endpoint: missing/invalid query → 400 via Zod. DB error → 500 via async
  handler. Empty result → `{ outstanding_pence: 0, debtors: [] }`, not an error.
- Frontend: explicit empty + error states.

## Testing

- `debt.service` unit: aging math (due_on vs dated_on fallback, not-yet-due = 0),
  band assignment boundaries (30/60/90/120), KPI sums, name fallback chain.
- `invoiceRow` unit: practice/contact resolution, null-practice skip, treatment
  summarisation, `toPence`.
- Cross-org isolation test for `GET /api/debt` (mirrors existing isolation tests).
- Connector pull is covered by the existing fetch/paginate harness pattern.

## Out of scope (YAGNI)

- `/v1/accounts` balance reconciliation.
- Invoice line-item drill-down UI.
- Debt-chase actions/automation (the table "Action" column stays presentational
  for now).
- Backfilling historical invoices beyond the existing bootstrap/full-history
  windows (they ride the same windows as payments).
