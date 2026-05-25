# dentally.md

How Elevate connects to Dentally for multi-tenant practice data. Defer execution until partner status + sync impl land. Source-of-truth for the connect UX decision.

Captured 2026-05-20.

---

## What Dentally actually supports (2026)

| Feature | Available? | Notes |
|---|---|---|
| REST API | ✅ | `https://api.dentally.co/v1` |
| Auth | ❌ OAuth | **Bearer token only** — generated per-practice in Dentally → Settings → API |
| "Connect with Dentally" embedded OAuth | ❌ | Not public |
| Webhooks | ⚠️ partial | Appointments created/updated. Payments require polling. |
| Partner program | ✅ | `integrations@dentally.co` / `partners@dentally.co` — partners can get OAuth credentials + marketplace listing |
| Per-user OAuth | ❌ | No "log in as user" flow |
| Rate limits | ~10 req/sec | Sleep between paged fetches |

Stripe-Connect-style "click → consent → done" does not exist publicly yet. SOE Exact is in the same boat.

---

## Three connect patterns we can use

### Option 1 — Apply for Dentally Partner OAuth (the real fix)

```
Owner clicks "Connect Dentally"
        ▼
GET /api/integrations/dentally/authorize
        ▼
Redirect → https://dentally.co/oauth/authorize?client_id=elevate&scope=...
        ▼
Dentally consent screen ("Elevate wants access to your patients, appointments, payments")
        ▼
Redirect back → /api/integrations/dentally/callback?code=...
        ▼
Exchange code for refresh + access tokens
        ▼
integrations row, status='active', secrets encrypted
```

Identical to what `lib/integrations/stripe-provider.js` already does. The `oauth-stub-providers.js` framework is ready to drop into.

**Effort:** 1 day once Dentally gives us OAuth credentials.

**Action:** email `partners@dentally.co` / `integrations@dentally.co`. Pitch:
- UK dental SaaS aggregator
- N practices in pipeline
- Need OAuth client credentials + staging environment access
- Partner process usually 2-4 weeks

### Option 2 — Hosted Connect Wizard (ship now, works today)

Right pattern when provider has only API keys. Looks and feels like OAuth to the owner; under the hood we guide them through key generation.

```
Owner clicks "Connect Dentally" in Settings → Integrations
        ▼
Modal opens: /app/connect/dentally

   ┌────────────────────────────────────────┐
   │ Connect Smile Dental to Dentally        │
   │                                          │
   │ Step 1: Open Dentally in another tab    │
   │         → [Open dentally.co/settings/api]│
   │                                          │
   │ Step 2: Click "Generate New Token"      │
   │         (animated GIF demo embedded)     │
   │                                          │
   │ Step 3: Paste the token below:          │
   │         [────────────────────────────]   │
   │         [   Connect   ]                  │
   └────────────────────────────────────────┘

        ▼
Backend validates: GET https://api.dentally.co/v1/me
   Authorization: Bearer <pasted>
   → 200 = valid → encrypt + store
   → 401 = "Token didn't work, double-check Step 2"

        ▼
integrations row, status='active'
Owner sees "✓ Connected to Smile Dental Practice"
(using `practice_name` from /v1/me — proves it worked)

        ▼
Background: 15-min Dentally sync cron starts pulling history
```

**Multi-tenant safety:**
- Per-tenant keys (one row per org in `integrations`)
- Encrypted at rest with `INTEGRATIONS_SECRET_KEY` (AES-256-GCM via `lib/crypto.js`)
- Never returned via API (`integrations.secrets` excluded from list SELECT)
- Auto-revoke endpoint (owner clicks "Disconnect" → secrets nulled, `status='revoked'`)
- Validation step (`/v1/me` ping) catches typos before storage
- Same code path works for SOE Exact

This is what `lib/integrations/broker-provider.js` already scaffolds. UI is in `IntegrationsScreen.tsx`. Already shipped, needs one validation upgrade (see "Concrete code" below).

### Option 3 — Inbound webhook handshake (if Dentally ever adds it)

```
Owner adds "Elevate" inside Dentally's app marketplace
        ▼
Dentally POSTs to /webhooks/dentally/install
   { practice_id, install_token, scopes }
        ▼
We pre-create an integration row tagged with install_token
        ▼
Owner gets emailed link: app.elevate.app/connect-confirm?token=<install_token>
        ▼
Owner logs into Elevate, clicks Confirm → we bind the install to their org
```

Cleanest UX. Requires Dentally to add this flow. Not available today.

---

## Recommended phased rollout

```
PHASE A  (now, no waiting)
  Ship Option 2. Polish existing broker modal:
    - Step-by-step walkthrough with embedded screenshots / GIFs
    - Validate key against GET /v1/me before storing
    - Show first-sync progress
  Works for both Dentally + SOE.
  Owner experience = "fancy guided OAuth" even though it's a paste.

PHASE B  (in parallel)
  Email partner team. Request OAuth credentials.
  Schedule 30-min call. They will know your use case.

PHASE C  (when Dentally OAuth lands, weeks-to-months)
  Drop real OAuth via existing IntegrationProvider interface.
  Migrate connected tenants: prompt them to re-auth via new flow.
  Old broker keys auto-expire after migration window.
```

---

## Concrete code for Phase A — validated broker

```js
// backend/src/lib/integrations/broker-provider.js — patch
async callback(orgId, { apiKey, baseUrl }) {
  if (!apiKey) throw new Error('apiKey required');

  const base = baseUrl ?? 'https://api.dentally.co/v1';
  const r = await fetch(`${base}/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) {
    throw new Error(
      `Dentally rejected this token (${r.status}). Generate a new one in Dentally → Settings → API.`,
    );
  }
  const me = await r.json();

  await integrationsRepository.upsertSecrets(orgId, id, {
    config: {
      base_url: base,
      practice_id: me?.practice_id,
      practice_name: me?.practice_name,
    },
    secrets: encryptSecret(JSON.stringify({ apiKey })),
    status: 'active',
    verified_at: new Date().toISOString(),
  });
  return { ok: true, practice: me?.practice_name };
}
```

UI then shows `✓ Connected to Smile Dental Practice` using `practice_name` from `/v1/me`. Proves to owner the key actually worked.

---

## Multi-tenant guarantee — how cross-tenant data leakage is impossible

```
TENANT A (Smile Dental)
  integrations row:
    org_id = A
    provider = 'dentally'
    secrets = <encrypted Smile's API key>
    config.practice_id = 12345
    config.practice_name = "Smile Dental Practice"

TENANT B (Bright Dental)
  integrations row:
    org_id = B
    provider = 'dentally'
    secrets = <encrypted Bright's API key>
    config.practice_id = 67890
    config.practice_name = "Bright Dental Group"

Every sync run (lib/integrations/dentally-sync.js):
  for each integrations row with provider='dentally', status='active':
    decrypt THAT tenant's key
    fetch with THAT key   ← Dentally returns only THAT practice's data
    upsert results into payments/appointments/contacts
      WHERE organisation_id = THAT tenant's org_id   ← belt + braces
    → cross-tenant data leakage impossible
        (RLS + manual filter + per-tenant credential)
```

Per-practice keys are actually **good** for multi-tenant SaaS: every tenant brings their own credential, no shared platform credential to leak.

---

## To-do list (when Phase A goes live)

1. Migration `20260101000010_payments_external_id.sql`:
   ```sql
   ALTER TABLE payments  ADD COLUMN IF NOT EXISTS external_id TEXT;
   CREATE UNIQUE INDEX idx_payments_external_id
     ON payments(organisation_id, external_id) WHERE external_id IS NOT NULL;
   ALTER TABLE contacts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
   ```
   (`external_id` enables idempotent upsert from sync. `contacts.metadata` stores `{ dentally_id }` for FK lookup.)

2. Replace stubs in `lib/integrations/dentally-sync.js` with real fetch loops:
   - `pullPatients` → upsert contacts (~60 lines)
   - `pullAppointments` → upsert appointments (~60 lines)
   - `pullPayments` → upsert payments with `source='dentally'` (~60 lines)
   - Map Dentally's `payment_method` to our enum (`card`/`cash`/`bank_transfer`/...)

3. Fix `syncOneOrg`: change `Promise.all` → sequential (`pullPatients` must complete before `pullAppointments` so FK lookups work).

4. First-sync detection in `dentally-sync.js`:
   ```js
   if (!integration.last_sync_at) since = '2020-01-01';
   else since = integration.last_sync_at;
   ```

5. Upgrade `broker-provider.js` with validation block (code above).

6. Polish `IntegrationsScreen` modal:
   - Add 3-step walkthrough copy
   - Embed help GIF for "where to generate the token"
   - Show `practice_name` on success
   - Disconnect confirmation step

7. Settings → Integrations → Dentally row shows:
   - Last sync timestamp
   - Resource counts (X patients, Y appointments, Z payments synced)
   - "Force sync now" button (calls `syncOneOrg` ad-hoc)
   - "Disconnect" button

8. Tests:
   - `dentally-sync.test.mjs` mocking fetch — assert correct since-window, correct upsert payloads, cross-tenant key isolation
   - `broker-provider.test.mjs` — validation rejects bad token, accepts good token

---

## Decision summary

- **No Dentally OAuth today.** Don't wait for it.
- **Ship Option 2 (validated broker)** — multi-tenant safe, encrypted, looks like OAuth from owner POV
- **Apply for partner OAuth in parallel** — swap providers later via existing interface
- **Same architecture works for SOE Exact** — both are key-only PMS
- **Per-tenant credentials = good** for multi-tenant SaaS; no shared platform secret to leak

When ready to execute: open this file + section "Concrete code for Phase A" + the to-do list. Everything else (storage schema, encryption, provider registry, sync worker shell, UI modal shell) is already in place.
