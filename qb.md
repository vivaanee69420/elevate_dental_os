# QuickBooks Online Integration

Status doc for the QuickBooks (QBO) accounting integration. Built the OAuth +
P&L connector; the remaining page-wiring (Cashflow, Debt Recovery) is planned
below for tomorrow.

> **UPDATE — gaps closed (this session).** The connector now pulls FOUR things,
> not just the current-month P&L. `quickbooks-sync.js` `syncOneOrg` runs:
> 1. **ProfitAndLoss** -> `monthly_financials` — now **12-month backfill** on first
>    connect / full refresh (`!last_sync_at || full`); nightly cron stays
>    current-month only.
> 2. **BalanceSheet** cash/bank -> `bank_accounts` (`source='quickbooks'`) — real
>    Cashflow **opening balance**. Needed migration `000057` (adds
>    `bank_accounts.source` + `external_id` + `uq_bank_accts_src_ext`) — **applied
>    on hosted** (`mkfhpzjbijbachoonytt`).
> 3. **Invoice** (Balance>0) -> `invoices` (`source='quickbooks'`, default
>    practice) — **Debt Recovery** now shows QBO debtors. (The debt slice
>    repo/service/route/`DebtScreen` already existed reading `invoices`.)
> 4. **Payment** -> `payments` (`source='quickbooks'`, `status='settled'`) — feeds
>    the Cashflow weekly receipts (**option B**), **deduped** against existing
>    non-QBO settled receipts by date+amount to avoid double-counting Stripe.
>
> Secondary pulls (2-4) are best-effort (`safePull`) — a failure there never fails
> the P&L sync. `quickbooks` added to frontend `SYNCABLE` (manual Refresh button).
> 12 new unit tests; full backend suite 589/589 green. Env creds + Intuit redirect
> URI + live-company UAT remain the user's setup (sections 2 + 6).

Xero stays available as a **backup** accounting source — both providers write
`monthly_financials` keyed by `source`, so connecting one never clobbers the
other.

---

## 1. What is DONE (committed to working tree, not pushed)

Real OAuth2 connector + nightly P&L sync. Tests pass (328/328, +7 new).

| File | Change |
|---|---|
| `backend/src/lib/integrations/quickbooks-provider.js` | NEW — OAuth2: authorize / callback / refresh / revoke / sync. Captures `realmId` (company id) off the callback query. Rotating-refresh claim lock (mirrors Xero/GHL). |
| `backend/src/lib/integrations/quickbooks-sync.js` | NEW — pulls QBO **ProfitAndLoss** report, parses `Rows.Row` / `ColData`, buckets each account into `dental_bucket`, delete-then-insert into `monthly_financials` with `source='quickbooks'`. |
| `backend/src/lib/integrations/index.js` | register `quickbooks-provider` |
| `backend/src/lib/integrations/oauth-stub-providers.js` | removed the old `quickbooks` stub (avoid double-register) |
| `backend/src/services/integration.service.js` | `quickbooks` added to `ON_DEMAND_SYNCERS` (+ import) |
| `backend/src/controllers/integration.controller.js` | thread `realmId` through the public OAuth callback (QBO sends it; other providers only send code+state) |
| `backend/src/workers/index.js` | daily 02:30 cron `quickbooks_sync.syncAllOrgs()` |
| `backend/.env.example` + `backend/.env` | `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` / `QUICKBOOKS_API_BASE` |
| `backend/test/quickbooks-sync.test.mjs` | NEW — 7 tests (toPence, bucket mapping, report parse, syncOneOrg) |

**Verified:** 328/328 tests pass · `node --check` clean · provider registers
exactly once · accounting providers = `xero, quickbooks`.

**No DB / frontend code changes needed for what's done** — `integrations.provider`
is free text, `monthly_financials.source` + backend `SYNCED_SOURCES` + frontend
`MonthlyFinancialRow.source` already include `'quickbooks'`. The Integrations
page lists providers dynamically, so the QuickBooks **Connect** button already
works via the generic OAuth flow (`IntegrationsScreen.tsx:83` →
`startConnect` → `window.location = redirectUrl`).

---

## 2. Connect flow (already works once creds are set)

QBO Accounting API supports **OAuth 2.0 ONLY** — there is no static API
key / personal access token (unlike GHL/Dentally). So OAuth is the only proper
path; it is both the easy and the correct one. Do NOT build a token-paste path.

```
User clicks Connect (integrations page)
  -> POST /api/integrations/connect {provider:'quickbooks'}
  -> QuickBooksProvider.authorize() returns { redirectUrl }
  -> browser -> Intuit consent screen
  -> Intuit redirects -> GET /oauth/quickbooks/callback?code=&state=&realmId=
  -> verifyState -> finishConnect -> token exchange -> store tokens + realm_id
  -> first P&L sync fires (fire-and-forget)
  -> redirect -> /integrations?connected=quickbooks
```

### Env (`backend/.env`, gitignored)
```
QUICKBOOKS_CLIENT_ID=AB995...        # dev key pasted
QUICKBOOKS_CLIENT_SECRET=CmQSr...    # dev key pasted
QUICKBOOKS_API_BASE=https://sandbox-quickbooks.api.intuit.com   # sandbox for testing; clear/prod URL for live
```
Must be set on BOTH web and worker processes.

### Intuit app config (the redirect_uri error)
Error seen: *"The redirect_uri query parameter value is invalid."* — means the
URI my code sends is not registered EXACTLY in the Intuit app.

Code sends: `${BACKEND_PUBLIC_URL}/oauth/quickbooks/callback`
= `http://localhost:8080/oauth/quickbooks/callback`

Fix: developer.intuit.com → app → Keys & credentials → **Development** key set
(matches the dev Client ID) → Redirect URIs → add EXACTLY:
```
http://localhost:8080/oauth/quickbooks/callback
```
Gotchas: no trailing slash · `http` allowed only for localhost · port 8080 must
match · must be on the same key set as the Client ID in `.env`.

(For a real sandbox callback over a tunnel, set `BACKEND_PUBLIC_URL` to the
tunnel host and register that URI instead.)

---

## 3. Pages — what QuickBooks fills

QBO P&L → `monthly_financials` → shared analytics read path. These ~7 routes
auto-consume it (no per-page code), some partial:

- `profit` (P&L) · `financial` · finance-series feed · `valuation` ·
  `business-hub` (baseline) · `tax` + `corp-tax` · `scenarios`

NOT filled by P&L alone (the work for tomorrow):

- **`cashflow`** — reads `bank_accounts` (opening) + `payments` (weekly settled
  receipts via RPC `settled_receipts_by_day`). Never reads `monthly_financials`.
- **`debt`** (Debt Recovery) — 100% mock, no backend at all.

> Only the P&L is pulled so far. QBO BalanceSheet / CashFlow report /
> Invoices+AgedReceivables are NOT pulled yet (`quickbooks-sync.js:16-19`).

---

## 4. TOMORROW — Debt Recovery (greenfield, clean QBO win)

No AR data model exists anywhere (searched: debt/receivable/invoice/aging/
debtor → nothing; `lab_invoices` is supplier *payables*, not receivables).
Full new vertical slice.

### Source
QBO `GET /v3/company/{realmId}/reports/AgedReceivableDetail` (or
`query?query=SELECT * FROM Invoice WHERE Balance > '0'`). Gives per-customer
outstanding + days overdue.

### Frontend target
`frontend/features/intelligence/components/DebtScreen.tsx` currently imports
`DEBTORS` from `../data.ts:114`. Row shape (whole pounds):
```ts
interface Debtor { name: string; practice: string; tx: string; amount: number; age: number }  // age = days overdue
```
Component derives: total outstanding, 5 aged buckets (0-30/31-60/61-90/91-120/120+),
90+ KPI, sorted table. Two KPIs are **hard-coded literals with no source**:
"Active payment plans" (12 / £28k/mo) and "Recovered TTM" (£42k / 86%) —
leave static for now (note in UI) or hide; no QBO equivalent.

### Build chain (mirror the Payments slice as template)
1. **Migration** — new `receivables` table:
   `id, organisation_id, practice_id (nullable), source ('quickbooks'),
   pms_external_id (invoice/customer id), customer_name, amount_pence,
   due_date, days_overdue (or compute), status, created_at, updated_at`.
   Unique `(organisation_id, source, pms_external_id)`. RLS enabled.
   Run `NOTIFY pgrst, 'reload schema';` after hosted DDL.
2. **quickbooks-sync.js** — add `pullReceivables(orgId)` → fetch AgedReceivable/
   Invoice → map → delete-then-insert `source='quickbooks'` (same pattern as P&L).
   Call it from `syncOneOrg` alongside the P&L pull.
3. **repository** `receivable.repository.js` — `listByOrg(orgId, {practiceId})`,
   manual `.eq('organisation_id', orgId)` (CLAUDE rule 3). Use an RPC if it can
   exceed the 1000-row cap.
4. **service** `debt.service.js` (or `receivable.service.js`) — list + aged-bucket
   aggregation (so the bucket math can move server-side, or keep client-side).
5. **controller + route** — `GET /api/debt` (or `/api/receivables`), Zod query
   schema, `requirePermission('finance.view')`. Mount in `app.js`.
6. **frontend** `intelligence/api.ts` + `hooks.ts` — `getDebtors()` / `useDebtors()`
   through the `/api/backend` proxy; convert pence→pounds at boundary.
7. Swap the `DEBTORS` import in `DebtScreen.tsx` for the hook; handle loading/empty.
8. Update `docs/API.md` (new endpoint).
9. Test: parse + aged-bucketing unit tests.

---

## 5. TOMORROW — Cashflow (DECISION PENDING — needs user input)

Cashflow is already real: opening balance = Σ `bank_accounts.balance_pence`;
13 weekly buckets = settled `payments` per week (`status='settled'`, RPC
`settled_receipts_by_day`). Inflow-only running balance; `paymentsPence`
always 0; `basis` always `'actuals'`. Designed for a TrueLayer bank feed.

QBO P&L does NOT feed this. Three options (un-decided — ASK USER):

- **A. Opening balance only (recommended)** — pull QBO BalanceSheet cash/bank
  balances → `bank_accounts.balance_pence`. Real opening + `bankConnected=true`.
  Weekly receipts stay from `payments`. Safe, no double-count, modest value.
- **B. Full: push QBO receipts too** — also pull QBO invoice payments into the
  weekly receipts view. Richer, but RISK of double-counting Stripe `payments`
  for the same income → needs source/dedupe logic.
- **C. Skip cashflow** — leave it to the TrueLayer bank feed it was designed
  for; don't wire QBO. Build Debt only.

User wanted to clarify this fork before choosing — resolve first thing.

---

## 6. UAT — verify against a live/sandbox company (Intuit docs are JS-rendered;
built from known QBO API shapes)

- P&L report JSON shape (`Rows.Row` + `Header.ColData` / `ColData` / `Summary`)
  matches `parseReportRows` — confirm on a real company.
- `minorversion=65`; base `quickbooks.api.intuit.com` (sandbox override via
  `QUICKBOOKS_API_BASE`).
- Bucket mapping is heuristic; COGS lines (lab/materials) classify by **account
  name**, not section. Owners can override via `xero_account_map` (reused,
  account-code → bucket).
- Access token ~1h (auto-refresh at <60s to expiry); refresh token ~100d,
  rotates (new refresh_token persisted each refresh).

---

## 7. Quick TODO checklist for tomorrow

- [ ] Register redirect URI in Intuit app → confirm Connect completes end-to-end (sandbox).
- [ ] Confirm P&L lands in `monthly_financials` (source=quickbooks) → profit/financial pages show real numbers.
- [ ] DECIDE cashflow option A / B / C.
- [ ] Build Debt Recovery slice (migration → sync → repo → service → route → frontend → swap mock).
- [ ] (if A/B) Add QBO BalanceSheet pull → bank_accounts.
- [ ] Update `docs/API.md`; keep tests green; `NOTIFY pgrst` after hosted DDL.
