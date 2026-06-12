# QuickBooks Multi-Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one org connect N QuickBooks companies (each an independent entity, no practice mapping), surface each in a Finance QB dashboard + Group Overview, and sum QB across all companies in Business Hub.

**Architecture:** Reuse the generic `integration_accounts` table (one row per QB company, keyed by realmId). Add `integration_account_id` to the four QB data tables for per-company attribution. OAuth callback creates account rows; sync threads the account id into every write and scopes deletes per account. New owner-only management routes + a finance read API + frontend panel/dashboard.

**Tech Stack:** Express (native ESM) + Supabase (serviceClient + manual org filters), Next.js 14 App Router, React Query, recharts, vitest.

---

## File Structure

**Backend — create:**
- `supabase/migrations/20260101000086_quickbooks_multi_account.sql`
- `backend/src/services/quickbooks-account.service.js`
- `backend/src/services/finance-quickbooks.service.js`
- `backend/src/repositories/quickbooks-finance.repository.js`
- `backend/src/routes/finance-quickbooks.routes.js`
- `backend/src/controllers/finance-quickbooks.controller.js`
- `backend/test/quickbooks-account.test.mjs`

**Backend — modify:**
- `backend/src/lib/integrations/quickbooks-provider.js` (callback → account row; per-account refresh)
- `backend/src/lib/integrations/quickbooks-sync.js` (`syncAccount` + `syncAllAccounts`, account-scoped writes)
- `backend/src/repositories/integration-account.repository.js` (QB upsert-by-realm + per-account refresh claim)
- `backend/src/controllers/integration.controller.js` (qb account ctrl methods)
- `backend/src/routes/integrations.routes.js` (qb account routes)
- `backend/src/workers/index.js` (cron fan-out over QB accounts)
- `backend/src/app.js` (mount finance-quickbooks routes)
- `backend/src/models/integration.model.js` (qb connect schema if needed)

**Frontend — create:**
- `frontend/features/finance/quickbooks-api.ts`
- `frontend/features/finance/components/QuickBooksScreen.tsx`
- `frontend/app/(dashboard)/finance/quickbooks/page.tsx`

**Frontend — modify:**
- `frontend/features/integrations/api.ts` (qb account client)
- `frontend/features/system/components/IntegrationsScreen.tsx` (QuickBooks multi-company panel)
- `frontend/features/overview/components/GroupPerformanceScreen.tsx` (QB cards) + `business-hub-api.ts`
- Finance nav (sidebar) to add the QuickBooks link

---

## Task 1: Migration — account attribution columns

**Files:**
- Create: `supabase/migrations/20260101000086_quickbooks_multi_account.sql`

- [ ] **Step 1: Write the migration**

```sql
-- QuickBooks multi-account: N companies per org via integration_accounts
-- (provider='quickbooks', external_account_id=realmId, no practice mapping).
-- Adds per-company attribution to the four QB data tables.
-- Idempotent.

ALTER TABLE monthly_financials ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE;
ALTER TABLE bank_accounts      ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE;
ALTER TABLE invoices           ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE;
ALTER TABLE payments           ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE CASCADE;

-- monthly_financials: fold account id into the conflict key so two QB companies
-- with the same period+account_code don't collide. Replaces the old index.
DROP INDEX IF EXISTS uq_monthly_financials;
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_financials
  ON monthly_financials (
    organisation_id, period, account_code,
    COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(integration_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source
  );

-- bank_accounts/invoices keep (org, source, external_id) but external_id is only
-- per-company-unique once realmId is folded in; sync writes external_id as
-- "<realmId>:<entityId>". No unique-index change needed (NULLs distinct), but add
-- filter indexes.
CREATE INDEX IF NOT EXISTS idx_monthly_financials_org_account ON monthly_financials (organisation_id, integration_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_org_account      ON bank_accounts (organisation_id, integration_account_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_account           ON invoices (organisation_id, integration_account_id);
CREATE INDEX IF NOT EXISTS idx_payments_org_account           ON payments (organisation_id, integration_account_id);

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply locally** — `supabase db reset` from repo root; verify columns exist.
- [ ] **Step 3: Commit** — `git add supabase/migrations && git commit -m "feat(quickbooks): migration 000086 account attribution columns"`

---

## Task 2: integration-account repository — QB realm upsert + refresh claim

**Files:**
- Modify: `backend/src/repositories/integration-account.repository.js`

- [ ] **Step 1: Add methods** (after `getByLocation`, reusing existing patterns):

```javascript
// Upsert a QB company row by realmId (external_account_id). Returns the row id.
async upsertByExternalId(orgId, provider, externalId, fields) {
    const existing = await this.getByLocation(orgId, provider, externalId);
    if (existing) {
        await this.update(orgId, existing.id, fields);
        return existing.id;
    }
    const row = await this.insert(orgId, { provider, external_account_id: String(externalId), ...fields });
    return row.id;
},

// Per-account rotating-refresh claim (optimistic): set config.refreshing=true only
// if not already set. Mirrors integration.repository.claimRefresh semantics.
async claimRefresh(orgId, id) {
    const row = await this.getByIdWithSecrets(orgId, id);
    if (!row || row.config?.refreshing) return false;
    await this.mergeConfig(orgId, id, { refreshing: true });
    return true;
},
async clearRefresh(orgId, id) {
    await this.mergeConfig(orgId, id, { refreshing: false });
},
```

- [ ] **Step 2: Syntax check** — `cd backend && node --check src/repositories/integration-account.repository.js`
- [ ] **Step 3: Commit** — `feat(quickbooks): integration-account repo realm upsert + refresh claim`

---

## Task 3: Provider — OAuth callback creates a QB company account

**Files:**
- Modify: `backend/src/lib/integrations/quickbooks-provider.js`

**Key change:** `callback` and `refresh` operate on `integration_accounts` rows
(keyed by realmId), not the single `integrations` secrets row. Keep the
`integrations` row as a connected marker (`upsert status:'active'`).

- [ ] **Step 1: Replace `persistTokenResponse`** to write an account row:

```javascript
import { integrationAccountRepository } from '../../repositories/integration-account.repository.js';

async function fetchCompanyName(realmId, accessToken) {
    try {
        const base = process.env.QUICKBOOKS_API_BASE || 'https://quickbooks.api.intuit.com';
        const res = await fetch(`${base}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.CompanyInfo?.CompanyName ?? null;
    } catch { return null; }
}

async function persistAccount(orgId, body, realmId, companyName) {
    const secrets = encryptSecret(JSON.stringify({
        access_token: body.access_token, refresh_token: body.refresh_token,
    }));
    const accountId = await integrationAccountRepository.upsertByExternalId(orgId, 'quickbooks', realmId, {
        label: companyName || 'QuickBooks',
        secrets,
        status: 'active',
        config: {
            realm_id: realmId, company_name: companyName,
            token_type: body.token_type, scope: body.scope,
            expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
            refreshing: false,
        },
    });
    // keep the integrations row as a connected marker (gating)
    await integrationsRepository.upsert(orgId, 'quickbooks', { status: 'active' });
    return accountId;
}
```

- [ ] **Step 2: Rewrite `callback`** to fetch company name then `persistAccount`, then kick a first sync for that account:

```javascript
async callback(orgId, { code, realmId }) {
    // ...exchange code (unchanged)...
    if (!realmId) throw new Error('QuickBooks callback missing realmId (company id)');
    const companyName = await fetchCompanyName(realmId, body.access_token);
    const accountId = await persistAccount(orgId, body, realmId, companyName);
    const { syncAccount } = await import('./quickbooks-sync.js');
    syncAccount(orgId, accountId, () => {}, { full: true })
        .catch((e) => console.error('[quickbooks] first sync failed:', e?.message || e));
    return { ok: true, accountId };
},
```

- [ ] **Step 3: Rewrite `refresh(orgId, accountId)`** to claim/refresh the account row (rotating token), persist back via `persistAccount`.
- [ ] **Step 4:** `sync(orgId)` → `const { syncAllAccounts } = await import('./quickbooks-sync.js'); return syncAllAccounts(orgId);`
- [ ] **Step 5: Syntax check** — `node --check src/lib/integrations/quickbooks-provider.js`
- [ ] **Step 6: Commit** — `feat(quickbooks): OAuth callback creates per-company account row`

---

## Task 4: Sync — per-company `syncAccount` + `syncAllAccounts`

**Files:**
- Modify: `backend/src/lib/integrations/quickbooks-sync.js`

**Changes:**
- New `ensureAccountToken(orgId, account)` — refresh per account row when near expiry (`config.expires_at`), via `QuickBooksProvider.refresh(orgId, account.id)`; reload the account.
- All four pull functions take `accountId` and:
  - stamp `integration_account_id: accountId` on every inserted row;
  - write `external_id` as `${realmId}:${entityId}` (bank/invoice/payment) so two companies don't collide on `(org, source, external_id)`;
  - scope deletes with `.eq('integration_account_id', accountId)`.
- `loadSettledKeys` dedupe stays org-wide (cross-company receipt dedupe is acceptable; keep `.neq('source','quickbooks')`).

- [ ] **Step 1:** Add `syncAccount(orgId, accountId, onProgress, opts)`:

```javascript
export async function syncAccount(orgId, accountId, onProgress, opts = {}) {
    const account = await integrationAccountRepository.getByIdWithSecrets(orgId, accountId);
    if (!account?.secrets) { return { error: 'no_auth' }; }
    try {
        const fresh = await ensureAccountToken(orgId, account);
        const realmId = fresh.config?.realm_id;
        if (!realmId) throw new Error('no QuickBooks company (realmId) on account');
        const { access_token } = JSON.parse(decryptSecret(fresh.secrets));
        const months = opts.months ?? ((opts.full || !fresh.last_sync_at) ? BACKFILL_MONTHS : 1);
        const accountMap = await loadAccountMap(orgId);
        onProgress?.({ pct: 10, phase: 'profit_and_loss' });
        const lines = await pullProfitAndLoss(orgId, accountId, realmId, access_token, accountMap, months);
        const practiceId = await defaultPracticeId(orgId);
        onProgress?.({ pct: 55, phase: 'balance_sheet' });
        const banks = await safePull(() => pullBalanceSheet(orgId, accountId, realmId, access_token), 'balance_sheet');
        onProgress?.({ pct: 70, phase: 'receivables' });
        const receivables = await safePull(() => pullReceivables(orgId, accountId, realmId, access_token, practiceId), 'receivables');
        onProgress?.({ pct: 85, phase: 'receipts' });
        const receipts = await safePull(() => pullReceipts(orgId, accountId, realmId, access_token, practiceId, months), 'receipts');
        await integrationAccountRepository.markSynced(orgId, accountId);
        return { lines, months, banks, receivables, receipts };
    } catch (err) {
        await integrationAccountRepository.markFailed(orgId, accountId, String(err.message).slice(0, 500));
        throw err;
    }
}

export async function syncAllAccounts(orgId) {
    const accounts = await integrationAccountRepository.list(orgId, 'quickbooks');
    const out = [];
    for (const a of accounts.filter((x) => x.status === 'active')) {
        try { out.push({ accountId: a.id, ...(await syncAccount(orgId, a.id)) }); }
        catch (e) { out.push({ accountId: a.id, error: e.message }); }
    }
    return out;
}
```

- [ ] **Step 2:** Update each `pull*` signature + writes (account id stamp, prefixed external_id, scoped delete). Keep the old `syncOneOrg`/`syncAllOrgs` exports but mark them deprecated (or remove — provider no longer calls them).
- [ ] **Step 3:** Update `backend/src/workers/index.js` QB cron to `syncAllAccounts` per org (iterate orgs that have ≥1 active QB account).
- [ ] **Step 4: Test** — extend `backend/test/quickbooks-sync.test.mjs`: a `syncAccount` run stamps `integration_account_id`; company A delete scope doesn't touch company B rows (use stubbed client). Run `npx vitest run test/quickbooks-sync.test.mjs`.
- [ ] **Step 5: Commit** — `feat(quickbooks): per-company syncAccount with account-scoped writes`

---

## Task 5: Management service + routes + controller

**Files:**
- Create: `backend/src/services/quickbooks-account.service.js`
- Modify: `backend/src/controllers/integration.controller.js`, `backend/src/routes/integrations.routes.js`

- [ ] **Step 1:** `quickbooks-account.service.js` — `listAccounts` (decorate from `config`), `connect` (delegates to `QuickBooksProvider.authorize` → `{redirectUrl}`), `syncAccount` (re-export sync), `removeAccount` (markRevoked + purge `monthly_financials`/`bank_accounts`/`invoices`/`payments` where `integration_account_id=id`).
- [ ] **Step 2:** Controller methods `qbAccountsList`, `qbAccountConnect`, `qbAccountSync`, `qbAccountRemove` (mirror the GHL ones).
- [ ] **Step 3:** Routes (static, BEFORE `/:provider/...` and `/:id`):

```javascript
router.get('/quickbooks/accounts', requireRole('owner'), asyncHandler(integrationController.qbAccountsList));
router.post('/quickbooks/accounts/connect', requireRole('owner'), asyncHandler(integrationController.qbAccountConnect));
router.post('/quickbooks/accounts/:id/sync', requireRole('owner'), asyncHandler(integrationController.qbAccountSync));
router.delete('/quickbooks/accounts/:id', requireRole('owner'), asyncHandler(integrationController.qbAccountRemove));
```

- [ ] **Step 4: Test** — `backend/test/quickbooks-account.test.mjs`: list/connect/remove happy paths + cross-org isolation.
- [ ] **Step 5: Commit** — `feat(quickbooks): owner-only multi-company management routes`

---

## Task 6: Finance QB read API

**Files:**
- Create: `backend/src/repositories/quickbooks-finance.repository.js`, `backend/src/services/finance-quickbooks.service.js`, `backend/src/controllers/finance-quickbooks.controller.js`, `backend/src/routes/finance-quickbooks.routes.js`
- Modify: `backend/src/app.js` (mount under `/api/finance/quickbooks`)

- [ ] **Step 1:** Repository reads (all org + `source='quickbooks'`, optional `integration_account_id`, period/date window): P&L buckets from `monthly_financials`; cash from `bank_accounts`; receivables sum from `invoices` (unpaid); receipts sum from `payments` (settled). Plus per-company group-by + monthly trend.
- [ ] **Step 2:** Service shapes `{ summary, byBucket, trend, companies, accounts }` (pence ints; netMarginPct from revenue/expenses).
- [ ] **Step 3:** Controller `overview(req,res)` parses `accountId?`, `period?`, `from?`, `to?`. Route gated `requirePermission('finance.view')`. Mount in app.js.
- [ ] **Step 4: Test** — summed vs per-account shape; org isolation.
- [ ] **Step 5: Commit** — `feat(quickbooks): finance dashboard read API`

---

## Task 7: Frontend — integrations multi-company panel

**Files:**
- Modify: `frontend/features/integrations/api.ts`, `frontend/features/system/components/IntegrationsScreen.tsx`

- [ ] **Step 1:** API client: `listQbAccounts()`, `connectQbAccount()` (→ redirect to `redirectUrl`), `syncQbAccount(id)`, `removeQbAccount(id)` (via `/api/backend/...` proxy).
- [ ] **Step 2:** QuickBooks tile → panel: "Connect a QuickBooks company" button, company list (name, realmId, status, last sync), per-row Sync/Disconnect. Mirror `GoHighLevelPanel`. British English, light theme.
- [ ] **Step 3: Verify** — `cd frontend && npm run typecheck && npm run lint`.
- [ ] **Step 4: Commit** — `feat(quickbooks): multi-company integrations panel`

---

## Task 8: Frontend — Finance QuickBooks dashboard

**Files:**
- Create: `frontend/features/finance/quickbooks-api.ts`, `frontend/features/finance/components/QuickBooksScreen.tsx`, `frontend/app/(dashboard)/finance/quickbooks/page.tsx`
- Modify: finance sidebar nav

- [ ] **Step 1:** `quickbooks-api.ts` — typed `getQuickBooksOverview({accountId?, period?, from?, to?})`.
- [ ] **Step 2:** `QuickBooksScreen.tsx` — Dentally-style: company selector (All / specific) + period/date-range bar; cards Revenue / Expenses / Net Profit / Net Margin / Cash at Bank / Outstanding Receivables / Receipts Collected; P&L-by-bucket list; monthly trend (recharts); per-company table on "All". `(pence/100).toLocaleString('en-GB')`, £, light theme.
- [ ] **Step 3:** Route page + sidebar link under Finance.
- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `feat(quickbooks): finance dashboard page`

---

## Task 9: Group Overview cards + Business Hub rollup

**Files:**
- Modify: `frontend/features/overview/components/GroupPerformanceScreen.tsx`, `frontend/features/overview/business-hub-api.ts`, and the backend business-hub aggregator if a source/account filter needs adjusting.

- [ ] **Step 1:** Group Overview: add QB cards (summed Revenue, Net Profit, Cash at Bank, Outstanding Receivables) + optional per-company mini-table, sourced from the finance QB API (accountId omitted = summed).
- [ ] **Step 2:** Business Hub: confirm the existing `monthly_financials` aggregation includes `source='quickbooks'` rows and that grouping ignores `integration_account_id` (so all companies sum). Adjust the aggregator query if it pins a single source.
- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint` (frontend); `npm test` (backend).
- [ ] **Step 4: Commit** — `feat(quickbooks): group overview cards + business hub rollup`

---

## Task 10: Docs + final verification

- [ ] **Step 1:** Update `docs/API.md` (new QB account + finance endpoints) and CLAUDE.md current-state log.
- [ ] **Step 2:** Run full `cd backend && npm test && npm run lint`; `cd frontend && npm run typecheck && npm run lint && npm run build`.
- [ ] **Step 3:** Commit docs.
- [ ] **Step 4:** Merge branch → main resolving conflicts, commit, push.

---

## Self-Review

- Spec sections all mapped: data model (T1), OAuth multi-account (T3), per-company sync (T4), management (T5), finance API (T6), integrations panel (T7), finance dashboard (T8), group overview + business hub (T9). ✓
- No practice mapping anywhere for QB. ✓
- Account isolation via `integration_account_id` + per-account delete scope + prefixed external_id. ✓
- Reconnect-fresh: no data migration of the old single connection. ✓
