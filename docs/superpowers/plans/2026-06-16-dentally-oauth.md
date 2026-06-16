# Dentally OAuth Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner connect Dentally via OAuth2 ("Connect with Dentally") alongside the existing paste-API-key path, with one integrations row per org and the single existing sync path.

**Architecture:** Replace the Dentally `makeBroker` registration with a dedicated hybrid `dentally-provider.js` (registerProvider) that handles BOTH key-paste and OAuth, branching on intent in `authorize` and on payload shape in `callback`. The sync layer resolves credentials through a new `resolveDentallyAuth` that returns the API-key bearer unchanged or refreshes a stale OAuth access token (claimRefresh race guard, same as Xero/GHL). Backfill pagers get a one-shot 401→refresh→retry guard. All generic OAuth scaffolding (public `/oauth/:provider/callback`, signed state, `upsertSecrets`, `claimRefresh`, `expires_at`) already exists and is reused.

**Tech Stack:** Node ESM (backend), Express, Zod, Supabase (`integrations` table), Vitest; Next.js 14 + React Query (frontend).

**Spec:** `docs/superpowers/specs/2026-06-16-dentally-oauth-design.md`

---

## File Structure

- **Create** `backend/src/lib/integrations/dentally-provider.js` — hybrid Dentally provider (authorize/callback/refresh/revoke), registers `dentally`.
- **Modify** `backend/src/lib/integrations/broker-provider.js` — drop the `makeBroker('dentally', …)` line (SOE stays).
- **Modify** `backend/src/lib/integrations/index.js` — ensure `dentally-provider.js` is imported so it registers (replace/augment the broker import for dentally).
- **Modify** `backend/src/lib/integrations/dentally-sync.js` — replace `authHeader` with async `resolveDentallyAuth`; add `dentallyFetchWithRefresh` 401 guard; reroute backfill pagers; update entry call sites.
- **Modify** `backend/src/models/integration.model.js` — add optional `method` to `integrationConnectSchema`.
- **Modify** `backend/.env` (and document for prod) — uncomment Dentally OAuth env.
- **Modify** `frontend/features/integrations/api.ts` — add `method` to `ConnectInput`.
- **Modify** `frontend/features/system/components/IntegrationsScreen.tsx` — "Use API key instead" affordance for Dentally.
- **Create** `backend/test/dentally-provider.test.mjs` — authorize/callback/refresh unit tests.
- **Create** `backend/test/dentally-auth-resolve.test.mjs` — `resolveDentallyAuth` + 401 guard tests.
- **Modify** `docs/API.md` — note the Dentally OAuth connect path (reuses the generic endpoints).

### Dentally OAuth facts (from `.env`)
- `DENTALLY_CLIENT_ID` / `DENTALLY_CLIENT_SECRET` — present.
- Authorize: `${DENTALLY_AUTH_BASE}/oauth/authorize`, token: `${DENTALLY_AUTH_BASE}/oauth/token`, default `DENTALLY_AUTH_BASE=https://login.dentally.co`.
- Redirect URI (registered): `https://elevatedentalos-production.up.railway.app/oauth/dentally/callback` = `${BACKEND_PUBLIC_URL}/oauth/dentally/callback`. Must match byte-for-byte.
- Optional `DENTALLY_SCOPES` (space-separated); omit `scope` param when unset.

### Reference implementation
`backend/src/lib/integrations/xero-provider.js` is the OAuth2-with-rotating-refresh template (basicAuth, signState, persistTokenResponse, claimRefresh, clearRefresh). Mirror its structure.

---

## Task 1: Connect schema — `method` field

**Files:**
- Modify: `backend/src/models/integration.model.js:5-9`
- Test: `backend/test/dentally-provider.test.mjs` (created here, expanded in Task 2)

- [ ] **Step 1: Write the failing test**

Create `backend/test/dentally-provider.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { integrationConnectSchema } from '../src/models/integration.model.js';

describe('integrationConnectSchema.method', () => {
  it('accepts method oauth/key and defaults to undefined', () => {
    expect(integrationConnectSchema.parse({ provider: 'dentally', method: 'oauth' }).method).toBe('oauth');
    expect(integrationConnectSchema.parse({ provider: 'dentally', method: 'key' }).method).toBe('key');
    expect(integrationConnectSchema.parse({ provider: 'dentally' }).method).toBeUndefined();
  });
  it('rejects an unknown method', () => {
    expect(() => integrationConnectSchema.parse({ provider: 'dentally', method: 'nope' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/dentally-provider.test.mjs -t "method"`
Expected: FAIL — `method` is stripped (Zod strips unknown keys), so `.method` is `undefined` for the oauth case and the reject case does not throw.

- [ ] **Step 3: Add the field**

In `backend/src/models/integration.model.js`, inside `integrationConnectSchema` (the object with `provider`, `redirect_url`, `apiKey`, `baseUrl`), add:

```js
    method: zod_1.z.enum(['oauth', 'key']).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/dentally-provider.test.mjs -t "method"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/integration.model.js backend/test/dentally-provider.test.mjs
git commit -m "feat(integrations): add method field to connect schema for Dentally OAuth"
```

---

## Task 2: Dentally provider module (authorize / callback / refresh)

**Files:**
- Create: `backend/src/lib/integrations/dentally-provider.js`
- Modify: `backend/src/lib/integrations/broker-provider.js:42-43`
- Modify: `backend/src/lib/integrations/index.js`
- Test: `backend/test/dentally-provider.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/dentally-provider.test.mjs`:

```js
import { vi, beforeEach } from 'vitest';
import { DentallyProvider } from '../src/lib/integrations/dentally-provider.js';
import { integrationRepository } from '../src/repositories/integration.repository.js';
import { decryptSecret } from '../src/lib/crypto.js';

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.DENTALLY_CLIENT_ID = 'cid';
  process.env.DENTALLY_CLIENT_SECRET = 'csecret';
  process.env.OAUTH_STATE_SECRET = 'state-secret-state-secret-32chars!';
  process.env.BACKEND_PUBLIC_URL = 'https://app.example.com';
  delete process.env.DENTALLY_SCOPES;
});

describe('DentallyProvider.authorize', () => {
  it('returns requiresKeyPaste when method=key', async () => {
    vi.spyOn(integrationRepository, 'upsert').mockResolvedValue({});
    const res = await DentallyProvider.authorize('org1', { method: 'key' });
    expect(res.requiresKeyPaste).toBe(true);
    expect(res.redirectUrl).toBeUndefined();
  });

  it('returns a Dentally redirectUrl when method=oauth (default)', async () => {
    vi.spyOn(integrationRepository, 'upsert').mockResolvedValue({});
    const res = await DentallyProvider.authorize('org1', {});
    const url = new URL(res.redirectUrl);
    expect(url.origin + url.pathname).toBe('https://login.dentally.co/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/oauth/dentally/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.has('scope')).toBe(false); // no DENTALLY_SCOPES set
  });

  it('throws "not configured" when client id missing', async () => {
    delete process.env.DENTALLY_CLIENT_ID;
    await expect(DentallyProvider.authorize('org1', {})).rejects.toThrow(/not configured/i);
  });
});

describe('DentallyProvider.callback', () => {
  it('exchanges a code and persists encrypted tokens + expires_at', async () => {
    let saved;
    vi.spyOn(integrationRepository, 'upsertSecrets').mockImplementation(async (_o, _p, row) => { saved = row; });
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'Bearer', expires_in: 7200, scope: 'read' }),
    });
    const res = await DentallyProvider.callback('org1', { code: 'abc' });
    expect(res.ok).toBe(true);
    const secrets = JSON.parse(decryptSecret(saved.secrets));
    expect(secrets.access_token).toBe('AT');
    expect(secrets.refresh_token).toBe('RT');
    expect(saved.status).toBe('active');
    expect(new Date(saved.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('persists an apiKey when payload carries apiKey (key path, expires_at null)', async () => {
    let saved;
    vi.spyOn(integrationRepository, 'upsertSecrets').mockImplementation(async (_o, _p, row) => { saved = row; });
    await DentallyProvider.callback('org1', { apiKey: 'KEY123' });
    const secrets = JSON.parse(decryptSecret(saved.secrets));
    expect(secrets.apiKey).toBe('KEY123');
    expect(saved.expires_at).toBeNull();
  });

  it('throws when neither code nor apiKey provided', async () => {
    await expect(DentallyProvider.callback('org1', {})).rejects.toThrow(/code or apiKey/i);
  });

  it('marks failed on a token-exchange error', async () => {
    vi.spyOn(integrationRepository, 'markFailed').mockResolvedValue();
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid_grant' }) });
    await expect(DentallyProvider.callback('org1', { code: 'bad' })).rejects.toThrow(/invalid_grant|exchange/i);
    expect(integrationRepository.markFailed).toHaveBeenCalled();
  });
});

describe('DentallyProvider.refresh', () => {
  it('skips when the refresh is already claimed', async () => {
    vi.spyOn(integrationRepository, 'claimRefresh').mockResolvedValue(false);
    const res = await DentallyProvider.refresh('org1');
    expect(res.skipped).toBeTruthy();
  });

  it('is a no-op for an apiKey row', async () => {
    vi.spyOn(integrationRepository, 'claimRefresh').mockResolvedValue(true);
    vi.spyOn(integrationRepository, 'clearRefresh').mockResolvedValue();
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      secrets: (await import('../src/lib/crypto.js')).encryptSecret(JSON.stringify({ apiKey: 'K' })),
    });
    const res = await DentallyProvider.refresh('org1');
    expect(res.ok).toBe(true);
  });

  it('rotates the token pair on success', async () => {
    const { encryptSecret } = await import('../src/lib/crypto.js');
    let saved;
    vi.spyOn(integrationRepository, 'claimRefresh').mockResolvedValue(true);
    vi.spyOn(integrationRepository, 'clearRefresh').mockResolvedValue();
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      secrets: encryptSecret(JSON.stringify({ access_token: 'OLD', refresh_token: 'OLDRT' })),
      config: {},
    });
    vi.spyOn(integrationRepository, 'upsertSecrets').mockImplementation(async (_o, _p, row) => { saved = row; });
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'NEW', refresh_token: 'NEWRT', token_type: 'Bearer', expires_in: 7200 }),
    });
    await DentallyProvider.refresh('org1');
    const secrets = JSON.parse(decryptSecret(saved.secrets));
    expect(secrets.access_token).toBe('NEW');
    expect(secrets.refresh_token).toBe('NEWRT');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/dentally-provider.test.mjs`
Expected: FAIL — `dentally-provider.js` does not exist (import error).

- [ ] **Step 3: Create the provider module**

Create `backend/src/lib/integrations/dentally-provider.js`:

```js
// Dentally provider — hybrid key-or-OAuth2.
//
//   authorize(method:'key')  -> { requiresKeyPaste } (paste an API token)
//   authorize(method:'oauth') -> { redirectUrl } to Dentally consent
//   callback({code})         -> exchange + persist {access_token, refresh_token}
//   callback({apiKey})       -> persist the long-lived API token (no refresh)
//   refresh()                -> rotate the access token (single-use refresh token,
//                               claimRefresh race guard like Xero/GHL)
//
// Dentally runs a Doorkeeper OAuth2 server. Access tokens live ~2h; refresh
// tokens rotate (a new one each refresh), so we claim the row before refreshing.

import { registerProvider } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

const PASTE_HINT = 'Paste your Dentally Bearer token from Dentally → Settings → API.';

function authBase() { return process.env.DENTALLY_AUTH_BASE || 'https://login.dentally.co'; }
function authorizeUrl() { return `${authBase()}/oauth/authorize`; }
function tokenUrl() { return `${authBase()}/oauth/token`; }
function backendUrl() { return process.env.BACKEND_PUBLIC_URL || 'http://localhost:8080'; }
function redirectUri() { return `${backendUrl()}/oauth/dentally/callback`; }

async function persistTokenResponse(orgId, body) {
  return integrationsRepository.upsertSecrets(orgId, 'dentally', {
    config: { token_type: body.token_type, scope: body.scope ?? null },
    secrets: encryptSecret(JSON.stringify({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    })),
    status: 'active',
    verified_at: new Date().toISOString(),
    scopes: body.scope ? body.scope.split(' ') : null,
    expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
  });
}

async function exchange(orgId, params) {
  const { DENTALLY_CLIENT_ID, DENTALLY_CLIENT_SECRET } = process.env;
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: DENTALLY_CLIENT_ID,
      client_secret: DENTALLY_CLIENT_SECRET,
      ...params,
    }).toString(),
  });
  const body = await res.json();
  if (!res.ok) {
    await integrationsRepository.markFailed(orgId, 'dentally', body.error_description ?? body.error ?? 'oauth_failed');
    throw new Error(body.error_description ?? body.error ?? 'Dentally OAuth exchange failed');
  }
  return body;
}

export const DentallyProvider = {
  async authorize(orgId, extra = {}) {
    if (extra.method === 'key') {
      await integrationsRepository.upsert(orgId, 'dentally', { status: 'pending' });
      return { requiresKeyPaste: true, pasteHint: PASTE_HINT };
    }
    if (!process.env.DENTALLY_CLIENT_ID) throw new Error('DENTALLY_CLIENT_ID is not configured');
    const { signState } = await import('../oauth-state.js');
    const state = signState({ orgId, provider: 'dentally' });
    const url = new URL(authorizeUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', process.env.DENTALLY_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('state', state);
    if (process.env.DENTALLY_SCOPES) url.searchParams.set('scope', process.env.DENTALLY_SCOPES);
    await integrationsRepository.upsert(orgId, 'dentally', { status: 'pending' });
    return { redirectUrl: url.toString() };
  },

  async callback(orgId, payload = {}) {
    if (payload.code) {
      const body = await exchange(orgId, {
        grant_type: 'authorization_code',
        code: payload.code,
        redirect_uri: redirectUri(),
      });
      await persistTokenResponse(orgId, body);
      return { ok: true };
    }
    if (payload.apiKey) {
      await integrationsRepository.upsertSecrets(orgId, 'dentally', {
        config: payload.baseUrl ? { base_url: payload.baseUrl } : {},
        secrets: encryptSecret(JSON.stringify({ apiKey: payload.apiKey })),
        status: 'active',
        verified_at: new Date().toISOString(),
        expires_at: null,
      });
      return { ok: true };
    }
    throw new Error('authorization code or apiKey required');
  },

  async refresh(orgId) {
    const claimed = await integrationsRepository.claimRefresh(orgId, 'dentally');
    if (!claimed) return { skipped: 'refresh_in_progress' };
    try {
      const integration = await integrationsRepository.getByProvider(orgId, 'dentally');
      if (!integration?.secrets) throw new Error('No stored credentials to refresh');
      const parsed = JSON.parse(decryptSecret(integration.secrets));
      if (parsed.apiKey) return { ok: true };              // key path never refreshes
      if (!parsed.refresh_token) throw new Error('No refresh_token stored');
      const body = await exchange(orgId, { grant_type: 'refresh_token', refresh_token: parsed.refresh_token });
      await persistTokenResponse(orgId, body);
      return { ok: true };
    } finally {
      await integrationsRepository.clearRefresh(orgId, 'dentally');
    }
  },

  async revoke(orgId) {
    await integrationsRepository.markRevoked(orgId, 'dentally');
    return { ok: true };
  },

  async webhook() { return { received: true }; },

  async sync(orgId) {
    const { syncOneOrg } = await import('./dentally-sync.js');
    return syncOneOrg(orgId);
  },
};

registerProvider(
  { id: 'dentally', label: 'Dentally', authStyle: 'oauth_or_key', category: 'pms' },
  DentallyProvider,
);
```

- [ ] **Step 4: Remove the Dentally broker registration & ensure the new module loads**

In `backend/src/lib/integrations/broker-provider.js`, delete the Dentally line (keep SOE):

```js
// DELETE these two lines:
makeBroker('dentally', 'Dentally', 'pms',
    'Paste your Dentally Bearer token from Dentally → Settings → API.');
```

In `backend/src/lib/integrations/index.js`, add an import so the new provider self-registers (place beside the other provider imports, e.g. xero-provider):

```js
import './dentally-provider.js';
```

(If `index.js` imports `broker-provider.js` for side effects, keep that import — SOE still needs it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/dentally-provider.test.mjs`
Expected: PASS (all describe blocks)

- [ ] **Step 6: Verify the provider registry still resolves dentally**

Run: `cd backend && node -e "import('./src/lib/integrations/index.js').then(async()=>{const {getProvider}=await import('./src/lib/integrations/provider-interface.js');console.log(getProvider('dentally').meta.authStyle, getProvider('soe').meta.authStyle);})"`
Expected: prints `oauth_or_key broker_key`

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/integrations/dentally-provider.js backend/src/lib/integrations/broker-provider.js backend/src/lib/integrations/index.js backend/test/dentally-provider.test.mjs
git commit -m "feat(integrations): hybrid Dentally provider (OAuth2 + API key)"
```

---

## Task 3: Sync credential resolution — `resolveDentallyAuth`

**Files:**
- Modify: `backend/src/lib/integrations/dentally-sync.js` (replace `authHeader` at :93-100; update entry call sites at :263, :840, :1260, and every other `authHeader(...)` caller)
- Test: `backend/test/dentally-auth-resolve.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `backend/test/dentally-auth-resolve.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDentallyAuth } from '../src/lib/integrations/dentally-sync.js';
import { integrationRepository } from '../src/repositories/integration.repository.js';
import { DentallyProvider } from '../src/lib/integrations/dentally-provider.js';
import { encryptSecret } from '../src/lib/crypto.js';

beforeEach(() => vi.restoreAllMocks());

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 1000).toISOString();

describe('resolveDentallyAuth', () => {
  it('returns the apiKey bearer and never refreshes', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    const integ = { organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ apiKey: 'K' })), expires_at: null };
    expect(await resolveDentallyAuth('o1', integ)).toBe('Bearer K');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns the OAuth bearer without refresh when the token is fresh', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    const integ = { organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'AT' })), expires_at: future() };
    expect(await resolveDentallyAuth('o1', integ)).toBe('Bearer AT');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes a stale OAuth token then returns the new bearer', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'NEW' })), expires_at: future(),
    });
    const integ = { organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'OLD' })), expires_at: past() };
    expect(await resolveDentallyAuth('o1', integ)).toBe('Bearer NEW');
    expect(refresh).toHaveBeenCalledWith('o1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/dentally-auth-resolve.test.mjs`
Expected: FAIL — `resolveDentallyAuth` is not exported.

- [ ] **Step 3: Replace `authHeader` with `resolveDentallyAuth`**

In `backend/src/lib/integrations/dentally-sync.js`, ensure the repository is imported (add near the `decryptSecret` import at the top if missing):

```js
import { integrationRepository } from "../../repositories/integration.repository.js";
```

Replace the `authHeader` function (lines 93-100) with:

```js
// Refresh ~5 min before the OAuth token's stated expiry to avoid mid-call 401s.
function tokenStale(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() >= new Date(expiresAt).getTime() - 5 * 60 * 1000;
}

// Resolve the Authorization header for a Dentally integration row.
//   apiKey path  -> Bearer <apiKey> (long-lived, never refreshed)
//   OAuth path   -> Bearer <access_token>, refreshing first if near expiry
export async function resolveDentallyAuth(orgId, integration) {
  let parsed;
  try { parsed = JSON.parse(decryptSecret(integration.secrets)); } catch { return null; }
  if (parsed.apiKey) return `Bearer ${parsed.apiKey}`;
  if (!parsed.access_token) return null;
  if (tokenStale(integration.expires_at)) {
    const { DentallyProvider } = await import('./dentally-provider.js');
    await DentallyProvider.refresh(orgId);
    const fresh = await integrationRepository.getByProvider(orgId, 'dentally');
    if (fresh?.secrets) {
      try { parsed = JSON.parse(decryptSecret(fresh.secrets)); } catch { /* keep old */ }
    }
  }
  return parsed.access_token ? `Bearer ${parsed.access_token}` : null;
}
```

- [ ] **Step 4: Update every `authHeader(...)` caller**

Find them: `cd backend && grep -n "authHeader(" src/lib/integrations/dentally-sync.js`

For EACH call site, replace the synchronous call with the async resolver, using the `orgId` already in scope at that function. Concretely:

- Line ~263 in `detectSiteIds(orgId, integration)`:
  `const auth = authHeader(integration.secrets);` → `const auth = await resolveDentallyAuth(orgId, integration);`
- Line ~840 in `syncPractitionersOnly(orgId, integration)`:
  `const auth = authHeader(integration.secrets);` → `const auth = await resolveDentallyAuth(orgId, integration);`
- Line ~1260 in `getWebhookHealth(orgId, integration)` (variable may be `integ`):
  `const auth = authHeader(integ.secrets);` → `const auth = await resolveDentallyAuth(orgId, integ);`
- Every other `const auth = authHeader(<x>.secrets);` (the main sync + backfill entries): apply the same replacement, using that function's `orgId` param and its integration variable.

Each enclosing function is already `async`, so `await` is valid. After editing, confirm none remain:

Run: `cd backend && grep -n "authHeader" src/lib/integrations/dentally-sync.js`
Expected: no matches.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/dentally-auth-resolve.test.mjs test/dentally-sync.test.mjs test/dentally-webhook-health.test.js`
Expected: PASS (new resolver tests + existing sync/webhook tests unbroken)

- [ ] **Step 6: Syntax check the whole sync file**

Run: `cd backend && node --check src/lib/integrations/dentally-sync.js`
Expected: no output (valid)

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/integrations/dentally-sync.js backend/test/dentally-auth-resolve.test.mjs
git commit -m "feat(integrations): resolveDentallyAuth — refresh OAuth tokens in the sync path"
```

---

## Task 4: Backfill 401 guard — `dentallyFetchWithRefresh`

**Files:**
- Modify: `backend/src/lib/integrations/dentally-sync.js` (add helper; reroute the long backfill pager fetches)
- Test: `backend/test/dentally-auth-resolve.test.mjs` (append)

The inner pagers receive `auth` as a string and `orgId` (not the integration row). The guard refreshes via `orgId`, re-resolves through `getByProvider`, returns the possibly-new bearer so the loop adopts it for later pages.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/dentally-auth-resolve.test.mjs`:

```js
import { dentallyFetchWithRefresh } from '../src/lib/integrations/dentally-sync.js';

describe('dentallyFetchWithRefresh', () => {
  it('refreshes once on a 401 then retries with the new bearer', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'NEW' })), expires_at: future(),
    });
    let call = 0;
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      call += 1;
      return call === 1 ? { status: 401, ok: false } : { status: 200, ok: true };
    });
    const { res, auth } = await dentallyFetchWithRefresh('o1', 'Bearer OLD', 'https://api.dentally.co/v1/x');
    expect(res.status).toBe(200);
    expect(auth).toBe('Bearer NEW');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not refresh on a 200', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    vi.spyOn(global, 'fetch').mockResolvedValue({ status: 200, ok: true });
    const { res, auth } = await dentallyFetchWithRefresh('o1', 'Bearer OLD', 'https://api.dentally.co/v1/x');
    expect(res.status).toBe(200);
    expect(auth).toBe('Bearer OLD');
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/dentally-auth-resolve.test.mjs -t "dentallyFetchWithRefresh"`
Expected: FAIL — helper not exported.

- [ ] **Step 3: Add the helper**

In `backend/src/lib/integrations/dentally-sync.js`, near `resolveDentallyAuth`, add (reuse the file's existing `fetchWithTimeout` and `USER_AGENT`):

```js
// One-shot 401 guard for long backfill pagers. On a 401, refresh the OAuth
// token once, re-resolve the bearer, and retry. Returns { res, auth } so the
// caller adopts the (possibly refreshed) bearer for subsequent pages. A second
// 401 (e.g. a genuinely revoked token) is returned as-is for the caller to surface.
export async function dentallyFetchWithRefresh(orgId, auth, url, extraHeaders = {}) {
  const headers = { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json', ...extraHeaders };
  let res = await fetchWithTimeout(url, { headers });
  if (res.status === 401) {
    const { DentallyProvider } = await import('./dentally-provider.js');
    await DentallyProvider.refresh(orgId);
    const fresh = await integrationRepository.getByProvider(orgId, 'dentally');
    const newAuth = fresh ? await resolveDentallyAuth(orgId, fresh) : auth;
    if (newAuth && newAuth !== auth) {
      auth = newAuth;
      res = await fetchWithTimeout(url, { headers: { ...headers, Authorization: auth } });
    }
  }
  return { res, auth };
}
```

- [ ] **Step 4: Reroute the long backfill pager fetches**

For the long paginated backfill loops only — appointments, invoices, invoice_items, treatment_items (the functions that page with `MAX_PAGES`/cursor and currently do `res = await fetchWithTimeout(url, { headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' } })`) — apply this mechanical change inside the page loop. Before:

```js
res = await fetchWithTimeout(url, { headers: { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' } });
```

After:

```js
({ res, auth } = await dentallyFetchWithRefresh(orgId, auth, url));
```

Requirements for each such loop: `auth` must be a reassignable `let` (change its declaration from `const` to `let` if needed) and `orgId` must be in scope (it is in the backfill entries). Leave short one-off calls (detect/health/practitioners) on the run-start `resolveDentallyAuth` token — do NOT reroute those.

Identify the loops: `cd backend && grep -n "fetchWithTimeout(url" src/lib/integrations/dentally-sync.js` and reroute only the ones inside the appointments/invoices/invoice_items/treatment_items backfill pagers (the functions around lines 870-1160).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/dentally-auth-resolve.test.mjs test/dentally-sync.test.mjs test/dentally-treatment-items.test.mjs && node --check src/lib/integrations/dentally-sync.js`
Expected: PASS, and the syntax check produces no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/integrations/dentally-sync.js backend/test/dentally-auth-resolve.test.mjs
git commit -m "feat(integrations): 401 refresh-and-retry guard for Dentally backfill pagers"
```

---

## Task 5: Frontend — default OAuth + "Use API key instead"

**Files:**
- Modify: `frontend/features/integrations/api.ts` (`ConnectInput` type)
- Modify: `frontend/features/system/components/IntegrationsScreen.tsx` (Dentally key-fallback affordance)

Backend now defaults Dentally `authorize` to OAuth, so the existing `Connect` button already returns `{redirectUrl}` and `handleConnect` redirects. We only add the key fallback.

- [ ] **Step 1: Add `method` to the connect input type**

In `frontend/features/integrations/api.ts`, find the `ConnectInput` type (the object passed to `startConnect`, containing `provider`) and add:

```ts
  method?: 'oauth' | 'key';
```

- [ ] **Step 2: Add a key-fallback handler in IntegrationsScreen**

In `frontend/features/system/components/IntegrationsScreen.tsx`, alongside `handleConnect`, add a handler that forces the key path:

```tsx
  async function handleConnectWithKey(p: ProviderMeta) {
    const res = await startConnect.mutateAsync({ provider: p.id, method: 'key' });
    if (res.requiresKeyPaste) {
      // reuse the existing paste-modal open logic from handleConnect's
      // requiresKeyPaste branch (set the same modal state with res.pasteHint)
    }
  }
```

Mirror the exact modal-state lines from `handleConnect`'s `else if (res.requiresKeyPaste)` branch (the code that opens the paste modal with `res.pasteHint`). Keep the rest of `handleConnect` unchanged — for Dentally it now hits the `res.redirectUrl` branch.

- [ ] **Step 3: Render the fallback link on the Dentally card only**

In the provider card render (near the `onClick={() => handleConnect(p)}` Connect button, around line 265), for the disconnected Dentally card add a secondary action:

```tsx
{p.id === 'dentally' && (
  <button
    type="button"
    className="mt-1 text-xs text-slate-500 underline"
    onClick={() => handleConnectWithKey(p)}
    disabled={startConnect.isPending}
  >
    Use an API key instead
  </button>
)}
```

(The primary `Connect` button now triggers OAuth for Dentally.)

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/integrations/api.ts frontend/features/system/components/IntegrationsScreen.tsx
git commit -m "feat(integrations): Dentally OAuth connect button + API-key fallback"
```

---

## Task 6: Environment + docs

**Files:**
- Modify: `backend/.env`
- Modify: `docs/API.md`

- [ ] **Step 1: Uncomment Dentally OAuth env**

In `backend/.env`, ensure these are set (uncomment the commented hints):

```
DENTALLY_AUTH_BASE=https://login.dentally.co
DENTALLY_API_BASE=https://api.dentally.co/v1
# DENTALLY_SCOPES=    # optional; leave unset to use the app's default scopes
```

Production reminder (Railway `web`/backend service env): set
`BACKEND_PUBLIC_URL=https://elevatedentalos-production.up.railway.app` so the
redirect_uri equals the URI registered with Dentally. `OAUTH_STATE_SECRET` already set.

- [ ] **Step 2: Document the connect path in docs/API.md**

Add a short note under the integrations section of `docs/API.md`:

```markdown
### Dentally connect (OAuth or API key)

`POST /api/integrations/connect` with `{ "provider": "dentally", "method": "oauth" }`
returns `{ redirectUrl }` → redirect the browser to Dentally consent. The browser
returns to the public `GET /oauth/dentally/callback` (no auth; org from signed
state), which exchanges the code, stores rotating tokens, and redirects to
`/integrations?connected=dentally`.

`{ "provider": "dentally", "method": "key" }` returns `{ requiresKeyPaste: true }`;
post the key to `POST /api/integrations/dentally/callback` with `{ apiKey }`.

Token refresh is automatic in the sync path (`refresh` rotates the single-use
refresh token under a claim guard). `POST /api/integrations/dentally/refresh`
forces a manual refresh.
```

- [ ] **Step 3: Commit**

```bash
git add backend/.env docs/API.md
git commit -m "docs(integrations): Dentally OAuth env + connect API notes"
```

---

## Task 7: Full backend suite + final verification

- [ ] **Step 1: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: all tests pass (the new `dentally-provider` + `dentally-auth-resolve` suites plus the existing ~224 tests; no regressions).

- [ ] **Step 2: Lint + syntax check**

Run: `cd backend && npm run lint && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, needs live creds + registered host)**

On a host whose `BACKEND_PUBLIC_URL` matches the registered redirect URI: open `/integrations`, click "Connect with Dentally", complete consent, confirm the row goes `active` with an `expires_at` ~2h out and the first sync fires. The API-key fallback still works via "Use an API key instead".

---

## Self-Review notes

- **Spec coverage:** provider module (Task 2) = spec §1; sync resolution (Task 3) + 401 guard (Task 4) = spec §2; schema (Task 1) + frontend (Task 5) = spec §3/§4; env (Task 6) = spec §5; tests across Tasks 1-4,7 = spec §Testing.
- **Type consistency:** `DentallyProvider` (export), `resolveDentallyAuth(orgId, integration)`, `dentallyFetchWithRefresh(orgId, auth, url, extraHeaders) -> {res, auth}`, `tokenStale(expiresAt)` — names used identically across tasks.
- **Known limitations (carried from spec):** OAuth only completes on a registered host; only backfill pagers carry the mid-run 401 guard; scopes default to the app's unless `DENTALLY_SCOPES` set.
