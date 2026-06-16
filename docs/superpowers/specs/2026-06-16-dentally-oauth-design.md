# Dentally OAuth Connection — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming → spec)
**Author:** Claude (with ruhithpasha)

## Goal

Add a "Connect with Dentally" OAuth2 flow **alongside** the existing paste-API-key
path. An owner can connect Dentally either way; both produce one `integrations`
row per org (`provider='dentally'`) and feed the single existing sync path. No
regression to orgs already connected via API key.

## Decisions (locked during brainstorming)

1. **OAuth coexists with the API-key flow** (not a replacement). Key path stays
   fully working as a fallback.
2. **Real wiring** — Dentally OAuth app credentials exist and are in `backend/.env`
   (`DENTALLY_CLIENT_ID`, `DENTALLY_CLIENT_SECRET`). Registered redirect URI:
   `https://elevatedentalos-production.up.railway.app/oauth/dentally/callback`.
3. **Approach A — one hybrid `dentally` provider.** A dedicated
   `dentally-provider.js` replaces the `makeBroker('dentally', …)` registration
   and implements both key-paste and OAuth in one impl. Rejected: a separate
   `dentally_oauth` provider id + second integrations row (duplicates sync +
   splits data lineage); store-OAuth-token-as-apiKey-without-refresh (dies at
   ~2h token expiry, breaks nightly cron).
4. **Token refresh = run-start + backfill 401 guard.** Resolve/refresh the access
   token once at each sync entry (covers fast nightly incrementals); the
   paginated backfill loops additionally retry once on a 401 by refreshing, so a
   multi-hour first backfill survives a single token expiry.

## Existing plumbing reused (no new generic scaffolding needed)

Confirmed present and provider-generic:

- `lib/integrations/provider-interface.js` — `registerProvider(meta, impl)`,
  `getProvider(id)`, `providers` Map.
- `routes/oauth.routes.js` — **public** `GET /oauth/:provider/callback` (outside
  `/api` auth gate; org recovered from HMAC-signed `state`).
- `controllers/integration.controller.js` —
  - `connect` → `service.startConnect(orgId, provider, body)` → `impl.authorize`.
  - `oauthCallback` (public) → recovers org from signed state → `finishConnect`
    → for `dentally` fires `bootstrapDentally` (detect sites → create+map
    practices → pull). Always redirects to the frontend integrations page.
  - `callback` (authenticated `/:provider/callback`) → `finishConnect` →
    `impl.callback` (this is the path the API-key paste save uses today).
  - `refresh` (`/:provider/refresh`) → `impl.refresh`.
- `repositories/integration.repository.js` — `upsert`, `upsertSecrets({config,
  secrets, status, verified_at, scopes, expires_at})`, `claimRefresh(orgId,
  provider, staleMs)` (rotating-refresh-token race guard), `markRevoked`.
  `expires_at` column already exists.
- `lib/oauth-state.js` — `signState`/`verifyState` (HMAC, needs
  `OAUTH_STATE_SECRET`, already set in `.env`).
- `lib/crypto.js` — `encryptSecret`/`decryptSecret`.

Xero (`xero-provider.js`) is the reference for OAuth2 with rotating refresh
tokens + `claimRefresh`.

## Dentally OAuth endpoints

From `.env` hints (Dentally uses a Doorkeeper-based OAuth2 server):

- Authorize: `${DENTALLY_AUTH_BASE}/oauth/authorize` — default
  `DENTALLY_AUTH_BASE=https://login.dentally.co`
- Token: `${DENTALLY_AUTH_BASE}/oauth/token`
- API base (sync): `DENTALLY_API_BASE=https://api.dentally.co/v1`
- Redirect URI: `${BACKEND_PUBLIC_URL}/oauth/dentally/callback` — **must match the
  registered URI byte-for-byte** (Doorkeeper requires exact match).
- Client auth: HTTP Basic `DENTALLY_CLIENT_ID:DENTALLY_CLIENT_SECRET` on the token
  endpoint.
- Scope: optional `DENTALLY_SCOPES` env (space-separated). If unset, omit the
  `scope` param and let the registered app's default scopes apply.

## Components

### 1. `lib/integrations/dentally-provider.js` (new)

Replaces only the Dentally registration in `broker-provider.js`
(`makeBroker('dentally', …)` is removed; **SOE stays a broker**). Implements the
provider interface:

- **`authorize(orgId, extra)`** — branch on intent:
  - `extra.method === 'key'` → `upsert(status:'pending')`, return
    `{ requiresKeyPaste: true, pasteHint }` (unchanged paste UX).
  - otherwise (`method === 'oauth'`, the default) → require
    `DENTALLY_CLIENT_ID` + `OAUTH_STATE_SECRET` (else throw a "not configured"
    message so `startConnect` surfaces 501); `state = signState({orgId,
    provider:'dentally'})`; build the authorize URL (`response_type=code`,
    `client_id`, `redirect_uri`, `state`, `scope` if `DENTALLY_SCOPES` set);
    `upsert(status:'pending')`; return `{ redirectUrl }`.
- **`callback(orgId, payload)`** — branch on payload:
  - `payload.code` → POST token endpoint (Basic auth,
    `grant_type=authorization_code`, `code`, exact `redirect_uri`); on success
    `upsertSecrets` with `secrets = encryptSecret(JSON.stringify({access_token,
    refresh_token}))`, `config = { token_type, scope }`, `status:'active'`,
    `verified_at`, `scopes`, `expires_at = now + expires_in`.
  - `payload.apiKey` → existing key persist (`config: baseUrl ? {base_url} : {}`,
    `secrets: encryptSecret({apiKey})`, `expires_at: null`).
  - neither → throw `'authorization code or apiKey required'`.
- **`refresh(orgId)`** — `claimRefresh('dentally')` guard (rotating tokens are
  single-use, same race as Xero/GHL); read current secrets, POST
  `grant_type=refresh_token`; persist rotated `{access_token, refresh_token}` +
  new `expires_at`. No-op (`{ok:true}`) when the row holds an `apiKey` (key path
  never refreshes).
- **`revoke(orgId)`** — `markRevoked`, unchanged.

Registered via `registerProvider({ id:'dentally', label:'Dentally',
authStyle:'oauth_or_key', category:'pms' }, impl)`.

### 2. `lib/integrations/dentally-sync.js` — credential resolution

Replace `authHeader(secrets)` (currently reads `parsed.apiKey` →
`Bearer <apiKey>`) with:

```
async function resolveDentallyAuth(integration) {
  const parsed = JSON.parse(decryptSecret(integration.secrets));
  if (parsed.apiKey) return `Bearer ${parsed.apiKey}`;       // key path, never expires
  if (parsed.access_token) {
    if (tokenStale(integration.expires_at)) {                 // within ~5 min of expiry
      await dentallyProvider.refresh(integration.organisation_id);
      // re-read the freshly persisted row for the rotated token
    }
    return `Bearer ${access_token}`;
  }
  return null;
}
```

- Every sync entry that currently does `const auth = authHeader(integration.secrets)`
  (~10 call sites: `syncOneOrg`, backfills, webhook handlers, detect/health
  helpers) becomes `const auth = await resolveDentallyAuth(integration)`.
- **Backfill 401 guard:** the paginated pull loops (the `while`/cursor fetches in
  the appointments/invoices/invoice_items/treatment backfills) wrap their fetch so
  a single `401` triggers one `dentallyProvider.refresh` + re-resolve + retry,
  then continues with the fresh bearer. One retry per loop iteration max — avoids
  infinite refresh loops on a genuinely revoked token.
- `resolveDentallyAuth` must avoid a circular import: import
  `dentally-provider.js` lazily (`await import`) inside the refresh branch, mirror
  of how Xero lazy-imports `oauth-state.js`.

### 3. Connect schema + controller

- `models/integration.model.js` `integrationConnectSchema` gains optional
  `method: z.enum(['oauth','key']).optional()`. Controller passes the whole body
  through to `startConnect` (already does). Default when absent: `authorize`
  treats Dentally as `oauth`.

### 4. Frontend (integrations page)

- Dentally card: primary **"Connect with Dentally"** button →
  `POST /api/backend/integrations/connect { provider:'dentally', method:'oauth' }`
  → on `{redirectUrl}` set `window.location = redirectUrl`. After Dentally
  consent the browser returns to the public callback → redirected back to the
  integrations page with `?connected=dentally` (or `?error=`).
- Secondary link **"Use an API key instead"** → existing paste modal →
  `POST …/connect { provider:'dentally', method:'key' }` (gets `requiresKeyPaste`)
  then the existing `POST …/dentally/callback { apiKey }` save.
- Connected state, sync overlay, webhook panel unchanged (same row, same
  `last_sync_at`/`last_error`).

### 5. Environment

`backend/.env` (and prod): uncomment / set

- `DENTALLY_AUTH_BASE=https://login.dentally.co`
- `DENTALLY_API_BASE=https://api.dentally.co/v1`
- `DENTALLY_SCOPES=` (optional)
- Prod `BACKEND_PUBLIC_URL=https://elevatedentalos-production.up.railway.app`
  (so the redirect_uri equals the registered one). `OAUTH_STATE_SECRET` already set.

## Data flow

### OAuth connect
1. Owner clicks "Connect with Dentally" → `POST /connect {provider:dentally,
   method:oauth}` → `startConnect` → `impl.authorize` → `{redirectUrl}`.
2. Browser → Dentally authorize → consent → redirect to public
   `/oauth/dentally/callback?code=…&state=…`.
3. `oauthCallback` verifies state → org → `finishConnect('dentally',{code})` →
   `impl.callback` exchanges code, persists encrypted tokens + `expires_at`,
   status active → fires `bootstrapDentally` (fire-and-forget) → browser
   redirected to the frontend integrations page.

### Sync (nightly + on-demand)
1. Entry reads the integrations row → `resolveDentallyAuth(integration)`.
2. If OAuth token stale → `refresh` (claim guard) → fresh bearer.
3. Fetch loops use the bearer; backfill loops retry once on 401 by refreshing.

### Key connect (unchanged)
`/connect {method:key}` → `requiresKeyPaste` → paste modal →
`/dentally/callback {apiKey}` → `impl.callback` persists key (`expires_at:null`)
→ bootstrap. `resolveDentallyAuth` returns the key bearer with no refresh.

## Error handling

- Missing `DENTALLY_CLIENT_ID`/`OAUTH_STATE_SECRET` → `authorize` throws "not
  configured" → `startConnect` maps to **501** (UI shows "not configured").
- Token-exchange / refresh HTTP failure → throw with the provider error body →
  `finishConnect` maps to **400**; `oauthCallback` redirects with `?error=`.
- Refresh on a revoked token → propagates; the row keeps `last_error`; backfill
  401 guard retries once then surfaces the failure (no infinite loop).
- `redirect_uri` mismatch → Dentally rejects at authorize; documented as the exact-
  match requirement (host must be registered).

## Testing

Vitest, in `backend/test`:

1. `authorize` returns `{redirectUrl}` for `method:oauth` (state signed, scope
   honoured) and `{requiresKeyPaste}` for `method:key`.
2. `callback` with `code` exchanges + persists **encrypted** `{access_token,
   refresh_token}` + correct `expires_at`; with `apiKey` persists the key path
   (`expires_at:null`); with neither throws.
3. `refresh` posts `grant_type=refresh_token`, persists the **rotated** pair, and
   honours `claimRefresh` (second concurrent refresh is a no-op/skips).
4. `resolveDentallyAuth`: key row → bearer unchanged, no refresh call; OAuth row
   with fresh token → bearer, no refresh; OAuth row with stale `expires_at` →
   triggers refresh then returns the new bearer.
5. Backfill 401 guard refreshes exactly once then retries; a second 401 surfaces
   the error.
6. Cross-org isolation: a refresh/connect for org A never touches org B's row.

Mock `fetch` for Dentally authorize/token endpoints (no live calls in tests).

## Known limitations

- Exact-redirect-URI: OAuth only works on a host registered with Dentally.
  Local `localhost:8080` won't complete unless also registered — local devs use
  the API-key path.
- Run-start refresh covers incrementals; only the wrapped backfill loops survive
  mid-run expiry. Other one-off fetches outside those loops still rely on the
  run-start token.
- Scopes default to the registered app's unless `DENTALLY_SCOPES` is set.
- Dentally still sends no stable webhook record id (pre-existing limitation,
  unchanged by this work).

## Out of scope

- Migrating existing key-connected orgs to OAuth (manual reconnect if desired).
- SOE/Exact OAuth (stays broker key).
- Per-site / multi-account Dentally OAuth (one grant = whole Dentally account,
  same as the key today).
