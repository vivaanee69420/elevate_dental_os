# GoHighLevel Multi-Subaccount Connect + Practice-Scoped Filtering

**Date:** 2026-06-12
**Status:** Design — pending implementation plan
**Owner:** ruhith

## Problem

The owner runs several GoHighLevel (GHL / LeadConnector) subaccounts (one GHL **Location** per dental practice). Today Elevate connects exactly one GHL location per organisation — `integrations` has `UNIQUE (organisation_id, provider)`. We need to:

1. Connect **multiple** GHL subaccounts to a single org, each via its own GHL **Private Integration Token (PIT)** + Location ID.
2. Map each subaccount **1:1 to an existing practice**.
3. Tag every synced contact/lead with the originating subaccount's `practice_id`.
4. Let the existing global scope selector filter the whole app (CRM + dashboards) by subaccount — which, because subaccount = practice, is the practice scope already in place.

## Key existing-code facts (verified)

- `integrations` table: `UNIQUE (organisation_id, provider)` — one row per provider per org (`supabase/migrations/20260101000008_integrations.sql:26`). Secrets encrypted in `secrets BYTEA`; OAuth/PIT config in `config JSONB`.
- GHL connector already supports a **paste-key (PIT) path**: `submitBrokerKey()` posts `apiKey` + `locationId` (`frontend/features/integrations/api.ts:59`; `gohighlevel-provider.js:127` `callback()`). PITs are per-location and **non-expiring** (no refresh token).
- `contacts.practice_id` and `leads.practice_id` **already exist** (FK to `practices`, indexed — `supabase/migrations/20260101000001_schema.sql:181,217`). Repos filter by `practice_id` when provided (`contact.repository.js:21`, `lead.repository.js:23`).
- A **global scope selector already exists**: `ScopePeriodBar` + `scope-context.tsx` store `scope = 'all' | practiceId` in URL search params; analytics screens follow `useScopePeriod()`. Most screens pass `&practice_id=<id>`.
- `practices` has `pms_site_id` (Dentally link) but **no GHL location link** today.
- Sync entry points: `gohighlevel-sync.js` (`bootstrapOnConnect`, `contactRow`, `upsertContact`, `upsertOpportunity`, `applyWebhookEvent`); worker `syncAllOrgs()`. Webhook: `/webhooks/gohighlevel/:token` → `webhook.service.js:168`.
- All `/api/integrations` routes are owner-only RBAC.

## Approach

**Chosen: new `integration_accounts` child table** (one row per GHL location), each holding its own encrypted PIT, `practice_id` mapping, status, and webhook token. The existing single `integrations` GHL row remains a lightweight "connected" presence marker for the integrations list / gating. Single-account providers (Dentally, Xero) are untouched.

Rejected:
- **Multi-row `integrations`** (drop the unique constraint): forces every single-row `getByProvider(org,'gohighlevel')` caller (webhook verify, syncNow, refresh, status) to become list-and-iterate, touching shared code with regression risk for single-account providers.
- **JSON array of locations in one row**: a single `secrets BYTEA` cannot cleanly hold N tokens; no per-account status/sync/webhook.

Because GHL PITs are per-location and independent, a dedicated child table models the relationship exactly.

## Design

### 1. Schema — `integration_accounts`

New migration `supabase/migrations/20260101000080_integration_accounts.sql` (renumber to next free slot at implementation time):

```sql
create table if not exists integration_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  provider text not null,                -- 'gohighlevel'
  external_account_id text not null,     -- GHL locationId
  practice_id uuid references practices(id) on delete set null,
  label text,                            -- GHL location name
  secrets bytea,                         -- encrypted Private Integration Token (lib/crypto.js)
  config jsonb not null default '{}',    -- per-account stage_mappings, companyId, etc
  status text not null default 'active', -- active | failed | revoked
  webhook_token text,                    -- random, per-account
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organisation_id, provider, external_account_id)
);
create index if not exists idx_integration_accounts_org_provider
  on integration_accounts(organisation_id, provider);
create unique index if not exists idx_integration_accounts_practice
  on integration_accounts(organisation_id, practice_id)
  where practice_id is not null and provider = 'gohighlevel';
create unique index if not exists idx_integration_accounts_webhook_token
  on integration_accounts(webhook_token) where webhook_token is not null;
```

RLS + org isolation follow the repo convention (serviceClient + manual `.eq('organisation_id', orgId)`). After hosted DDL: `NOTIFY pgrst, 'reload schema';`.

The unique partial index on `(organisation_id, practice_id)` enforces the 1 subaccount : 1 practice rule.

### 2. Backend — repository + service + routes

**Repository** `integration-account.repository.js` (new):
- `list(orgId, provider)` — rows without secrets.
- `getById(orgId, id)` / `getByLocation(orgId, provider, locationId)` / `getByWebhookToken(token)`.
- `insert(orgId, {provider, locationId, practiceId, label, secrets, webhookToken})`.
- `update(orgId, id, patch)` — practice_id, label, config (merge), status, last_sync_at, last_error.
- `markRevoked(orgId, id)` — status='revoked', null secrets.
All carry `organisation_id` in the filter.

**Service** additions to `integration.service.js` (or a focused `ghl-account.service.js`):
- `listAccounts(orgId)` → list + each account's mapped practice.
- `addAccount(orgId, {token, locationId, practiceId, label})`:
  1. Validate token by calling GHL `GET /locations/{locationId}` with the PIT; reject on failure.
  2. Reject if location already connected for org, or practice already mapped.
  3. Encrypt PIT (`crypto.js`), mint random `webhook_token`, insert row.
  4. Ensure the org's `integrations` GHL marker row is `active`.
  5. Fire `bootstrapOnConnect(account)` (first pull, scoped to this location, recent window per existing connect policy).
- `updateAccount(orgId, id, {practiceId?, label?})` — re-check practice uniqueness.
- `removeAccount(orgId, id)` — markRevoked; if it was the last active account, optionally mark the `integrations` marker revoked. **Do not** delete contacts/leads (keep history; they retain `practice_id`).
- `syncAccount(orgId, id)` — run incremental sync for one account.
- `detectPipelines(orgId, id)` / `setStageMappings(orgId, id, mappings)` — per-account, persisted into that account row's `config`.

**Routes** (`integrations.routes.js`, owner-only via `requireRole('owner')`), namespaced for GHL:
- `GET    /api/integrations/gohighlevel/accounts`
- `POST   /api/integrations/gohighlevel/accounts`            `{ token, locationId, practiceId, label? }`
- `PATCH  /api/integrations/gohighlevel/accounts/:id`        `{ practiceId?, label? }`
- `DELETE /api/integrations/gohighlevel/accounts/:id`
- `POST   /api/integrations/gohighlevel/accounts/:id/sync`
- `POST   /api/integrations/gohighlevel/accounts/:id/pipelines`
- `POST   /api/integrations/gohighlevel/accounts/:id/stage-mappings`

Secrets are never serialised to the client. Update `docs/API.md` for new endpoints.

### 3. Sync routing — `gohighlevel-sync.js`

- Refactor the entry functions (`bootstrapOnConnect`, sync, `detectPipelines`, `applyWebhookEvent`) to take an **account row** (its decrypted PIT + `external_account_id` as locationId + `config`) instead of the single org `integration`.
- `contactRow()` and `upsertOpportunity()` **stamp `practice_id = account.practice_id`** on every row written.
- Contact/lead uniqueness keys stay `(organisation_id, ghl_contact_id)` / `(organisation_id, ghl_opportunity_id)` — a person appearing in two locations yields two rows with different `practice_id`, which is correct for per-practice scoping.
- Worker `syncAllOrgs()` (and the one-shot `ghl-sync-once.js`) iterate **all active `integration_accounts`** for each org rather than one integration per org.

### 4. Webhook routing

- Route unchanged: `POST /webhooks/gohighlevel/:token` (public).
- `webhook.service.js` resolves the account via **`getByWebhookToken(:token)`** (random per-account token, constant-time compare) → yields `{organisation_id, account}` → `applyWebhookEvent(account, event)` stamps that account's `practice_id`.
- Each subaccount has its own webhook URL (`/webhooks/gohighlevel/<account.webhook_token>`); the panel surfaces the per-account URL to paste into that GHL location's webhook settings (PIT is read-only for webhook registration — same manual pattern as today).

### 5. Frontend

**Integrations panel** `GoHighLevelPanel.tsx` → subaccount manager:
- Table of connected subaccounts: label · location id · **mapped practice (editable dropdown)** · status · last sync · per-account webhook URL · actions [Sync][Reconnect][Disconnect].
- **"Add subaccount"** form: Private Integration Token + Location ID + practice picker → `POST /accounts`.
- Stage-mapping UI keyed per account.
- `frontend/features/integrations/api.ts`: add `listGhlAccounts`, `addGhlAccount`, `updateGhlAccount`, `removeGhlAccount`, `syncGhlAccount`, per-account `detectPipelines`/`setStageMappings`.

**Filtering ("everywhere")** — reuse the existing global scope selector:
- No new selector. Selecting a practice in `ScopePeriodBar` = selecting a subaccount (1:1).
- Ensure CRM screens — **Contacts, Leads/Pipeline, Inbox** — read `useScopePeriod()` and pass `practice_id` to their `api.ts` when `scope !== 'all'`. Repos already filter by `practice_id`; this is frontend param wiring (+ verify the Inbox/Pipeline paths thread it).
- Optional nicety: show the subaccount/location label on the practice pill. Deferred.
- BusinessHub stays org-wide (PracticeTabs already drills client-side) — out of scope.

### 6. Migration / backfill (in the new migration, idempotent)

1. Create `integration_accounts` (above).
2. For each org with an existing GHL `integrations` row: insert one `integration_accounts` row copying its `secrets`, `config`, and `config.locationId` into `external_account_id`. Set `practice_id` = the org's sole practice if exactly one exists, else null (owner maps later in UI). Mint `webhook_token`.
3. Backfill data tables where the practice is resolved:
   `update contacts set practice_id = <acct.practice_id> where organisation_id = <org> and source = 'gohighlevel' and practice_id is null;` — same for `leads` (by `ghl_opportunity_id is not null`).
4. `NOTIFY pgrst, 'reload schema';`.

### 7. RBAC / security

- All manage routes `requireRole('owner')` (matches existing integrations gating).
- PIT encrypted at rest via `crypto.js`; never returned to the client.
- Validate the PIT against GHL on add; reject invalid token/location.
- `webhook_token` is random per account; lookup uses constant-time compare; reject revoked accounts.
- Every query carries `organisation_id` (serviceClient + manual filter, per repo convention).
- Audit all mutations to `audit_log` (existing `audit` middleware).

### 8. Testing (vitest, `backend/test`)

- `addAccount` validates + encrypts; rejects invalid token, duplicate location, already-mapped practice.
- Sync stamps the correct `practice_id` on contacts and leads for a given account.
- Webhook lookup by `webhook_token` resolves the correct account → correct `practice_id`; unknown/revoked token rejected.
- Cross-org isolation: an org cannot list/add/update/delete another org's account.
- `removeAccount` revokes + nulls secrets, leaves contacts/leads intact.
- Update existing GHL sync + webhook tests to pass an account row.

## Out of scope

- Migrating Dentally/Xero to multi-account (they remain single per org).
- Subaccount dimension independent of practice (we chose 1:1 = practice).
- Backend-scoping BusinessHub by practice_id (client-side PracticeTabs already covers it).
- Automatic GHL webhook registration (PIT is read-only for webhook write; manual paste per location).

## Open items resolved during design

- Subaccount ↔ practice: **1:1 mapping** (each GHL location = one practice).
- Filter surface: **everywhere**, via the existing practice scope selector (no new global control).
- Credential storage: **child table**, not multi-row `integrations`.
