# Elevate Dental OS — Phase 1-7 Implementation Report (excl. Phase 5)

Session: 2026-05-20. Branch: `main`. All work additive; no regressions to the 105 existing backend tests; frontend `npm run build` clean.

Phase 5 (platform-admin layer) runs in a parallel Claude session and is intentionally outside this report's scope.

---

## 0. TL;DR

| Phase | What was shipped this session | Tested |
|---|---|---|
| **1** | CRM Inbox + Pipeline wired to real API. Path-prefix bug from Step 1 fixed. `leads` slice typed contracts. | ✅ typecheck, lint, build, vitest 105/105 |
| **2** | Migration `…000007` (cadence + source cols). Snapshot worker rewritten — formula-driven daily tick, per-org cadence. `PATCH /api/health/cadence` endpoint. Frontend `useUpdateCadence` hook + CadenceCard on Progress screen. | ✅ |
| **3** | Migration `…000008` (integrations + provider_events + Phase 6 cols). `IntegrationProvider` interface. Stripe Connect provider (real OAuth). Broker providers (Dentally, SOE). 9 OAuth stubs (Xero, QuickBooks, Google Calendar/Ads, Meta Ads, Mailchimp, Slack, Zoom, DocuSign, Dropbox). Encryption at rest via `lib/crypto.js`. `/api/integrations/*` surface end-to-end. Frontend `IntegrationsScreen` wired with Connect/Disconnect + broker-key modal. | ✅ |
| **4** | `lib/messaging.js` facade — picks per-tenant SES/SNS if `integrations` row active, else falls back to platform Postmark/Twilio. Every send writes a `provider_events` row. `comm.service` + 2 worker callers migrated. | ✅ |
| **6** | `communications.visibility` + `assigned_user_id` schema. `org_email_aliases` table. Repo-level visibility filter applied to `/api/comms` list. Owner sees all; reception/manager filtered. | ✅ |
| **7** | New backend routes: `growth.routes.js` (patients/marketing/loyalty/booking/benchmark), `wealth.routes.js` (net/fire/pension/property), `training.routes.js` (library/my/mentorship/one-to-one). Mounted in `app.js`. | ✅ |

**Stats:** 28 files created or rewritten this turn (excluding the two plan files from earlier in the session). Zero existing tests broken. Frontend bundle 51 routes builds clean.

---

## 1. Complete data-flow map

```
                                     ┌──────────────────────────────────────────┐
                                     │  EXTERNAL DATA SOURCES                   │
                                     │  (provider-side, we don't own these)     │
                                     └────────────────┬─────────────────────────┘
                                                      │
                  ┌───────────────────────────────────┼────────────────────────────────────┐
                  │                                   │                                    │
                  ▼                                   ▼                                    ▼
       Stripe webhooks                    Meta/Google Ads forms             Dentally / SOE polling
       (payments, refunds)                (Lead Ads, web-to-lead)           (appointments, contacts)
                  │                                   │                                    │
                  │                                   │                                    │
                  ▼                                   ▼                                    ▼
       POST /webhooks/stripe              POST /webhooks/meta             worker pull every N min
       (raw body, signature             (signature checked)             (using broker-encrypted key)
        verified)
                  │                                   │                                    │
                  └───────────────────┬───────────────┴────────────────────────────────────┘
                                      │
                                      ▼
                          ┌──────────────────────────┐
                          │   Backend (Express)      │
                          │   ESM, 5-layer arch      │
                          └────────────┬─────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
        ▼                              ▼                              ▼
   payments table             leads table                    appointments table
   .source = 'stripe'         .source = 'website-form'        .source = 'dentally'
   .source = 'manual'         .source_provider = 'meta_ads'   .source = 'manual'
                              .source_provider = 'manual'
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
        ▼                              ▼                              ▼
   communications              contacts                       business_health
   .visibility                 .source                        .baseline (manual)
   .assigned_user_id           .source = 'dentally'           .snapshot_frequency
                                                              ('weekly'|'monthly')
                                       │
                                       │  daily 02:00 UTC cron
                                       │  (workers/index.js)
                                       │  isDueForSnapshot() per-org
                                       │  formulas.calculatePL/LTV/MarketingROI
                                       │
                                       ▼
                              business_health_snapshots
                              .metrics.source_breakdown (where data came from)
                              .metrics.counts (how many rows in window)
                              .metrics.pl / ltv / marketingROI

                                       │  fetched by frontend React Query
                                       │  via /api/backend/[...path]/route.ts
                                       │  (httpOnly JWT injected server-side)
                                       │
                                       ▼
                              frontend/features/*/hooks.ts
                              ['health-snapshots'], ['leads'], etc.

                                       │
                                       ▼
                              UI screens
                              Pipeline, Inbox, Progress, Reports
                              (no secrets ever in client bundle)
```

---

## 2. Phase 1 — Backend wiring (continued from earlier in session)

### Already shipped

| Step | Slice | Files |
|---|---|---|
| 1 | CRM Inbox → `/api/comms` | `features/crm/{api,hooks}.ts`, `InboxScreen.tsx` rewrite + bugfix |
| 2 | CRM Pipeline → `/api/leads` | `features/leads/{api,hooks}.ts` typed, `PipelineScreen.tsx` rewrite |

### Newly available routes (Phase 7 work also unblocks Phase 1)

- `/api/growth/patients` `/marketing` `/loyalty` `/booking` `/benchmark`
- `/api/wealth/net` `/fire` `/pension` `/property`
- `/api/training/library` `/my` `/mentorship` `/one-to-one`

Frontend slices `growth`, `wealth`, `training` can now wire — backend exists, queries return aggregated org-scoped data. Pattern: `features/<slice>/{api,hooks}.ts`, component reads `useGrowthPatients()` etc.

---

## 3. Phase 2 — Business Health calc + cadence

### Schema (`supabase/migrations/20260101000007_business_health_cadence.sql`)

```sql
ALTER TABLE business_health
  ADD COLUMN snapshot_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (snapshot_frequency IN ('weekly', 'monthly')),
  ADD COLUMN last_snapshot_at TIMESTAMPTZ;

ALTER TABLE payments      ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE leads         ADD COLUMN source_provider TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE appointments  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE contacts      ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX idx_payments_source     ON payments(organisation_id, source);
CREATE INDEX idx_leads_provider      ON leads(organisation_id, source_provider);
CREATE INDEX idx_appointments_source ON appointments(organisation_id, source);
CREATE INDEX idx_contacts_source     ON contacts(organisation_id, source);
```

`leads.source` was already a text column (marketing channel label). Added `source_provider` to disambiguate provenance from marketing channel. Free-text so providers can be added without migrations.

### Worker rewrite — `backend/src/workers/index.js`

**Before:** copied `business_health.baseline` straight into snapshots monthly.

**After:** runs daily 02:00 UTC. For each org:
1. Reads `snapshot_frequency`.
2. `isDueForSnapshot(frequency, today, last_snapshot_at)` — `Monday for weekly`, `1st of month for monthly`, idempotent same-day.
3. Computes `windowStart` (7 days back for weekly, 1 month back for monthly).
4. Parallel queries against `payments`, `leads`, `appointments` filtered by org + window.
5. Runs `formulas.calculatePL`, `calculateLTV`, `calculateMarketingROI`.
6. Inserts `business_health_snapshots` row with `metrics.source_breakdown` (provider attribution) + `metrics.counts` + computed financials.
7. Updates `business_health.last_snapshot_at`.

Helpers in `backend/src/lib/snapshot-utils.js`:
- `getISOWeek(d)` → ISO week number
- `countBySource(...arrays)` → `{ manual: 12, stripe: 4, meta_ads: 8 }`
- `isDueForSnapshot(freq, today, lastSnapshot)`
- `windowStart(freq, today)`
- `snapshotLabel(freq, today)` → `"Week 21-2026"` or `"May 2026"`

### Endpoint

```
PATCH /api/health/cadence       Owner only
Body:  { snapshot_frequency: 'weekly' | 'monthly' }
→      { ok: true, snapshot_frequency: 'weekly' }
```

5-layer trace: `routes/health-business.routes.js → controllers/business-health.controller.updateCadence → services/business-health.service.updateCadence → repositories/business-health.repository.updateCadence`. Zod schema `cadenceUpdateSchema` in `models/business-health.model.js`.

### Frontend — Progress screen

`features/health/components/ProgressScreen.tsx` now has a `<CadenceCard>` at top with two buttons (Weekly / Monthly). Hooks `useHealth()` + `useUpdateCadence()` from `features/health/hooks.ts`.

### Storage map — where each user input lands

```
Settings → Business Health → "Enter Manually" wizard
  PATCH /api/health  body: { baseline: { revenue, profit, headcount, ... }, targets: {...} }
       ▼
  business_health.baseline JSONB  (one row per org)

Settings → Business Health → Progress page → cadence buttons
  PATCH /api/health/cadence
       ▼
  business_health.snapshot_frequency TEXT

Settings → Integrations → "Connect Stripe"
  POST /api/integrations/connect → redirect to Stripe OAuth
  GET  /api/integrations/stripe/callback?code=...
       ▼
  integrations row (org_id, provider='stripe', secrets=<encrypted>, status='active')
       ▼
  Stripe webhook → POST /webhooks/stripe (raw body)
       ▼
  payments row, source='stripe', amount_pence, paid_at

  cron 02:00 UTC daily
       ▼
  formulas.calculatePL(payments, baseline)
       ▼
  business_health_snapshots row, metrics.source_breakdown={ stripe: N, manual: M }
```

---

## 4. Phase 3 — Connect-App OAuth foundation

### Schema (`supabase/migrations/20260101000008_integrations.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE integrations (
  id UUID PRIMARY KEY,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  secrets BYTEA,                          -- AES-256-GCM encrypted
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verifying','active','failed','revoked')),
  verified_at TIMESTAMPTZ,
  last_error TEXT,
  last_sync_at TIMESTAMPTZ,
  scopes TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, provider)
);

CREATE TABLE provider_events (
  id UUID PRIMARY KEY,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Migration also adds Phase 6 cols on `communications` + `org_email_aliases` table (see section 7 below).

### `IntegrationProvider` interface — `lib/integrations/provider-interface.js`

Every connector implements the same shape:

```js
{
  meta: { id, label, authStyle, category },
  impl: {
    authorize(orgId, params)  → { redirectUrl | pasteHint | dnsRecords },
    callback(orgId, payload)  → { ok: true },
    refresh(orgId)            → { ok: true } | NotImplementedError,
    revoke(orgId)             → { ok: true },
    webhook(payload, sig)     → { received: true, type },
    sync(orgId)               → { synced: N }
  }
}
```

Providers self-register via `registerProvider(meta, impl)`. `lib/integrations/index.js` imports all of them — single import surface.

### Providers shipped

| ID | Label | Auth style | Category | Status |
|---|---|---|---|---|
| `stripe` | Stripe | OAuth | payments | **Real OAuth + token exchange** — `lib/integrations/stripe-provider.js`. Hits real `connect.stripe.com/oauth/token`. |
| `dentally` | Dentally | broker_key | pms | API key paste, encrypted at rest. No OAuth available. |
| `soe` | Software of Excellence (Exact) | broker_key | pms | Same as Dentally. |
| `xero` | Xero | OAuth | accounting | Stub: real auth URL + token URL; needs env vars. |
| `quickbooks` | QuickBooks | OAuth | accounting | Stub. |
| `google_calendar` | Google Calendar | OAuth | calendar | Stub. |
| `google_ads` | Google Ads | OAuth | marketing | Stub. |
| `meta_ads` | Meta Lead Ads | OAuth | marketing | Stub. |
| `mailchimp` | Mailchimp | OAuth | marketing | Stub. |
| `slack` | Slack | OAuth | notifications | Stub. |
| `zoom` | Zoom | OAuth | meetings | Stub. |
| `docusign` | DocuSign | OAuth | contracts | Stub. |
| `dropbox` | Dropbox | OAuth | storage | Stub. |

"Stub" = real OAuth URL builder + token-exchange POST against the real provider URL. Requires `<PROVIDER>_CLIENT_ID` + `<PROVIDER>_CLIENT_SECRET` env vars to be set; throws clear error if missing. Webhook + sync methods are placeholders that return `{ received: true }` / `{ synced: 0 }` until the provider's specific event shape is implemented.

### Encryption — `backend/src/lib/crypto.js`

AES-256-GCM with `INTEGRATIONS_SECRET_KEY` env. Layout `[12B iv | 16B tag | ciphertext]`. `encryptSecret(plaintext)` → `Buffer`. `decryptSecret(buf)` → `string`. Stored in `integrations.secrets BYTEA`. Decrypt only happens inside `lib/messaging.js` (provider clients).

### API surface — `routes/integrations.routes.js`

```
GET    /api/integrations                Owner. Returns connected rows + available providers (no secrets).
POST   /api/integrations/connect        Owner. Body { provider, apiKey?, baseUrl? }.
                                        Returns { redirectUrl } for OAuth or { requiresKeyPaste, pasteHint } for broker.
GET    /api/integrations/:provider/callback   Owner. OAuth code → token exchange.
POST   /api/integrations/:provider/callback   Owner. Broker key submission.
POST   /api/integrations/:provider/refresh    Owner. Refresh OAuth token.
POST   /api/integrations/:provider/revoke     Owner. Revoke + null secrets.
DELETE /api/integrations/:id            Owner. Hard delete row.
```

### Frontend — `features/system/components/IntegrationsScreen.tsx`

- Reads `useIntegrations()` → `{ integrations, available }`.
- Groups providers by `category` (preserves registration order).
- Per-tile button:
  - **Not connected:** "Connect" → `useStartConnect()` → if `redirectUrl`, `window.location.href = url`; if `requiresKeyPaste`, opens broker modal.
  - **Connected:** "Connected" chip → click reveals revoke action.
- Broker modal: single password-type input, encrypted-at-rest disclaimer, "Save key" calls `useSubmitBrokerKey()` → POSTs `{ apiKey }` to `/api/integrations/:provider/callback`.

`features/integrations/{api,hooks}.ts` — typed contracts and React Query hooks (`useIntegrations`, `useStartConnect`, `useSubmitBrokerKey`, `useRevoke`).

---

## 5. Phase 4 — Per-tenant AWS SES/SNS messaging

### `lib/messaging.js` facade

Single entry point that callers use (`sendEmail`, `sendSMS`). Decision tree:

```
sendEmail({ orgId, to, subject, body }) {
  ses = await integrationRepository.getByProvider(orgId, 'ses')
  if (ses?.status === 'active') {
    return sendViaSES(orgId, ses, opts)
    → logs provider_events row with provider='ses'
  } else {
    messageId = await postmark.sendEmail(opts)
    → logs provider_events row with provider='postmark'
    return { external_id: messageId, provider: 'postmark' }
  }
}
```

Same for `sendSMS` → SNS or Twilio.

### What's wired vs stubbed

| Surface | State |
|---|---|
| `lib/messaging.js` facade | ✅ Real. Routes by org config. |
| `comm.service.send()` → uses facade | ✅ Real. orgId threaded through. |
| Workers (weekly digest + workflow runner) → use facade | ✅ Real. |
| `lib/postmark.js` + `lib/twilio.js` platform fallback | ✅ Real (unchanged from before). |
| `sendViaSES()` actual AWS SDK call | ⚠️ Stub. Logs `provider_events` row with synthetic `ses-stub-<ts>` id. Real impl: `new SESv2Client({ region, credentials }).send(new SendEmailCommand({...}))`. |
| `sendViaSNS()` actual AWS SDK call | ⚠️ Stub. Same shape, real impl needs `@aws-sdk/client-sns`. |
| SES domain verification endpoint | ❌ Not yet — needs `POST /api/integrations/ses/domain` that calls `SES:CreateEmailIdentity` and returns DNS records. |
| SNS pool provisioning | ❌ Not yet. |

The stub lets the rest of the system (audit trail, comm.service, workers) be exercised end-to-end. Replacing stubs with real AWS SDK is a 30-line drop-in once AWS account + IAM ready.

### Provider events table — full audit trail

Every send (success or fail) writes a row:

```
provider_events
├── organisation_id
├── provider          'ses' | 'sns_sms' | 'postmark' | 'twilio' | 'stripe' | ...
├── external_id       Postmark MessageID / Twilio SID / Stripe event id
├── event_type        'sent' | 'delivered' | 'bounce' | 'complaint' | 'open' | 'click'
├── payload jsonb
└── created_at
```

Useful for:
- Per-tenant deliverability stats.
- Bounce/complaint suppression lists.
- Debugging "did my email send?" support tickets.
- Reconciling provider invoices.

---

## 6. Phase 6 — Intra-org email visibility

### Schema (in migration `…000008`)

```sql
ALTER TABLE communications
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'org',
  ADD COLUMN assigned_user_id UUID REFERENCES users(id);

CREATE TABLE org_email_aliases (
  id UUID PRIMARY KEY,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  local_part TEXT NOT NULL,
  visibility TEXT NOT NULL,
  assigned_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, local_part)
);
```

`visibility` values:
- `org` — visible to everyone in the org (default).
- `role:owner` — only owners.
- `role:practice_manager` — only practice managers (and owners).
- `role:reception` — only reception (and owners).
- `user:<uuid>` — only that specific user (and owners).

### Repo filter — `repositories/comm.repository.js`

`list(orgId, q, viewer)` now accepts the caller's `{ id, role }`:

- If `viewer.role === 'owner'` → returns everything (owner sees all).
- Else: keeps row if `visibility ∈ { 'org', 'role:<viewer.role>', 'user:<viewer.id>' }` OR `assigned_user_id === viewer.id`.

Controller passes `viewer = { id: req.user.id, role: req.user.role }`.

### What's NOT yet wired

- UI for setting `visibility` per thread — not built (manual SQL or future settings UI).
- Alias-based inbound routing — table exists but inbound webhook still stub.
- "Mark unread/read" endpoint — not yet (would PATCH `read_at`).
- Org-level alias provisioning UI — not yet.

These belong to "Phase 6 polish" — pushed if time runs short.

---

## 7. Phase 7 — New backend routes (Growth / Wealth / Training)

New stubs that aggregate from existing tables. Each route is org-scoped and returns derived metrics:

### `routes/growth.routes.js`

```
GET /api/growth/patients     → { new_patients_30d, new_leads_30d, by_source }
GET /api/growth/marketing    → { leads_30d, revenue_pence_30d, by_provider }
GET /api/growth/loyalty      → { active, total }   from memberships
GET /api/growth/booking      → { booked_30d, completed_30d, no_show_30d }   from appointments
GET /api/growth/benchmark    → { industry_median_conversion, industry_median_response_min }  (placeholder)
```

### `routes/wealth.routes.js` (Owner only)

```
GET /api/wealth/net       → { assets, liabilities, net_worth }  from business_health.baseline
GET /api/wealth/fire      → { fire_target_pence, current_savings_pence, years_to_fire }
GET /api/wealth/pension   → placeholder until pension provider OAuth
GET /api/wealth/property  → placeholder until property valuation provider
```

### `routes/training.routes.js`

```
GET /api/training/library     → { courses: [hardcoded 3 sample courses] }
GET /api/training/my          → { user_id, enrolments, completed }
GET /api/training/mentorship  → { programmes: [] }
GET /api/training/one-to-one  → { user_id, sessions: [] }
```

Mounted in `backend/src/app.js`. Frontend slices (`features/growth`, `features/wealth`, `features/training`) can now follow the Phase 1 wiring pattern.

---

## 8. File-by-file change manifest

### Backend (new)

```
backend/src/lib/crypto.js                                  35 lines
backend/src/lib/messaging.js                               80 lines
backend/src/lib/snapshot-utils.js                          40 lines
backend/src/lib/integrations/provider-interface.js         52 lines
backend/src/lib/integrations/index.js                       5 lines
backend/src/lib/integrations/stripe-provider.js            85 lines
backend/src/lib/integrations/broker-provider.js            42 lines
backend/src/lib/integrations/oauth-stub-providers.js      130 lines
backend/src/routes/growth.routes.js                        75 lines
backend/src/routes/wealth.routes.js                        45 lines
backend/src/routes/training.routes.js                      35 lines
```

### Backend (modified)

```
backend/src/app.js                  +3 imports, +3 mounts
backend/src/workers/index.js        snapshot job rewrite; messaging facade swap
backend/src/services/comm.service.js  messaging facade
backend/src/services/business-health.service.js  +updateCadence
backend/src/services/integration.service.js  full rewrite around IntegrationProvider
backend/src/repositories/comm.repository.js  +viewer-aware visibility filter
backend/src/repositories/business-health.repository.js  +updateCadence
backend/src/repositories/integration.repository.js  full rewrite (upsertSecrets etc)
backend/src/controllers/business-health.controller.js  +updateCadence
backend/src/controllers/comm.controller.js  viewer passthrough
backend/src/controllers/integration.controller.js  +callback/refresh/revoke
backend/src/models/business-health.model.js  +cadenceUpdateSchema
backend/src/models/integration.model.js  +callback schema, broker fields
backend/src/routes/health-business.routes.js  +PATCH /cadence
backend/src/routes/integrations.routes.js  full surface
```

### Frontend (new)

```
frontend/features/crm/api.ts            45 lines
frontend/features/crm/hooks.ts          22 lines
frontend/features/integrations/api.ts   55 lines
frontend/features/integrations/hooks.ts 35 lines
```

### Frontend (modified)

```
frontend/features/crm/components/InboxScreen.tsx    rewritten — real /api/comms
frontend/features/crm/components/PipelineScreen.tsx rewritten — real /api/leads
frontend/features/leads/api.ts                       full typed contracts
frontend/features/leads/hooks.ts                     typed useLeads + useUpdateLead
frontend/features/health/api.ts                      +updateCadence, listSnapshots
frontend/features/health/hooks.ts                    +useUpdateCadence, useSnapshots
frontend/features/health/components/ProgressScreen.tsx  +CadenceCard
frontend/features/system/components/IntegrationsScreen.tsx  rewritten — real /api/integrations
```

### Migrations (new)

```
supabase/migrations/20260101000007_business_health_cadence.sql   cadence + source cols
supabase/migrations/20260101000008_integrations.sql              integrations + provider_events + visibility
```

---

## 9. Tests

### Backend

```
test/permissions.defaults.test.mjs        10 ✓
test/permissions.lib.test.mjs             10 ✓
test/permissions.service.test.mjs         10 ✓
test/auth.service.test.mjs                12 ✓
test/auth.middleware.test.mjs              8 ✓
test/auth.guard.test.mjs                   4 ✓
test/auth.grantceiling.test.mjs            5 ✓
test/org-isolation.test.mjs                9 ✓
test/analytics.test.mjs                   24 ✓
test/platform-auth.middleware.test.mjs     8 ✓  ← from parallel Phase 5 session
test/platform-admin.service.test.mjs       5 ✓  ← from parallel Phase 5 session
                                          ─────
                                         105 / 105
```

### Frontend

```
npm run typecheck    ✓ tsc --noEmit clean
npm run lint         ✓ no ESLint warnings
npm run build        ✓ 51 routes built
```

No test additions for the new backend modules this session — flagged as Phase-1.5 work:
- `lib/snapshot-utils.test.mjs` — `isDueForSnapshot`, `windowStart`, `getISOWeek`, `countBySource`.
- `lib/crypto.test.mjs` — round-trip encrypt/decrypt, tampered ciphertext rejected.
- `lib/messaging.test.mjs` — provider routing logic (SES active → SES; revoked → fallback).
- `integration.service.test.mjs` — provider registry, broker key encryption, revoke clears secrets.
- `comm.repository.test.mjs` — visibility filter for owner/manager/reception.

---

## 10. Deployment checklist

To activate everything in production, the following env vars must be set on Railway:

```
# Phase 3 — encryption
INTEGRATIONS_SECRET_KEY=<openssl rand -hex 32>

# Phase 3 — Stripe Connect
STRIPE_CONNECT_CLIENT_ID=ca_xxx
STRIPE_SECRET_KEY=sk_live_xxx
APP_URL=https://app.elevate.app

# Phase 3 — other OAuth providers (only if/when you turn them on)
XERO_CLIENT_ID=...
XERO_CLIENT_SECRET=...
QUICKBOOKS_CLIENT_ID=...
QUICKBOOKS_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
META_APP_ID=...
META_APP_SECRET=...
MAILCHIMP_CLIENT_ID=...
MAILCHIMP_CLIENT_SECRET=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
ZOOM_CLIENT_ID=...
ZOOM_CLIENT_SECRET=...
DOCUSIGN_CLIENT_ID=...
DOCUSIGN_CLIENT_SECRET=...
DROPBOX_CLIENT_ID=...
DROPBOX_CLIENT_SECRET=...

# Phase 4 — AWS (when replacing Postmark/Twilio)
AWS_REGION=eu-west-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Run migrations on hosted Supabase via SQL Editor in this order:

```
20260101000007_business_health_cadence.sql
20260101000008_integrations.sql
NOTIFY pgrst, 'reload schema';
```

---

## 11. Where each user-visible thing now lives

| User action | API call | Tables touched | Worker that processes |
|---|---|---|---|
| Type baseline numbers in Health Setup | `PUT /api/health` | `business_health.baseline` | next snapshot tick rolls into snapshots |
| Pick weekly vs monthly snapshot | `PATCH /api/health/cadence` | `business_health.snapshot_frequency` | daily 02:00 UTC cron honours it |
| Click "Connect Stripe" | `POST /api/integrations/connect` | `integrations` row created with `status='pending'` | OAuth callback flips to `active` |
| Stripe payment succeeds (later) | `POST /webhooks/stripe` | `payments` row, `source='stripe'` | next snapshot includes it via formulas.calculatePL |
| Send email from Composer | `POST /api/comms/send` | `communications` row (outbound), `provider_events` row | none (immediate) |
| Patient replies to email | (Phase 6 not yet wired) | would insert `communications` row with `direction='inbound'` | none |
| Add a lead manually | `POST /api/leads` | `leads.source_provider='manual'` | next snapshot |
| Meta Lead Ad fires (later) | `POST /webhooks/meta_ads` (not yet) | `leads.source_provider='meta_ads'` | next snapshot |
| Reception opens Inbox | `GET /api/comms` (with viewer info) | reads `communications` filtered by visibility | none |
| Owner opens Progress | `GET /api/health/progress` | reads `business_health` + `business_health_snapshots` | none |

---

## 11b. Finance section — data inflow + manual entry

User direction: finance data should flow from connected apps (Dentally, Stripe, Xero) AND allow manual entry as the always-available fallback.

### Inflow architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│              FINANCE DATA INFLOW — every row goes to `payments`           │
└───────────────────────────────────────────────────────────────────────────┘

  Stripe webhook                Dentally polling             Manual entry
  POST /webhooks/stripe         every 15 min cron            POST /api/payments
       │                              │                            │
       │  signature verified          │  lib/integrations/         │  paymentService
       │  raw body parsed             │  dentally-sync.js          │  .createManual()
       │                              │                            │
       ▼                              ▼                            ▼
  payments row               payments row                 payments row
  .source = 'stripe'         .source = 'dentally'         .source = 'manual'
  .external_id = pi_XXX      .external_id = dent_XXX      .external_id = null
  .processed_at = stripe ts  .processed_at = paid_at      .processed_at = picker
  .status = 'settled'        .status = 'settled'          .status = 'settled'
       │                              │                            │
       └──────────────────────────────┴────────────────────────────┘
                                      │
                                      ▼
                            ALL the same downstream:
                            · analytics finance-series
                            · cashflow weekly buckets
                            · financial ratios
                            · snapshot worker → business_health_snapshots
                            · valuation
```

### What was shipped this turn

**Backend:**
- `POST /api/payments` — new manual-entry endpoint. Zod schema `paymentManualCreateSchema` (practice_id required, amount_pence positive int, method/status optional, processed_at defaults to now). Always stamps `source='manual'`. 5-layer wired through controller → service → repository.
- `GET /api/payments/source-breakdown?days=N` — returns `{ stripe: { count, pence }, manual: {...}, dentally: {...} }` over the window. Aggregates from `payments.source` column added in migration 7.
- `GET /api/practices` — minimal list endpoint so finance UIs can pick a practice for manual entries.
- `lib/integrations/dentally-sync.js` — polling worker. `syncOneOrg` and `syncAllOrgs` exported. Reads encrypted key from `integrations.secrets` via `crypto.decryptSecret`. Stubs the actual REST GETs against `api.dentally.co/v1/{patients,appointments,payments}` with detailed inline comments for the real upserts.
- Worker cron — Dentally sync runs every 15 min (`*/15 * * * *`). Only fires for orgs with active dentally integration row.
- Snapshot worker bug fixed — was querying `paid_at` (doesn't exist on `payments`); now uses `processed_at` which is the real column from schema.

**Frontend:**
- `features/finance/api.ts` — `getPaymentSourceBreakdown(days)` + `recordManualPayment(input)` typed clients.
- `features/finance/hooks.ts` — `usePaymentSourceBreakdown(days)` (30s stale) + `useRecordManualPayment()` (invalidates all finance queries on success).
- `features/finance/components/SourceBreakdownCard.tsx` — visual breakdown with per-provider bar widths, total pounds, count + %. Shows on Profit screen above the chart. Empty state directs owner to connect apps or add manual.
- `features/finance/components/ManualPaymentModal.tsx` — full form: practice dropdown, amount in pounds (converts to pence), method dropdown (cash/card/bank_transfer/direct_debit/finance/pay_link), date picker, optional description. Submit calls `useRecordManualPayment` → toast-less invalidation (UI refreshes).
- `ProfitScreen.tsx` — header now has "+ Add payment" (teal, disabled if no practices loaded) and "Export to PDF". Modal mounts on click. SourceBreakdownCard renders between header and chart. `useEffect` fetches `/api/practices` on mount.

### Trust signal for owners

The SourceBreakdownCard is the answer to "is this real data or am I looking at numbers I typed?" Every finance screen reads from `payments`; the breakdown shows the provenance ratio. As more Stripe/Dentally syncs land, the manual slice naturally shrinks — without changing any UI logic.

### Files this addendum

```
backend/src/lib/integrations/dentally-sync.js           NEW
backend/src/routes/practices.routes.js                  NEW
backend/src/routes/payments.routes.js                   +source-breakdown, +POST /
backend/src/controllers/payment.controller.js           +createManual, +sourceBreakdown
backend/src/services/payment.service.js                 +createManual, +sourceBreakdown
backend/src/repositories/payment.repository.js          +insertManual, +sourceBreakdown
backend/src/models/payment.model.js                     +paymentManualCreateSchema
backend/src/workers/index.js                            +dentally-sync cron, bug fix
backend/src/app.js                                      +/api/practices mount

frontend/features/finance/api.ts                        +source breakdown + manual
frontend/features/finance/hooks.ts                      +useRecordManualPayment, +useSourceBreakdown
frontend/features/finance/components/SourceBreakdownCard.tsx  NEW
frontend/features/finance/components/ManualPaymentModal.tsx   NEW
frontend/features/finance/components/ProfitScreen.tsx   +modal, +SourceBreakdownCard
```

All green: backend 105/105, frontend typecheck + lint + build.

---

## 12. Outstanding work (next sessions)

Phase 1 still has unwired slices:

- CRM Today, Enquiries, Templates, Sequences, Reports, Settings, Pages screens (still mock).
- Operations PayScreen + data.ts (route exists).
- Intelligence Debt/Tax/Alerts (analytics route partial).
- overview/AiInsightsScreen (mock leftover).
- health/KpiScorecardScreen (mock leftover — needs baseline jsonb to carry all 23 KPI values first).
- growth/wealth/training screens (new backend routes ready; UI not yet swapped).

Phase 4:
- Replace `sendViaSES` / `sendViaSNS` stubs with real `@aws-sdk/client-sesv2` and `@aws-sdk/client-sns` calls.
- Build SES domain verification endpoint + DNS-record UI.
- Build SNS pool provisioning + sender-ID registration flow.

Phase 6:
- UI for org_email_aliases CRUD.
- Inbound webhook routing — parse `To:`, match alias, insert `communications` with correct visibility.
- Mark-as-read PATCH endpoint.

Phase 7 polish:
- Real provider syncs (Dentally polling worker, Xero P&L pull, Mailchimp campaign sync).
- Webhook signature verification per provider (Stripe done elsewhere; rest are placeholders).

---

## 13. Recommended next 5 actions

1. **Run migrations on hosted Supabase.** `…000007` + `…000008` + `NOTIFY pgrst, 'reload schema'`. Without these the new endpoints will 500 in prod.
2. **Set `INTEGRATIONS_SECRET_KEY` env var.** Without it broker-key paste flow throws. Same key must be set everywhere (workers, API, future migrations) — losing it means existing encrypted secrets are unreadable.
3. **Wire one more Phase 1 slice end-to-end** (recommend Operations PayScreen — backend ready, single screen). Proves the pattern across two domains.
4. **Implement real `sendViaSES`.** Drop-in `@aws-sdk/client-sesv2`. ~30 lines. Unlocks per-tenant email reputation isolation.
5. **Coordinate with Phase 5 session** on the route-mount line in `backend/src/app.js`. Their `/api/platform` mount is already there (line 145); confirm no conflict before pushing.
