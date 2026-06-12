# GoHighLevel Multi-Subaccount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one organisation connect multiple GoHighLevel subaccounts (one per GHL Location, each via its own Private Integration Token), map each 1:1 to a practice, stamp every synced contact/lead with that practice, and scope the whole app by subaccount via the existing practice selector.

**Architecture:** New `integration_accounts` child table holds per-location credentials + a `practice_id` mapping. The single `integrations` GHL row stays as a "connected" marker. The GHL sync + webhook ingestion become account-aware and stamp `practice_id`. The frontend integrations panel becomes a subaccount manager; CRM screens pass the selected practice as `practice_id` (repos already filter by it).

**Tech Stack:** Node ESM (Express layered: routes→controllers→services→repositories), Supabase Postgres (serviceClient + manual `organisation_id` filter), vitest, Next.js 14 App Router, React Query.

**Spec:** `docs/superpowers/specs/2026-06-12-ghl-multi-subaccount-design.md`

**Conventions to honour:**
- Native ESM. Namespace imports keep their original local var (`import * as x_1 from "../y.js"`). Relative imports carry `.js`.
- Money in integer pence. British English in UI. No emojis.
- Every query carries `organisation_id` (serviceClient path has no automatic RLS).
- Secrets encrypted via `lib/crypto.js`; never returned to the client.
- After any hosted DDL: `NOTIFY pgrst, 'reload schema';`.
- Run a single test file: `cd backend && npx vitest run path/to/x.test.js`. Single test: `npx vitest run -t "name"`.

---

## Phase 1 — Backend foundation

### Task 1: Migration — `integration_accounts` table + backfill

**Files:**
- Create: `supabase/migrations/20260101000084_integration_accounts.sql`

- [ ] **Step 1: Write the migration**

`20260101000084_integration_accounts.sql`:

```sql
-- Multi-subaccount support for GoHighLevel: one credential row per GHL Location,
-- each mapped 1:1 to a practice. The existing integrations row stays a connected
-- marker. Single-account providers (Dentally, Xero) are unaffected.
create table if not exists integration_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  provider text not null,                 -- 'gohighlevel'
  external_account_id text not null,      -- GHL locationId
  practice_id uuid references practices(id) on delete set null,
  label text,
  secrets bytea,                          -- encrypted PIT JSON, same format as integrations.secrets
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active',  -- active | failed | revoked
  webhook_token text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organisation_id, provider, external_account_id)
);

create index if not exists idx_integration_accounts_org_provider
  on integration_accounts(organisation_id, provider);

-- 1 subaccount : 1 practice (only for gohighlevel, only when mapped).
create unique index if not exists idx_integration_accounts_practice
  on integration_accounts(organisation_id, practice_id)
  where practice_id is not null and provider = 'gohighlevel';

-- Fast webhook routing by the random per-account token.
create unique index if not exists idx_integration_accounts_webhook_token
  on integration_accounts(webhook_token) where webhook_token is not null;

-- updated_at trigger (match existing tables' pattern if one exists; otherwise inline).
create or replace function set_integration_accounts_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_integration_accounts_updated_at on integration_accounts;
create trigger trg_integration_accounts_updated_at
  before update on integration_accounts
  for each row execute function set_integration_accounts_updated_at();

-- Backfill: move each existing GHL integrations row into one account row.
-- practice_id is set ONLY when the org has exactly one practice (unambiguous);
-- otherwise NULL and the owner maps it in the UI. webhook_token random per row.
insert into integration_accounts
  (organisation_id, provider, external_account_id, practice_id, label, secrets, config, status, webhook_token)
select
  i.organisation_id,
  'gohighlevel',
  coalesce(i.config->>'locationId', i.id::text),
  (select p.id from practices p
     where p.organisation_id = i.organisation_id
     group by () having count(*) = 1
     limit 1),
  'GoHighLevel',
  i.secrets,
  coalesce(i.config, '{}'::jsonb),
  coalesce(i.status, 'active'),
  gen_random_uuid()::text
from integrations i
where i.provider = 'gohighlevel'
on conflict (organisation_id, provider, external_account_id) do nothing;

-- Backfill practice_id onto already-synced GHL data, but ONLY for orgs whose
-- single account resolved a practice (safe / unambiguous).
update contacts c
set practice_id = a.practice_id
from integration_accounts a
where a.provider = 'gohighlevel'
  and a.practice_id is not null
  and c.organisation_id = a.organisation_id
  and c.source = 'gohighlevel'
  and c.practice_id is null;

update leads l
set practice_id = a.practice_id
from integration_accounts a
where a.provider = 'gohighlevel'
  and a.practice_id is not null
  and l.organisation_id = a.organisation_id
  and l.ghl_opportunity_id is not null
  and l.practice_id is null;

notify pgrst, 'reload schema';
```

Note: `group by () having count(*)=1` returns the lone practice id or no row (NULL) — correct for the "exactly one practice" guard. If the local Postgres rejects `group by ()`, replace the subselect with:
`(select p.id from practices p where p.organisation_id = i.organisation_id and (select count(*) from practices p2 where p2.organisation_id = i.organisation_id) = 1 limit 1)`.

- [ ] **Step 2: Apply locally and verify**

Run: `cd /Users/ruhithpasha/code/work/Dental-os && supabase db reset`
Expected: completes without error; the new migration runs after `…000083`.

Verify the table + indexes exist:
Run: `supabase db reset 2>&1 | tail -5` then in psql or via MCP `list_tables` confirm `integration_accounts` present.

- [ ] **Step 3: Keep the unmanaged schema copy in sync**

Per CLAUDE.md, `backend/db/01_schema.sql` is an unmanaged source copy. Append the `create table integration_accounts (...)` + indexes (no backfill) to it so it does not drift. Read `backend/db/01_schema.sql` first to match its formatting.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000084_integration_accounts.sql backend/db/01_schema.sql
git commit -m "feat(ghl): integration_accounts table + GHL backfill migration"
```

---

### Task 2: `integration-account.repository.js`

**Files:**
- Create: `backend/src/repositories/integration-account.repository.js`
- Test: `backend/test/integration-account.repository.test.js`

- [ ] **Step 1: Write the failing test**

`backend/test/integration-account.repository.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal Supabase query-builder mock: records the last filter chain + returns canned data.
function makeClient(rows = []) {
  const state = { table: null, filters: {}, payload: null, op: null };
  const builder = {
    select() { return builder; },
    eq(col, val) { state.filters[col] = val; return builder; },
    order() { return builder; },
    maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
    single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    then(res) { return Promise.resolve({ data: rows, error: null }).then(res); },
    insert(p) { state.payload = p; state.op = 'insert'; return builder; },
    update(p) { state.payload = p; state.op = 'update'; return builder; },
  };
  return {
    state,
    from(table) { state.table = table; return builder; },
  };
}

describe('integrationAccountRepository', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('../src/repositories/integration-account.repository.js');
  });

  it('list scopes by organisation_id and provider', async () => {
    const repo = mod.integrationAccountRepository;
    const client = makeClient([{ id: 'a1', provider: 'gohighlevel' }]);
    const spy = vi.spyOn(repo, '_client').mockReturnValue(client);
    const rows = await repo.list('org-1', 'gohighlevel');
    expect(spy).toHaveBeenCalled();
    expect(client.state.table).toBe('integration_accounts');
    expect(client.state.filters.organisation_id).toBe('org-1');
    expect(client.state.filters.provider).toBe('gohighlevel');
    expect(rows[0].id).toBe('a1');
  });

  it('list never selects the secrets column', async () => {
    const repo = mod.integrationAccountRepository;
    const client = makeClient([]);
    let selected = '';
    client.from = (t) => { client.state.table = t; return {
      select(cols) { selected = cols; return this; },
      eq() { return this; }, order() { return this; },
      then(r) { return Promise.resolve({ data: [], error: null }).then(r); },
    }; };
    vi.spyOn(repo, '_client').mockReturnValue(client);
    await repo.list('org-1', 'gohighlevel');
    expect(selected).not.toContain('secrets');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/integration-account.repository.test.js`
Expected: FAIL — module `../src/repositories/integration-account.repository.js` not found.

- [ ] **Step 3: Write the repository**

`backend/src/repositories/integration-account.repository.js`:

```js
// ============================================================================
// Integration-account repository — per-subaccount credential store. Today only
// GoHighLevel uses it (one row per GHL Location, mapped 1:1 to a practice).
// Secrets are pre-encrypted before reaching here; read methods that face the API
// NEVER select the secrets column. Every query carries organisation_id (no RLS
// on the serviceClient path).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// Columns safe to return to the API (no secrets).
const SAFE_COLS = 'id, provider, external_account_id, practice_id, label, status, last_sync_at, last_error, config, webhook_token, created_at, updated_at';

export const integrationAccountRepository = {
    // Indirection so tests can stub the client.
    _client() { return supabase_1.serviceClient; },

    async list(orgId, provider) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .eq('provider', provider)
            .order('created_at', { ascending: true });
        return data ?? [];
    },

    // Full row INCLUDING secrets — for sync only, never returned by a controller.
    async getByIdWithSecrets(orgId, id) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('id', id)
            .maybeSingle();
        return data;
    },

    async getById(orgId, id) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .eq('id', id)
            .maybeSingle();
        return data;
    },

    async getByLocation(orgId, provider, locationId) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('provider', provider)
            .eq('external_account_id', String(locationId))
            .maybeSingle();
        return data;
    },

    // Webhook routing — resolves an account from its random token (no org filter:
    // the token IS the credential). Returns the full row including practice_id.
    async getByWebhookToken(token) {
        if (!token) return null;
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('webhook_token', token)
            .maybeSingle();
        return data;
    },

    async insert(orgId, fields) {
        const row = { organisation_id: orgId, ...fields };
        const { data, error } = await this._client()
            .from('integration_accounts')
            .insert(row)
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async update(orgId, id, patch) {
        const { data, error } = await this._client()
            .from('integration_accounts')
            .update(patch)
            .eq('organisation_id', orgId)
            .eq('id', id)
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    // Shallow-merge a JSONB config patch (preserve other keys, e.g. stage_mappings).
    async mergeConfig(orgId, id, patch) {
        const { data: existing } = await this._client()
            .from('integration_accounts')
            .select('config')
            .eq('organisation_id', orgId).eq('id', id).maybeSingle();
        const config = { ...(existing?.config ?? {}), ...patch };
        const { error } = await this._client()
            .from('integration_accounts')
            .update({ config })
            .eq('organisation_id', orgId).eq('id', id);
        if (error) throw new Error(error.message);
        return config;
    },

    async markSynced(orgId, id) {
        await this._client()
            .from('integration_accounts')
            .update({ last_sync_at: new Date().toISOString(), last_error: null, status: 'active' })
            .eq('organisation_id', orgId).eq('id', id);
    },

    async markFailed(orgId, id, lastError) {
        await this._client()
            .from('integration_accounts')
            .update({ status: 'failed', last_error: String(lastError).slice(0, 500) })
            .eq('organisation_id', orgId).eq('id', id);
    },

    async markRevoked(orgId, id) {
        await this._client()
            .from('integration_accounts')
            .update({ status: 'revoked', secrets: null })
            .eq('organisation_id', orgId).eq('id', id);
    },

    // All active GHL accounts across every org — for the worker.
    async listAllActive(provider) {
        const { data } = await this._client()
            .from('integration_accounts')
            .select('*')
            .eq('provider', provider)
            .eq('status', 'active');
        return data ?? [];
    },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/integration-account.repository.test.js`
Expected: PASS (3 assertions across 2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/integration-account.repository.js backend/test/integration-account.repository.test.js
git commit -m "feat(ghl): integration-account repository (org-scoped, secrets-safe reads)"
```

---

### Task 3: GHL location-validation helper + `ghl-account.service.js` (add/list/update/remove)

**Files:**
- Modify: `backend/src/lib/integrations/gohighlevel-sync.js` (export a `fetchLocation` validator)
- Create: `backend/src/services/ghl-account.service.js`
- Test: `backend/test/ghl-account.service.test.js`

- [ ] **Step 1: Add a location-validation helper to the sync module**

In `backend/src/lib/integrations/gohighlevel-sync.js`, after `ghlFetch(...)` (ends at line ~169), add:

```js
// Validate a Private Integration Token against a Location: GET /locations/{id}.
// Returns { id, name } on success; throws on a bad token/location (used by
// addAccount to reject invalid credentials before persisting).
export async function fetchLocation(accessToken, locationId) {
    const url = `${API_BASE}/locations/${encodeURIComponent(locationId)}`;
    const body = await ghlFetchUrl(url, accessToken);
    const loc = body.location ?? body;
    return { id: loc.id ?? locationId, name: loc.name ?? null };
}
```

- [ ] **Step 2: Write the failing test**

`backend/test/ghl-account.service.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the dependency modules BEFORE importing the service.
vi.mock('../src/repositories/integration-account.repository.js', () => {
  const rows = [];
  return {
    integrationAccountRepository: {
      _rows: rows,
      list: vi.fn(async () => rows.map(({ secrets, ...r }) => r)),
      getByLocation: vi.fn(async (org, prov, loc) => rows.find((r) => r.external_account_id === String(loc)) ?? null),
      getById: vi.fn(async (org, id) => rows.find((r) => r.id === id) ?? null),
      getByIdWithSecrets: vi.fn(async (org, id) => rows.find((r) => r.id === id) ?? null),
      insert: vi.fn(async (org, fields) => { const row = { id: 'acc-' + (rows.length + 1), organisation_id: org, ...fields }; rows.push(row); const { secrets, ...safe } = row; return safe; }),
      update: vi.fn(async (org, id, patch) => { const r = rows.find((x) => x.id === id); Object.assign(r, patch); const { secrets, ...safe } = r; return safe; }),
      markRevoked: vi.fn(async (org, id) => { const r = rows.find((x) => x.id === id); if (r) { r.status = 'revoked'; r.secrets = null; } }),
    },
  };
});

vi.mock('../src/lib/integrations/gohighlevel-sync.js', () => ({
  fetchLocation: vi.fn(async (token, loc) => {
    if (token === 'bad') throw new Error('GHL 401');
    return { id: loc, name: 'Smile Dental ' + loc };
  }),
  bootstrapAccount: vi.fn(async () => ({ contacts: 0, opportunities: 0 })),
}));

vi.mock('../src/lib/integration-gating.js', () => ({ invalidate: vi.fn() }));

describe('ghlAccountService.addAccount', () => {
  let svc, repo;
  beforeEach(async () => {
    process.env.INTEGRATIONS_SECRET_KEY = 'test-secret-key';
    vi.resetModules();
    repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    repo._rows.length = 0;
    svc = (await import('../src/services/ghl-account.service.js')).ghlAccountService;
  });

  it('rejects an invalid token before persisting', async () => {
    await expect(svc.addAccount('org-1', { token: 'bad', locationId: 'L1', practiceId: 'p1' }))
      .rejects.toThrow();
    expect(repo._rows.length).toBe(0);
  });

  it('encrypts the token, stores a webhook_token, and mints a row', async () => {
    const out = await svc.addAccount('org-1', { token: 'pit-good', locationId: 'L1', practiceId: 'p1' });
    expect(out.id).toBeTruthy();
    expect(out.secrets).toBeUndefined();           // never leaked to caller
    const row = repo._rows[0];
    expect(row.external_account_id).toBe('L1');
    expect(row.practice_id).toBe('p1');
    expect(row.webhook_token).toMatch(/[a-f0-9]{32,}/);
    expect(row.secrets).toBeTruthy();              // encrypted blob persisted
    expect(row.secrets).not.toContain('pit-good'); // not plaintext
  });

  it('rejects a duplicate location for the same org', async () => {
    await svc.addAccount('org-1', { token: 'pit-good', locationId: 'L1', practiceId: 'p1' });
    await expect(svc.addAccount('org-1', { token: 'pit-good', locationId: 'L1', practiceId: 'p2' }))
      .rejects.toThrow(/already connected/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/ghl-account.service.test.js`
Expected: FAIL — `../src/services/ghl-account.service.js` not found.

- [ ] **Step 4: Write the service**

`backend/src/services/ghl-account.service.js`:

```js
// ============================================================================
// GoHighLevel subaccount service — owner-only management of N GHL Locations per
// org, each mapped 1:1 to a practice. Each account carries its own Private
// Integration Token (encrypted) and a random webhook token. Sync + webhooks
// stamp the account's practice_id on every contact/lead.
// ============================================================================
import crypto from "node:crypto";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { encryptSecret } from "../lib/crypto.js";
import * as gohighlevel_sync_1 from "../lib/integrations/gohighlevel-sync.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { invalidate as invalidateGating } from "../lib/integration-gating.js";
import * as errors_1 from "../middleware/errors.js";

const PROVIDER = 'gohighlevel';

export const ghlAccountService = {
    async listAccounts(orgId) {
        const accounts = await integrationAccountRepository.list(orgId, PROVIDER);
        return { accounts };
    },

    async addAccount(orgId, { token, locationId, practiceId = null, label = null }) {
        if (!token || !String(token).trim()) throw new errors_1.AppError('token is required', 400);
        if (!locationId || !String(locationId).trim()) throw new errors_1.AppError('locationId is required', 400);
        const loc = String(locationId).trim();

        const dup = await integrationAccountRepository.getByLocation(orgId, PROVIDER, loc);
        if (dup && dup.status !== 'revoked') {
            throw new errors_1.AppError('That GoHighLevel location is already connected', 409);
        }

        // Validate the PIT against the Location before persisting anything.
        let name = label;
        try {
            const info = await gohighlevel_sync_1.fetchLocation(String(token).trim(), loc);
            name = label || info.name || 'GoHighLevel';
        } catch (err) {
            throw new errors_1.AppError(`Could not validate that token/location with GoHighLevel: ${err.message}`, 400);
        }

        const secrets = encryptSecret(JSON.stringify({ access_token: String(token).trim() }));
        const webhook_token = crypto.randomBytes(24).toString('hex');

        // Reuse a revoked row for the same location if present (re-link), else insert.
        let account;
        if (dup) {
            account = await integrationAccountRepository.update(orgId, dup.id, {
                practice_id: practiceId, label: name, secrets, status: 'active',
                webhook_token, last_error: null,
            });
        } else {
            account = await integrationAccountRepository.insert(orgId, {
                provider: PROVIDER, external_account_id: loc, practice_id: practiceId,
                label: name, secrets, config: {}, status: 'active', webhook_token,
            });
        }

        // Keep the lightweight integrations marker active so gating/list UI shows GHL connected.
        await integrationRepository.upsert(orgId, PROVIDER, { status: 'active', last_error: null });
        invalidateGating(orgId);

        // Fire-and-forget first pull for this account (does not block the response).
        gohighlevel_sync_1.bootstrapAccount(orgId, account.id)
            .catch((err) => console.error('[ghl-account] bootstrap failed:', err?.message || err));

        return account;
    },

    async updateAccount(orgId, id, { practiceId, label }) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new errors_1.AppError('account not found', 404);
        const patch = {};
        if (practiceId !== undefined) patch.practice_id = practiceId || null;
        if (label !== undefined) patch.label = label;
        if (Object.keys(patch).length === 0) return existing;
        try {
            return await integrationAccountRepository.update(orgId, id, patch);
        } catch (err) {
            // Unique partial index (org, practice_id) violation -> practice already mapped.
            if (/duplicate key|unique/i.test(err.message)) {
                throw new errors_1.AppError('That practice is already linked to another subaccount', 409);
            }
            throw err;
        }
    },

    async removeAccount(orgId, id) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new errors_1.AppError('account not found', 404);
        await integrationAccountRepository.markRevoked(orgId, id);
        // If no active accounts remain, flip the marker to revoked too.
        const remaining = await integrationAccountRepository.list(orgId, PROVIDER);
        if (!remaining.some((a) => a.status === 'active')) {
            await integrationRepository.markRevoked(orgId, PROVIDER);
        }
        invalidateGating(orgId);
        return { ok: true };
    },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/ghl-account.service.test.js`
Expected: PASS (3 tests). Note: `bootstrapAccount` is mocked here; it is implemented in Task 4 — the service references it by name and the real export lands next.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/integrations/gohighlevel-sync.js backend/src/services/ghl-account.service.js backend/test/ghl-account.service.test.js
git commit -m "feat(ghl): subaccount service (add/list/update/remove) + token validation"
```

---

### Task 4: Make GHL sync account-aware + stamp `practice_id`

This refactors `gohighlevel-sync.js` so the row builders accept a `practiceId` and a new `syncAccount`/`bootstrapAccount` drive a sync from an `integration_accounts` row. The existing `integrations`-based `syncOneOrg` stays for back-compat but is no longer the GHL path.

**Files:**
- Modify: `backend/src/lib/integrations/gohighlevel-sync.js`
- Test: `backend/test/gohighlevel-practice-stamp.test.js`

- [ ] **Step 1: Write the failing test (practice_id stamping)**

`backend/test/gohighlevel-practice-stamp.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { contactRow, upsertOpportunity, applyWebhookEvent } from '../src/lib/integrations/gohighlevel-sync.js';

describe('GHL practice_id stamping', () => {
  it('contactRow stamps the given practice_id', () => {
    const row = contactRow('org-1', { id: 'c1', firstName: 'Ann', email: 'A@x.com' }, 'prac-9');
    expect(row.practice_id).toBe('prac-9');
    expect(row.organisation_id).toBe('org-1');
    expect(row.source).toBe('gohighlevel');
  });

  it('contactRow omits practice_id when none given (back-compat null)', () => {
    const row = contactRow('org-1', { id: 'c1', firstName: 'Ann' });
    expect(row.practice_id ?? null).toBeNull();
  });

  it('upsertOpportunity writes practice_id on the lead row', async () => {
    let captured = null;
    const db = {
      from() { return {
        select() { return this; }, eq() { return this; }, ilike() { return this; },
        maybeSingle: async () => ({ data: { id: 'contact-1' } }),
        upsert: async (row) => { captured = row; return { error: null }; },
      }; },
    };
    const r = await upsertOpportunity('org-1', { id: 'opp-1', contact: { id: 'c1' } }, {}, db, new Map([['c1', 'contact-1']]), null, 'prac-9');
    expect(r.ok).toBe(true);
    expect(captured.practice_id).toBe('prac-9');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/gohighlevel-practice-stamp.test.js`
Expected: FAIL — `row.practice_id` is undefined / `upsertOpportunity` ignores the 7th arg.

- [ ] **Step 3: Thread `practiceId` through the row builders**

In `backend/src/lib/integrations/gohighlevel-sync.js`:

(a) `contactRow` — change the signature and add the field. Replace:
```js
export function contactRow(orgId, c) {
    const name = c.name ?? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    const [first, ...rest] = (name || 'Unknown').split(' ');
    return {
        organisation_id: orgId,
        source: 'gohighlevel',
        ghl_contact_id: c.id ?? null,
        first_name: c.firstName ?? first ?? 'Unknown',
        last_name: c.lastName ?? (rest.join(' ') || null),
        email: c.email ? String(c.email).toLowerCase() : null,
        phone: c.phone ?? null,
    };
}
```
with:
```js
export function contactRow(orgId, c, practiceId = null) {
    const name = c.name ?? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    const [first, ...rest] = (name || 'Unknown').split(' ');
    return {
        organisation_id: orgId,
        source: 'gohighlevel',
        ghl_contact_id: c.id ?? null,
        first_name: c.firstName ?? first ?? 'Unknown',
        last_name: c.lastName ?? (rest.join(' ') || null),
        email: c.email ? String(c.email).toLowerCase() : null,
        phone: c.phone ?? null,
        ...(practiceId ? { practice_id: practiceId } : {}),
    };
}
```

(b) `upsertContact` — add `practiceId` and stamp it on the link-updates and the insert. Change the signature line:
```js
export async function upsertContact(orgId, c, db = supabase_1.serviceClient) {
```
to:
```js
export async function upsertContact(orgId, c, db = supabase_1.serviceClient, practiceId = null) {
```
Then in the three update/insert sites add the practice when present. In the `ghl_contact_id`-match update block, change `.update({ first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone })` to also set practice when given:
```js
await db.from('contacts').update({
    first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone,
    ...(practiceId ? { practice_id: practiceId } : {}),
}).eq('id', data.id);
```
In the email-match and phone-match blocks, change `.update({ ghl_contact_id: c.ghl_contact_id })` to:
```js
.update({ ghl_contact_id: c.ghl_contact_id, ...(practiceId ? { practice_id: practiceId } : {}) })
```
In the final `.upsert({...}, { onConflict: 'organisation_id,ghl_contact_id' })`, add `...(practiceId ? { practice_id: practiceId } : {})` to the object.

(c) `upsertOpportunity` — add `practiceId` as the 7th param and stamp it. Change the signature:
```js
export async function upsertOpportunity(orgId, opp, stageMappings = {}, db = supabase_1.serviceClient, contactMap = null, stageNameMap = null) {
```
to:
```js
export async function upsertOpportunity(orgId, opp, stageMappings = {}, db = supabase_1.serviceClient, contactMap = null, stageNameMap = null, practiceId = null) {
```
In its `db.from('leads').upsert({...})` object, add after `source: 'gohighlevel',`:
```js
            ...(practiceId ? { practice_id: practiceId } : {}),
```
Also stamp the contact: where it calls `matchOrCreateContact(orgId, contact, db)`, the created contact should inherit the practice. Change that call to pass practiceId through (next sub-step).

(d) `matchOrCreateContact` — add `practiceId` and set it on the new-contact rows. Change signature:
```js
export async function matchOrCreateContact(orgId, c, db = supabase_1.serviceClient) {
```
to:
```js
export async function matchOrCreateContact(orgId, c, db = supabase_1.serviceClient, practiceId = null) {
```
In the `newRow` object add `...(practiceId ? { practice_id: practiceId } : {})`. Then in `upsertOpportunity`, change `contactId = await matchOrCreateContact(orgId, contact, db);` to `contactId = await matchOrCreateContact(orgId, contact, db, practiceId);`.

(e) `applyWebhookEvent` — add `practiceId` and forward it. Change signature:
```js
export async function applyWebhookEvent(orgId, eventType, record) {
```
to:
```js
export async function applyWebhookEvent(orgId, eventType, record, practiceId = null) {
```
Change the contact branch `await upsertContact(orgId, contactRow(orgId, record));` to:
```js
        await upsertContact(orgId, contactRow(orgId, record, practiceId), supabase_1.serviceClient, practiceId);
```
Change the opportunity branch `const r = await upsertOpportunity(orgId, record, stageMappings);` to:
```js
        const r = await upsertOpportunity(orgId, record, stageMappings, supabase_1.serviceClient, null, null, practiceId);
```

- [ ] **Step 4: Run the stamping test to verify it passes**

Run: `cd backend && npx vitest run test/gohighlevel-practice-stamp.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Add account-driven sync (`syncAccount` + `bootstrapAccount`)**

Still in `gohighlevel-sync.js`. The existing `syncOneOrg` persists to the `integrations` table via `integrationRepository`. Add a parallel account path that reuses the same fetch/upsert logic but reads creds from an account row, stamps `practice_id`, and persists pipelines/last_sync to the account row.

Add near the top, the account repo import (after the existing `integrationRepository` import on line 30):
```js
import { integrationAccountRepository } from '../../repositories/integration-account.repository.js';
```

Then refactor `pullContacts` to accept and forward `practiceId`. Change its signature:
```js
async function pullContacts(orgId, accessToken, locationId, onPage, maxPages) {
```
to:
```js
async function pullContacts(orgId, accessToken, locationId, onPage, maxPages, practiceId = null) {
```
Inside, where it builds rows with `const r = contactRow(orgId, rc);`, change to `const r = contactRow(orgId, rc, practiceId);`. The `toLink` updates already set only `ghl_contact_id`; add practice there too — change the link update:
```js
    for (const lk of toLink) {
        const { error } = await supabase_1.serviceClient.from('contacts')
            .update({ ghl_contact_id: lk.ghl_contact_id, ...(practiceId ? { practice_id: practiceId } : {}) })
            .eq('id', lk.id).eq('organisation_id', orgId);
        if (!error) synced++;
    }
```

Now add the account sync functions. Append before `export async function syncAllOrgs()`:

```js
// Account-driven sync: same pull/upsert engine as syncOneOrg, but creds come
// from an integration_accounts row (its own PIT + locationId), every contact/
// lead is stamped with account.practice_id, and pipelines/last_sync persist to
// the account row. This is the multi-subaccount path.
export async function syncAccount(orgId, accountId, onProgress = () => {}, { full = false, recent = false } = {}) {
    const account = await integrationAccountRepository.getByIdWithSecrets(orgId, accountId);
    if (!account || account.status === 'revoked' || !account.secrets) {
        return { synced: 0, skipped: 'inactive' };
    }
    const { access_token } = JSON.parse(decryptSecret(account.secrets));
    const locationId = account.external_account_id;
    if (!access_token || !locationId) return { synced: 0, skipped: 'no_location' };
    const practiceId = account.practice_id ?? null;
    const stageMappings = account.config?.stage_mappings ?? {};
    const maxPages = (full || recent) ? BOOTSTRAP_MAX_PAGES : MAX_PAGES;
    const nPhases = 2;

    try {
        const contactsSynced = await pullContacts(orgId, access_token, locationId,
            (page, totalPages, count) => onProgress({ phase: 'contacts', pct: phasePct(0, nPhases, page, totalPages), page, totalPages, count }),
            maxPages, practiceId);

        const opportunities = await ghlFetchAll('/opportunities/search', access_token, locationId, {
            arrayKey: 'opportunities', locationParam: 'location_id', maxPages,
            onPage: (page, totalPages, count) => onProgress({ phase: 'opportunities', pct: phasePct(1, nPhases, page, totalPages), page, totalPages, count }),
        });

        // Cache pipeline defs on the ACCOUNT config + build a stageId->name map.
        let stageNameMap = null;
        try {
            const { pipelines = [] } = await detectPipelinesForToken(access_token, locationId);
            if (pipelines.length) {
                await integrationAccountRepository.mergeConfig(orgId, accountId, { pipelines });
                stageNameMap = new Map();
                for (const p of pipelines) for (const s of p.stages ?? []) stageNameMap.set(String(s.id), s.name);
            }
        } catch (err) {
            console.warn(`[gohighlevel] account ${accountId} pipelines skipped: ${err?.message || err}`);
        }

        const { byGhl: oppContactMap } = await loadContactDedupMaps(orgId);
        let synced = 0;
        for (const opp of opportunities) {
            const r = await upsertOpportunity(orgId, opp, stageMappings, supabase_1.serviceClient, oppContactMap, stageNameMap, practiceId);
            if (r.ok) synced++;
        }
        await integrationAccountRepository.markSynced(orgId, accountId);
        return { contacts: contactsSynced, opportunities: synced, total: opportunities.length };
    } catch (err) {
        await integrationAccountRepository.markFailed(orgId, accountId, String(err.message));
        throw err;
    }
}

// First-connect pull for a freshly added subaccount.
export async function bootstrapAccount(orgId, accountId, onProgress = () => {}) {
    return syncAccount(orgId, accountId, onProgress, { recent: true });
}

// Token-scoped pipeline detection (no integration row needed) — used by syncAccount
// and the per-account pipelines endpoint.
export async function detectPipelinesForToken(accessToken, locationId) {
    if (!accessToken || !locationId) return { pipelines: [], error: 'no_location' };
    const body = await ghlFetch('/opportunities/pipelines', accessToken, locationId, 'locationId');
    const pipelines = (body.pipelines ?? []).map((p) => ({
        id: p.id, name: p.name ?? p.id,
        stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name ?? s.id })),
    }));
    return { pipelines };
}
```

- [ ] **Step 6: Repoint the worker fan-out to accounts**

In `gohighlevel-sync.js`, replace `syncAllOrgs` so it iterates `integration_accounts` instead of `integrations`:

```js
export async function syncAllOrgs() {
    const accounts = await integrationAccountRepository.listAllActive('gohighlevel');
    const results = [];
    for (const acc of accounts) {
        try {
            const r = await syncAccount(acc.organisation_id, acc.id);
            results.push({ orgId: acc.organisation_id, accountId: acc.id, ...r });
        } catch (err) {
            results.push({ orgId: acc.organisation_id, accountId: acc.id, error: err.message });
        }
    }
    return results;
}
```

- [ ] **Step 7: Add the syncAccount test**

`backend/test/gohighlevel-sync-account.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const account = {
  id: 'acc-1', organisation_id: 'org-1', status: 'active',
  external_account_id: 'L1', practice_id: 'prac-9', config: {},
};

vi.mock('../src/repositories/integration-account.repository.js', () => ({
  integrationAccountRepository: {
    getByIdWithSecrets: vi.fn(async () => account),
    mergeConfig: vi.fn(async () => ({})),
    markSynced: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    listAllActive: vi.fn(async () => [account]),
  },
}));

// Decrypt returns a known token; avoid real crypto.
vi.mock('../src/lib/crypto.js', () => ({
  decryptSecret: () => JSON.stringify({ access_token: 'pit-x' }),
  encryptSecret: (s) => 'enc:' + s,
}));

describe('syncAccount', () => {
  beforeEach(() => { vi.resetModules(); account.secrets = 'enc'; });

  it('marks the account failed and rethrows when the pull errors', async () => {
    // Force ghlFetchAll to throw by stubbing fetch to reject.
    global.fetch = vi.fn(async () => { throw new Error('network'); });
    const repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    const { syncAccount } = await import('../src/lib/integrations/gohighlevel-sync.js');
    await expect(syncAccount('org-1', 'acc-1')).rejects.toThrow();
    expect(repo.markFailed).toHaveBeenCalledWith('org-1', 'acc-1', expect.any(String));
  });

  it('skips an inactive/secret-less account', async () => {
    const repo = (await import('../src/repositories/integration-account.repository.js')).integrationAccountRepository;
    repo.getByIdWithSecrets.mockResolvedValueOnce({ ...account, secrets: null });
    const { syncAccount } = await import('../src/lib/integrations/gohighlevel-sync.js');
    const r = await syncAccount('org-1', 'acc-1');
    expect(r.skipped).toBeTruthy();
  });
});
```

- [ ] **Step 8: Run the sync + stamping tests**

Run: `cd backend && npx vitest run test/gohighlevel-practice-stamp.test.js test/gohighlevel-sync-account.test.js`
Expected: PASS. Then run the existing GHL suite to confirm no regression:
Run: `cd backend && npx vitest run test/ -t gohighlevel`
Expected: PASS (existing tests still green; the old `syncOneOrg` signature is unchanged — only optional params were added).

- [ ] **Step 9: Commit**

```bash
git add backend/src/lib/integrations/gohighlevel-sync.js backend/test/gohighlevel-practice-stamp.test.js backend/test/gohighlevel-sync-account.test.js
git commit -m "feat(ghl): account-aware sync stamping practice_id; worker fans out per account"
```

---

### Task 5: Routes, controller, model schema, API docs

**Files:**
- Modify: `backend/src/models/integration.model.js` (add Zod schemas)
- Modify: `backend/src/controllers/integration.controller.js` (add account handlers)
- Modify: `backend/src/routes/integrations.routes.js` (wire account routes)
- Modify: `docs/API.md`
- Test: `backend/test/ghl-account.routes.test.js` (if the repo has a route-level test harness; otherwise assert controller handlers in isolation)

- [ ] **Step 1: Add Zod schemas**

Read `backend/src/models/integration.model.js` first to match its export style, then add:

```js
import { z } from "zod";

export const ghlAccountCreateSchema = z.object({
    token: z.string().min(8),
    locationId: z.string().min(1),
    practiceId: z.string().uuid().nullable().optional(),
    label: z.string().max(120).optional(),
});

export const ghlAccountUpdateSchema = z.object({
    practiceId: z.string().uuid().nullable().optional(),
    label: z.string().max(120).optional(),
});
```
(If the file already `import { z }`, do not duplicate the import.)

- [ ] **Step 2: Add controller handlers**

In `backend/src/controllers/integration.controller.js`, import the new service at the top:
```js
import { ghlAccountService } from "../services/ghl-account.service.js";
import { syncAccount, detectPipelinesForToken } from "../lib/integrations/gohighlevel-sync.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { decryptSecret } from "../lib/crypto.js";
import { ghlAccountCreateSchema, ghlAccountUpdateSchema } from "../models/integration.model.js";
```
Add these methods inside the `integrationController` object (before the closing `};`):
```js
    // --- GoHighLevel subaccounts -------------------------------------------
    async ghlAccountsList(req, res) {
        res.json(await ghlAccountService.listAccounts(req.user.organisation_id));
    },
    async ghlAccountCreate(req, res) {
        const body = ghlAccountCreateSchema.parse(req.body);
        res.json(await ghlAccountService.addAccount(req.user.organisation_id, body));
    },
    async ghlAccountUpdate(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const body = ghlAccountUpdateSchema.parse(req.body);
        res.json(await ghlAccountService.updateAccount(req.user.organisation_id, id, body));
    },
    async ghlAccountRemove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await ghlAccountService.removeAccount(req.user.organisation_id, id));
    },
    async ghlAccountSync(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const orgId = req.user.organisation_id;
        const full = req.query.full === 'true';
        // Fire-and-forget; the panel polls progress via the existing endpoint keyed per account.
        syncAccount(orgId, id, () => {}, { full })
            .catch((err) => console.error('[ghl-account] sync failed:', err?.message || err));
        res.json({ started: true, accountId: id, full });
    },
    async ghlAccountPipelines(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const orgId = req.user.organisation_id;
        const acc = await integrationAccountRepository.getByIdWithSecrets(orgId, id);
        if (!acc || !acc.secrets) { res.json({ pipelines: [], error: 'no_auth' }); return; }
        const { access_token } = JSON.parse(decryptSecret(acc.secrets));
        res.json(await detectPipelinesForToken(access_token, acc.external_account_id));
    },
    async ghlAccountStageMappings(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const { mappings } = integration_model_1.stageMappingsSchema.parse(req.body);
        // Reuse the existing validation set from the sync module.
        const orgId = req.user.organisation_id;
        await integrationAccountRepository.mergeConfig(orgId, id, { stage_mappings: mappings });
        res.json({ ok: true, stage_mappings: mappings });
    },
```

- [ ] **Step 3: Wire the routes**

In `backend/src/routes/integrations.routes.js`, add these BEFORE the final `router.delete('/:id', ...)` line (static GHL-account paths must precede the catch-all `/:provider/*` param routes to avoid being shadowed — place them right after the `router.get('/', ...)` line for safety):

```js
router.get('/gohighlevel/accounts', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountsList));
router.post('/gohighlevel/accounts', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountCreate));
router.patch('/gohighlevel/accounts/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountUpdate));
router.delete('/gohighlevel/accounts/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountRemove));
router.post('/gohighlevel/accounts/:id/sync', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountSync));
router.get('/gohighlevel/accounts/:id/pipelines', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountPipelines));
router.post('/gohighlevel/accounts/:id/stage-mappings', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountStageMappings));
```

IMPORTANT ordering: `/gohighlevel/accounts` is a literal path and must be registered before `router.get('/:provider/...')` lines so Express does not match `gohighlevel` as `:provider` with `accounts` swallowed. Since the existing `/:provider/*` routes already exist below `router.get('/')`, insert the seven lines immediately after `router.get('/', ...)`.

- [ ] **Step 4: Syntax-check + run any route tests**

Run: `cd backend && npm run typecheck`
Expected: passes (node --check on all files, no syntax errors).

Run: `cd backend && npx vitest run test/ghl-account.service.test.js`
Expected: still PASS.

- [ ] **Step 5: Document the endpoints**

In `docs/API.md`, under the integrations section, add the seven new endpoints with one-line descriptions and the request/response shapes (owner-only):
- `GET /api/integrations/gohighlevel/accounts` → `{ accounts: [...] }`
- `POST /api/integrations/gohighlevel/accounts` `{ token, locationId, practiceId?, label? }`
- `PATCH /api/integrations/gohighlevel/accounts/:id` `{ practiceId?, label? }`
- `DELETE /api/integrations/gohighlevel/accounts/:id`
- `POST /api/integrations/gohighlevel/accounts/:id/sync?full=true`
- `GET /api/integrations/gohighlevel/accounts/:id/pipelines`
- `POST /api/integrations/gohighlevel/accounts/:id/stage-mappings` `{ mappings }`

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/integration.model.js backend/src/controllers/integration.controller.js backend/src/routes/integrations.routes.js docs/API.md
git commit -m "feat(ghl): owner-only subaccount management routes + API docs"
```

---

### Task 6: Multi-account webhook routing

**Files:**
- Modify: `backend/src/services/webhook.service.js`
- Test: `backend/test/webhook-ghl-account.test.js`

- [ ] **Step 1: Write the failing test**

`backend/test/webhook-ghl-account.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const account = { id: 'acc-1', organisation_id: 'org-1', status: 'active', external_account_id: 'L1', practice_id: 'prac-9', config: {} };

vi.mock('../src/repositories/integration-account.repository.js', () => ({
  integrationAccountRepository: {
    getByWebhookToken: vi.fn(async (t) => (t === 'wht-good' ? account : null)),
    getByLocation: vi.fn(async () => account),
    list: vi.fn(async () => [account]),
  },
}));
vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { getByProvider: vi.fn(async () => ({ status: 'active', config: {} })) },
}));
const applied = [];
vi.mock('../src/lib/integrations/gohighlevel-sync.js', () => ({
  applyWebhookEvent: vi.fn(async (org, type, rec, practiceId) => { applied.push({ org, type, practiceId }); return { applied: 1 }; }),
  mapWebhookEventType: () => 'contact',
}));
vi.mock('../src/lib/integrations/dentally-sync.js', () => ({ applyWebhookEvent: vi.fn() }));

describe('GHL webhook account routing', () => {
  beforeEach(() => { applied.length = 0; vi.resetModules(); });

  it('routes by per-account webhook_token and stamps that practice_id', async () => {
    const { webhookService } = await import('../src/services/webhook.service.js');
    const res = await webhookService.gohighlevel('wht-good', { type: 'ContactCreate', contact: { id: 'c1', email: 'a@x.com' } }, null);
    expect(res.received).toBe(true);
    expect(applied[0].org).toBe('org-1');
    expect(applied[0].practiceId).toBe('prac-9');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/webhook-ghl-account.test.js`
Expected: FAIL — current `gohighlevel()` resolves via `verifyWebhookToken` + `integrationRepository`, never reads the account token, and `applyGhlWebhookEvent` is called with 3 args (no practiceId).

- [ ] **Step 3: Rewrite `webhookService.gohighlevel`**

In `backend/src/services/webhook.service.js`, add the account repo import near the other imports (after line 9):
```js
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
```
Replace the entire `async gohighlevel(orgToken, body, providedSecret) { ... }` method with:
```js
    async gohighlevel(routeToken, body, providedSecret) {
        // Preferred: the route token is a per-account random webhook_token →
        // resolves org + practice in one lookup (multi-subaccount path).
        let account = await integrationAccountRepository.getByWebhookToken(routeToken);
        let orgId;
        if (account) {
            if (account.status === 'revoked') throw new errors_1.AppError('gohighlevel not connected', 404);
            orgId = account.organisation_id;
        } else {
            // Back-compat: a legacy signed-org token (pre-multi-account URLs).
            try {
                orgId = verifyWebhookToken(routeToken);
            } catch {
                throw new errors_1.AppError('invalid webhook token', 401);
            }
            // Resolve the account by the payload's locationId, else the org's sole account.
            const evtLoc = body && !Array.isArray(body) ? (body.locationId ?? body.location_id) : null;
            if (evtLoc) account = await integrationAccountRepository.getByLocation(orgId, 'gohighlevel', evtLoc);
            if (!account) {
                const accounts = await integrationAccountRepository.list(orgId, 'gohighlevel');
                const active = accounts.filter((a) => a.status === 'active');
                account = active.length === 1 ? active[0] : null;
            }
            if (!account || account.status === 'revoked') {
                throw new errors_1.AppError('gohighlevel not connected', 404);
            }
        }

        // Optional shared-secret hardening (per-account config.webhook_secret).
        const secret = account.config?.webhook_secret;
        if (secret) {
            if (!providedSecret || !timingSafeHexEqual(String(providedSecret), secret)) {
                throw new errors_1.AppError('invalid signature', 401);
            }
        }
        // Defensive tenant check: a payload locationId must match this account's.
        const evtLoc = body && !Array.isArray(body) ? (body.locationId ?? body.location_id) : null;
        if (account.external_account_id && evtLoc && String(evtLoc) !== String(account.external_account_id)) {
            return { received: true, ignored: 'location_mismatch' };
        }

        const { events } = parseGhlEvent(body);
        if (!events || events.length === 0) return { received: true, ignored: true };
        const practiceId = account.practice_id ?? null;
        const results = [];
        for (const { eventType, record } of events) {
            results.push(await applyGhlWebhookEvent(orgId, eventType, record, practiceId));
        }
        return { received: true, count: results.length, results };
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/webhook-ghl-account.test.js`
Expected: PASS. Then re-run the existing webhook suite:
Run: `cd backend && npx vitest run test/ -t webhook`
Expected: PASS (Dentally webhook untouched; legacy GHL token path preserved via fallback).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/webhook.service.js backend/test/webhook-ghl-account.test.js
git commit -m "feat(ghl): per-subaccount webhook routing + practice_id stamping (legacy token fallback)"
```

---

### Task 7: Per-account webhook URL surfaced via service

**Files:**
- Modify: `backend/src/services/ghl-account.service.js` (add `accountWebhookUrl` to the listed accounts)

- [ ] **Step 1: Include the webhook URL in listAccounts output**

The frontend panel needs each account's webhook URL to paste into that GHL location. In `ghl-account.service.js`, change `listAccounts` to decorate each row:
```js
    async listAccounts(orgId) {
        const accounts = await integrationAccountRepository.list(orgId, PROVIDER);
        const base = process.env.BACKEND_PUBLIC_URL || process.env.APP_URL || 'http://localhost:8080';
        return {
            accounts: accounts.map((a) => ({
                ...a,
                webhook_url: a.webhook_token ? `${base}/webhooks/gohighlevel/${a.webhook_token}` : null,
            })),
        };
    },
```
(Note: `webhook_token` IS returned to the owner here — acceptable, it is the webhook credential the owner must paste into GHL, exactly like the existing Dentally `webhook-info` URL contains the signed token.)

- [ ] **Step 2: Syntax-check + test**

Run: `cd backend && npm run typecheck && npx vitest run test/ghl-account.service.test.js`
Expected: passes. (The existing service test asserts `out.secrets` is undefined — `webhook_token`/`webhook_url` ARE allowed; confirm the test does not forbid them. It does not.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/ghl-account.service.js
git commit -m "feat(ghl): surface per-subaccount webhook URL in listAccounts"
```

---

## Phase 2 — Frontend

### Task 8: API client for subaccounts

**Files:**
- Modify: `frontend/features/integrations/api.ts`

- [ ] **Step 1: Add the account types + functions**

Append to `frontend/features/integrations/api.ts`:

```ts
// --- GoHighLevel subaccounts (multi-location) -------------------------------
// Each subaccount = one GHL Location, mapped 1:1 to a practice. Owner-only.
export interface GhlAccount {
  id: string;
  external_account_id: string;     // GHL locationId
  practice_id: string | null;
  label: string | null;
  status: IntegrationStatus;
  last_sync_at: string | null;
  last_error: string | null;
  config: Record<string, unknown>;
  webhook_token: string | null;
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

export function listGhlAccounts() {
  return api<{ accounts: GhlAccount[] }>('/api/integrations/gohighlevel/accounts');
}

export function addGhlAccount(body: { token: string; locationId: string; practiceId?: string | null; label?: string }) {
  return api<GhlAccount>('/api/integrations/gohighlevel/accounts', {
    method: 'POST', body: JSON.stringify(body),
  });
}

export function updateGhlAccount(id: string, body: { practiceId?: string | null; label?: string }) {
  return api<GhlAccount>(`/api/integrations/gohighlevel/accounts/${id}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

export function removeGhlAccount(id: string) {
  return api<{ ok: boolean }>(`/api/integrations/gohighlevel/accounts/${id}`, { method: 'DELETE' });
}

export function syncGhlAccount(id: string, full = false) {
  return api<{ started: boolean; accountId: string; full: boolean }>(
    `/api/integrations/gohighlevel/accounts/${id}/sync${full ? '?full=true' : ''}`,
    { method: 'POST' },
  );
}

export function detectAccountPipelines(id: string) {
  return api<{ pipelines: GhlPipeline[]; error?: string }>(
    `/api/integrations/gohighlevel/accounts/${id}/pipelines`,
  );
}

export function setAccountStageMappings(id: string, mappings: Record<string, string>) {
  return api<{ ok: boolean; stage_mappings: Record<string, string> }>(
    `/api/integrations/gohighlevel/accounts/${id}/stage-mappings`,
    { method: 'POST', body: JSON.stringify({ mappings }) },
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/integrations/api.ts
git commit -m "feat(ghl): frontend api client for subaccount management"
```

---

### Task 9: React Query hooks for subaccounts

**Files:**
- Modify: `frontend/features/integrations/hooks.ts` (read it first to match patterns)

- [ ] **Step 1: Read the existing hooks file**

Run: open `frontend/features/integrations/hooks.ts` and note the React Query patterns (`useQuery`/`useMutation`, the query client invalidation keys, how `usePractices`/`listPractices` is exposed). Match them exactly.

- [ ] **Step 2: Add the hooks**

Append hooks following the file's existing style. Template (adapt names/imports to the file):

```ts
import {
  listGhlAccounts, addGhlAccount, updateGhlAccount, removeGhlAccount,
  syncGhlAccount, detectAccountPipelines, setAccountStageMappings,
} from './api';

export function useGhlAccounts() {
  return useQuery({ queryKey: ['ghl-accounts'], queryFn: listGhlAccounts });
}

export function useAddGhlAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addGhlAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ghl-accounts'] }),
  });
}

export function useUpdateGhlAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; practiceId?: string | null; label?: string }) => updateGhlAccount(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ghl-accounts'] }),
  });
}

export function useRemoveGhlAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeGhlAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ghl-accounts'] }),
  });
}

export function useSyncGhlAccount() {
  return useMutation({ mutationFn: ({ id, full }: { id: string; full?: boolean }) => syncGhlAccount(id, full) });
}
```
(If the file does not already import `useQuery`/`useMutation`/`useQueryClient` from `@tanstack/react-query`, add them. If `usePractices` does not exist yet, add `export function usePractices() { return useQuery({ queryKey: ['practices'], queryFn: listPractices }); }` using the existing `listPractices` from `./api`.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/integrations/hooks.ts
git commit -m "feat(ghl): react-query hooks for subaccounts"
```

---

### Task 10: Subaccount manager panel

Rewrites `GoHighLevelPanel.tsx` into a list of subaccounts (add / map-to-practice / sync / disconnect / webhook URL / per-account stage mapping). The parent Integrations screen currently passes `initialMappings`/`locationId` props; the panel becomes self-fetching, so those props become optional/unused.

**Files:**
- Modify: `frontend/features/integrations/components/GoHighLevelPanel.tsx`
- Modify: the parent screen that renders `<GoHighLevelPanel .../>` (find via grep; drop the now-unused props)
- Create: `frontend/features/integrations/components/GhlAccountRow.tsx`

- [ ] **Step 1: Find the parent + the practices hook**

Run: `cd frontend && grep -rn "GoHighLevelPanel" features app`
Note where it is rendered and what it passes. Confirm a practices list hook/function exists (Task 9 ensures `usePractices`).

- [ ] **Step 2: Write the account-row component**

`frontend/features/integrations/components/GhlAccountRow.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { GhlAccount, PracticeRow } from '../api';
import { useUpdateGhlAccount, useRemoveGhlAccount, useSyncGhlAccount } from '../hooks';

export default function GhlAccountRow({
  account, practices, onSync,
}: {
  account: GhlAccount;
  practices: PracticeRow[];
  onSync: (id: string, full: boolean) => void;
}) {
  const update = useUpdateGhlAccount();
  const remove = useRemoveGhlAccount();
  const sync = useSyncGhlAccount();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const mappedName = practices.find((p) => p.id === account.practice_id)?.name ?? 'Unmapped';

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 4px', fontSize: 13 }}>
        <div style={{ fontWeight: 600 }}>{account.label || 'GoHighLevel'}</div>
        <div className="text-ink-muted" style={{ fontSize: 11, fontFamily: 'monospace' }}>{account.external_account_id}</div>
      </td>
      <td style={{ padding: '8px 4px', width: 220 }}>
        <select
          value={account.practice_id ?? ''}
          onChange={(e) => update.mutate({ id: account.id, practiceId: e.target.value || null })}
          style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'white' }}
        >
          <option value="">Unmapped</option>
          {practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {update.isError && <div style={{ fontSize: 10, color: 'var(--danger)' }}>{(update.error as Error).message}</div>}
      </td>
      <td style={{ padding: '8px 4px', fontSize: 12 }}>
        <span style={{ color: account.status === 'active' ? 'var(--success, #047857)' : 'var(--danger)' }}>{account.status}</span>
        <div className="text-ink-muted" style={{ fontSize: 10 }}>
          {account.last_sync_at ? `synced ${new Date(account.last_sync_at).toLocaleDateString('en-GB')}` : 'never synced'}
        </div>
      </td>
      <td style={{ padding: '8px 4px', fontSize: 11 }}>
        {account.webhook_url
          ? <code style={{ fontSize: 10, wordBreak: 'break-all' }}>{account.webhook_url}</code>
          : <span className="text-ink-muted">—</span>}
      </td>
      <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>
        <button onClick={() => onSync(account.id, false)} style={btn('white')}>Sync</button>{' '}
        {!confirmRemove
          ? <button onClick={() => setConfirmRemove(true)} style={btn('white')}>Disconnect</button>
          : <button onClick={() => remove.mutate(account.id)} style={btn('var(--danger)', 'white')}>Confirm</button>}
      </td>
    </tr>
  );
}

function btn(bg: string, color = 'var(--ink)'): React.CSSProperties {
  return { padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: bg, color, cursor: 'pointer' };
}
```

- [ ] **Step 3: Rewrite the panel**

Replace `frontend/features/integrations/components/GoHighLevelPanel.tsx` with:

```tsx
'use client';
// GoHighLevel subaccount manager. Lists every connected GHL Location (each mapped
// 1:1 to a practice), lets the owner add a subaccount (paste a Private Integration
// Token + Location ID + pick a practice), map/sync/disconnect each, and copy the
// per-subaccount webhook URL to paste into that location's GHL settings.

import { useState } from 'react';
import { useGhlAccounts, useAddGhlAccount, usePractices, useFinishSync } from '../hooks';
import GhlAccountRow from './GhlAccountRow';
import { syncGhlAccount } from '../api';
import SyncOverlay from './SyncOverlay';

export default function GoHighLevelPanel() {
  const { data, isLoading } = useGhlAccounts();
  const practicesQ = usePractices();
  const add = useAddGhlAccount();
  const finishSync = useFinishSync();

  const [showAdd, setShowAdd] = useState(false);
  const [token, setToken] = useState('');
  const [locId, setLocId] = useState('');
  const [practiceId, setPracticeId] = useState('');
  const [syncing, setSyncing] = useState(false);

  const accounts = data?.accounts ?? [];
  const practices = practicesQ.data?.practices ?? [];

  async function submitAdd() {
    if (!token.trim() || !locId.trim()) return;
    await add.mutateAsync({ token: token.trim(), locationId: locId.trim(), practiceId: practiceId || null });
    setToken(''); setLocId(''); setPracticeId(''); setShowAdd(false);
    setSyncing(true); // the new account bootstraps server-side; overlay shows it land
  }

  function onSync(id: string, full: boolean) {
    setSyncing(true);
    syncGhlAccount(id, full).catch(() => {});
  }

  return (
    <div className="card-padded" style={{ marginBottom: 20 }}>
      {syncing && <SyncOverlay provider="gohighlevel" onDone={() => { finishSync(); setSyncing(false); }} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>GoHighLevel subaccounts</h2>
        <button onClick={() => setShowAdd((v) => !v)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', background: 'var(--brand)', color: 'white', cursor: 'pointer' }}>
          {showAdd ? 'Cancel' : 'Add subaccount'}
        </button>
      </div>
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Connect each GoHighLevel location with its own Private Integration Token and map it to a practice.
        Contacts and opportunities sync into that practice, and the practice filter scopes them everywhere.
      </p>

      {showAdd && (
        <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460 }}>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Private Integration Token (pit-…)" style={inp} />
          <input type="text" value={locId} onChange={(e) => setLocId(e.target.value)} placeholder="Location ID" style={inp} />
          <select value={practiceId} onChange={(e) => setPracticeId(e.target.value)} style={inp}>
            <option value="">Map to practice (optional now, required to scope)</option>
            {practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div>
            <button onClick={submitAdd} disabled={!token.trim() || !locId.trim() || add.isPending}
              style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', color: 'white', background: token.trim() && locId.trim() ? 'var(--brand)' : '#9CA3AF', cursor: 'pointer' }}>
              {add.isPending ? 'Validating…' : 'Connect & sync'}
            </button>
            {add.isError && <span style={{ fontSize: 11, color: 'var(--danger)', marginLeft: 10 }}>{(add.error as Error).message}</span>}
          </div>
          <span className="text-ink-muted" style={{ fontSize: 10 }}>The token must be created inside the same GHL sub-account as the Location ID.</span>
        </div>
      )}

      {isLoading ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>Loading subaccounts…</div>
      ) : accounts.length === 0 ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>No subaccounts connected yet. Add one above.</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
              <th style={{ padding: 4 }}>Subaccount</th>
              <th style={{ padding: 4 }}>Practice</th>
              <th style={{ padding: 4 }}>Status</th>
              <th style={{ padding: 4 }}>Webhook URL</th>
              <th style={{ padding: 4 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <GhlAccountRow key={a.id} account={a} practices={practices} onSync={onSync} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 };
```

- [ ] **Step 4: Update the parent screen**

In the parent found in Step 1, change `<GoHighLevelPanel initialMappings={...} locationId={...} />` to `<GoHighLevelPanel />`. Remove now-dead prop computation if it was only feeding the panel. (Keep `usePractices` available app-wide; it is used by the panel.)

- [ ] **Step 5: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: passes. Resolve any unused-import warnings from the old panel (e.g. removed `usePipelines`, `useSetStageMappings`, `useSubmitBrokerKey` usages).

- [ ] **Step 6: Commit**

```bash
git add frontend/features/integrations/components/GoHighLevelPanel.tsx frontend/features/integrations/components/GhlAccountRow.tsx
git add -A frontend/features frontend/app
git commit -m "feat(ghl): subaccount manager panel (add/map/sync/disconnect + webhook URL)"
```

---

### Task 11: Wire CRM screens to the practice scope (subaccount filter)

The repos already filter `contacts`/`leads` by `practice_id`. This task threads the selected practice (`scope` from `useScopePeriod`, where `scope !== 'all'` IS a practiceId) into the CRM list calls so the global selector filters the subaccount everywhere it isn't already.

**Files (read each before editing):**
- `frontend/features/contacts/api.ts` and the Contacts screen component
- `frontend/features/leads/api.ts` and the Leads/Pipeline screen component
- (If the Inbox screen lists per-contact threads) the Inbox screen + its api

- [ ] **Step 1: Inspect current call sites**

Run: `cd frontend && grep -rn "listContacts\|listLeads\|practice_id\|useScopePeriod" features/contacts features/leads features/crm`
Determine: does each list call already accept a `practiceId`/`practice_id` arg? Does the screen already consume `useScopePeriod()`?

- [ ] **Step 2: Add a `practiceId` param to the contacts list call**

In `frontend/features/contacts/api.ts`, find `listContacts(...)`. Add an optional `practiceId` and append it as a query param when set. Pattern (adapt to the real signature):

```ts
export function listContacts(params: { source?: string; practiceId?: string; /* …existing… */ } = {}) {
  const sp = new URLSearchParams();
  if (params.source) sp.set('source', params.source);
  if (params.practiceId) sp.set('practice_id', params.practiceId);
  // …append existing params…
  const qs = sp.toString();
  return api<ContactsResponse>(`/api/contacts${qs ? `?${qs}` : ''}`);
}
```

- [ ] **Step 3: Pass the scope from the Contacts screen**

In the Contacts screen component, read the scope and pass it. Pattern:

```tsx
import { useScopePeriod } from '@/features/_shared/scope-context';
// …inside the component…
const { scope } = useScopePeriod();
const practiceId = scope !== 'all' ? scope : undefined;
// include practiceId in the query key AND the list call:
const { data } = useQuery({
  queryKey: ['contacts', source, practiceId],
  queryFn: () => listContacts({ source, practiceId }),
});
```
(Match the screen's existing React Query usage; the key MUST include `practiceId` so it refetches when the selector changes.)

- [ ] **Step 4: Repeat for Leads/Pipeline**

In `frontend/features/leads/api.ts`, add `practiceId` to `listLeads(...)` the same way (`if (params.practiceId) sp.set('practice_id', params.practiceId)`). In the Leads/Pipeline screen, derive `practiceId = scope !== 'all' ? scope : undefined`, add it to the query key + call.

- [ ] **Step 5: Confirm backend repos honour `practice_id`**

The repos already filter when `practice_id` is provided (`contact.repository.js:21`, `lead.repository.js:23`). Verify the controllers forward the `practice_id` query param into the repo call. Run:
Run: `cd backend && grep -n "practice_id" src/controllers/contact.controller.js src/controllers/lead.controller.js src/repositories/contact.repository.js src/repositories/lead.repository.js`
If a controller does not read `req.query.practice_id` and pass it down, add it (mirror how `source` is forwarded). Keep the change minimal and tenant-safe (it is just an extra `.eq('practice_id', ...)` already implemented in the repo).

- [ ] **Step 6: Typecheck both apps**

Run: `cd frontend && npm run typecheck && npm run lint`
Run: `cd backend && npm run typecheck`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/features backend/src/controllers
git commit -m "feat(ghl): scope Contacts + Leads by selected practice (subaccount filter)"
```

---

### Task 12: Manual verification + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-06-12-ghl-multi-subaccount-design.md` (mark shipped) — optional
- Update: `CLAUDE.md` "Current state" log + a memory note

- [ ] **Step 1: Apply the migration on hosted Supabase**

Apply `20260101000084_integration_accounts.sql` to the hosted project (`mkfhpzjbijbachoonytt`) via the Supabase MCP `apply_migration`, then run `NOTIFY pgrst, 'reload schema';`. Verify the existing GHL connection migrated into one `integration_accounts` row.

- [ ] **Step 2: Manual smoke (local or staging)**

Walk the flow with the running app (`cd backend && npm run dev`, `cd frontend && npm run dev`):
1. Integrations → GoHighLevel → confirm the migrated subaccount appears; map it to a practice.
2. "Add subaccount" → paste a second location's PIT + Location ID + pick a different practice → confirm validation, the row appears, the sync overlay runs.
3. Contacts → select practice A in the scope bar → only that subaccount's contacts show; select practice B → the other set.
4. Leads/Pipeline → same scope check.
5. Copy a subaccount's webhook URL; (optionally) register it in GHL and fire a test event; confirm the contact lands with the right practice.

Record results. If any step fails, file via the systematic-debugging skill — do not patch blind.

- [ ] **Step 3: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all green (previously ~224 tests + the new ones).

- [ ] **Step 4: Update the work log + memory**

Add a bullet to `CLAUDE.md` "Current state" describing multi-subaccount GHL (table `integration_accounts`, per-location PIT, practice mapping, scoped CRM). Write a memory file `ghl-multi-subaccount.md` (type project) summarising the data model + the legacy-webhook-token fallback gotcha, and add its index line to `MEMORY.md`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs
git commit -m "docs(ghl): record multi-subaccount feature + hosted migration applied"
```

---

## Self-review notes (addressed)

- **Spec coverage:** schema (T1), repo (T2), service add/list/update/remove (T3), sync+practice stamp+worker (T4), routes/controller/docs (T5), webhook routing (T6), webhook URL surface (T7), frontend api/hooks/panel (T8–T10), filter wiring (T11), migration/backfill (T1 + T12), RBAC (owner-only routes T5), tests throughout. All spec sections map to a task.
- **Type/name consistency:** `syncAccount`/`bootstrapAccount`/`detectPipelinesForToken`/`fetchLocation` defined in Task 3–4 and consumed in Task 5–6; `integrationAccountRepository` method names (`getByIdWithSecrets`, `getByWebhookToken`, `markSynced`, `markFailed`, `mergeConfig`, `listAllActive`) defined in T2 and used in T4/T6; `GhlAccount`/`webhook_url` defined T8 and used T10.
- **Ordering risk:** the literal `/gohighlevel/accounts` routes must register before the `/:provider/*` param routes (called out in T5 Step 3).
- **Back-compat:** old `syncOneOrg` + the legacy signed webhook token both still work (fallback in T6); single-account providers untouched.
