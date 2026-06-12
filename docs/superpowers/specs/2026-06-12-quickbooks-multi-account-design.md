# QuickBooks Multi-Account — Design Spec

Date: 2026-06-12
Status: Approved (design), pending implementation

## Goal

Let one organisation connect **N QuickBooks Online companies** (today only one is
possible). Each company is an independent entity (no practice mapping — same
treatment as Dentally and the current GHL direction). Surface every company's
data in:

1. A new **QuickBooks dashboard in the Finance section** with Dentally-style
   filters (company selector + period / date range).
2. **Group Overview** cards (per-company + summed).
3. **Business Hub** finance cards (QB summed across all companies).

## Decisions (locked)

- **No practice mapping.** A QB company is an individual entity under the org.
  Filters key off the company (realmId / `integration_account_id`), not practice.
- **Reconnect fresh.** The existing single `integrations` QB connection is NOT
  migrated; owner reconnects each company through the new multi-account flow.
- Mirror the existing **GHL `integration_accounts`** multi-account pattern for
  storage/management, and the **Dentally dashboard** for the Finance UI.

## Data model

Reuse the generic `integration_accounts` table (migration `000085`). One row per
QB company:

| column | value |
|---|---|
| `provider` | `'quickbooks'` |
| `external_account_id` | QBO `realmId` (company id) |
| `secrets` | encrypted `{access_token, refresh_token}` (rotating refresh) |
| `config` | `{ realm_id, company_name, scope, token_type }` |
| `status` | `active` \| `failed` \| `revoked` \| `pending` |
| `practice_id` | always NULL for QB (no mapping) |
| `last_sync_at`, `last_error` | sync bookkeeping |

The gohighlevel-only partial unique index on `(org, practice_id)` leaves QB
unconstrained on practice — correct.

The single `integrations` `'quickbooks'` row stays a lightweight **connected
marker** for `integration-gating.js` (mirrors GHL).

### Account attribution on data tables

Add nullable `integration_account_id uuid references integration_accounts(id) on
delete cascade` to:

- `monthly_financials` (P&L buckets)
- `bank_accounts` (cash/balance sheet)
- `invoices` (receivables)
- `payments` (receipts)

QB sync stamps it on every row. Non-QB rows leave it NULL (back-compat).

**Collision fix.** Two companies can produce the same `period` + `account_code`
+ `source='quickbooks'`. Fold `integration_account_id` into the relevant unique
keys so they don't collide:

- `monthly_financials`: new unique index on
  `(organisation_id, period, account_code, COALESCE(integration_account_id, zero-uuid), source)`.
  (Keep the old index for non-QB rows, or replace with one that COALESCEs both
  practice_id and integration_account_id.)
- `bank_accounts`, `invoices`, `payments`: QB rows already namespaced by
  `(org, source, external_id)`; external_id is per-company-unique only if realmId
  is folded in. Sync uses **delete-then-insert scoped per `integration_account_id`**,
  so the delete must add `.eq('integration_account_id', accountId)` — company A's
  sync never wipes company B.

Index for filtering: `idx_*_org_account on (organisation_id, integration_account_id)`.

`notify pgrst, 'reload schema';` at the end.

Migration: `supabase/migrations/20260101000086_quickbooks_multi_account.sql`.

## Backend

### OAuth — per company

`quickbooks-provider.js`:

- `authorize(orgId)` — unchanged signed-state redirect to Intuit. (Owner clicks
  "Connect a QuickBooks company".)
- `callback(orgId, {code, realmId})` — exchange code, fetch `CompanyInfo` for the
  display name, then **upsert an `integration_accounts` row keyed by realmId**
  (encrypted token, `config.realm_id`, `config.company_name`). Also upsert the
  `integrations` marker row to `active`. Kick a first full sync for that account.
- `refresh(orgId, accountId)` — rotating single-use refresh **per account row**.
  Add a per-account claim (config flag / optimistic update) on
  `integration-account.repository.js`, analogous to `claimRefresh` on
  `integration.repository.js`.

### Sync — per company

`quickbooks-sync.js`:

- `syncAccount(orgId, account, onProgress, opts)` — the current `syncOneOrg`
  body, but realmId/token come from the account row and **every write carries
  `integration_account_id = account.id`**; every delete-then-insert adds
  `.eq('integration_account_id', account.id)`.
- `syncAllAccounts(orgId)` — fan out over `integration_accounts`
  (`provider='quickbooks'`, `status='active'`).
- `invoices.practice_id` / `payments.practice_id` are NOT NULL — keep the
  existing `defaultPracticeId(orgId)` best-effort fallback (data still attributes
  to the company via `integration_account_id`; practice is incidental).
- Worker `syncAllOrgs` → iterate accounts instead of `integrations` rows.

### Management service + routes

`services/quickbooks-account.service.js` (owner-only), mirroring
`ghl-account.service.js`:

- `listAccounts(orgId)` — companies with name, realmId, status, last_sync, last_error.
- `connect(orgId)` — returns the OAuth `redirectUrl` (delegates to provider authorize).
- `syncAccount(orgId, id)` — trigger a sync for one company.
- `removeAccount(orgId, id)` — revoke + purge that company's rows
  (`monthly_financials`/`bank_accounts`/`invoices`/`payments` where
  `integration_account_id = id`); flip status `revoked`.

Routes under `/api/integrations/quickbooks/accounts` (all `requireRole('owner')`):

- `GET /` list
- `POST /connect` → `{redirectUrl}`
- `POST /:id/sync`
- `DELETE /:id`

OAuth callback stays public at `/oauth/quickbooks/callback`.

### Finance dashboard API

`GET /api/finance/quickbooks` (finance.view gated). Query:
`accountId` (omitted = all companies summed), `period=YYYY-MM` OR
`from`/`to` date range.

Returns (all `_pence`):
- `summary`: `revenuePence`, `expensesPence`, `netProfitPence`, `netMarginPct`,
  `cashAtBankPence`, `receivablesPence`, `receiptsPence`.
- `byBucket`: P&L bucket totals (revenue/staff/lab/materials/overhead/tax/other).
- `trend`: monthly revenue/expense/profit series.
- `companies`: per-company breakdown rows (for "All" view).
- `accounts`: the company list for the selector.

Repository methods read `monthly_financials` / `bank_accounts` / `invoices` /
`payments` scoped by `organisation_id` + `source='quickbooks'`
(+ optional `integration_account_id`) + period window.

## Frontend

### Integrations panel

QuickBooks tile becomes a **multi-company manager** (mirror `GoHighLevelPanel`):
- "Connect a QuickBooks company" → calls `/connect`, redirects to Intuit.
- List of connected companies: name, realmId, status, last sync.
- Per-company: Sync now / Disconnect.

### Finance → QuickBooks dashboard (new page)

Dentally-style. Filters: company selector (All companies / specific) + period /
date-range bar. Cards:
- Revenue, Expenses, Net Profit, Net Margin
- Cash at Bank, Outstanding Receivables, Receipts Collected

Plus: P&L-by-bucket breakdown, monthly trend chart (recharts), per-company table
(All view). British English, £ pence integers, light theme only.

### Group Overview

Add QB cards: per-company + summed Revenue, Net Profit, Cash at Bank,
Outstanding Receivables.

### Business Hub

Existing finance cards already aggregate `monthly_financials` by org + source —
QB rows from all companies sum automatically. Verify the source filter includes
`quickbooks` and that the new `integration_account_id` column doesn't break the
existing group-by. No per-company split here (group-level rollup).

## Phasing

1. Migration + backend multi-account connect / sync / management routes.
2. Finance QB dashboard (API + page).
3. Group Overview cards + Business Hub rollup verification.

## Out of scope / YAGNI

- Practice mapping for QB (explicitly excluded).
- QBO webhooks (sync is the poll path; unchanged).
- Migrating the existing single connection (reconnect fresh).
- Per-company P&L bucket re-mapping UI (reuse shared `xero_account_map` + heuristic).

## Testing

- Unit: `syncAccount` stamps `integration_account_id`; per-account delete scope;
  two-company isolation (company A sync doesn't touch company B rows).
- Existing QB sync unit tests (`__test` helpers) stay green.
- Finance API: summed vs per-account shapes.
- Cross-org isolation preserved (every query carries `organisation_id`).
