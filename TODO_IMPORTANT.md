# TODO_IMPORTANT.md

Strategic backlog captured 2026-05-20. Ordered by execution priority. Top item (backend wiring) is the active workstream; everything below it is queued for after the ~50 dashboard screens are talking to real APIs.

---

## PHASED EXECUTION PLAN

Sequential phases. Do not start phase N+1 until phase N is fully shipped and ticked off in `completed-tasks.md`. Each phase produces an entry in `completed-tasks.md` on completion.

```
PHASE 1: Backend wiring (mock → real API)            ~10 working days
  └── unblocks every dashboard screen showing real numbers
PHASE 2: Business Health calc engine + cadence       ~3 days
  ├── Replace stub snapshot worker with formula calc
  ├── Add user-selectable weekly/monthly cadence
  └── Manual-entry UI tab (already-existing form, polish)
PHASE 3: Connect-App OAuth foundation                ~4 days
  ├── integrations table + IntegrationProvider interface
  ├── Settings → Integrations UI shell
  └── Stripe Connect end-to-end (highest value first)
PHASE 4: Per-tenant AWS messaging                    ~8 days
  ├── SES domain verification per org
  ├── SNS SMS pool per org
  └── Migrate workers off Postmark/Twilio
PHASE 5: Platform-admin (super-admin) layer          ~6 days
  ├── platform_admins table + auth path
  ├── /api/admin/* routes + serviceClient bypass
  └── app/(admin)/ UI route group
PHASE 6: Intra-org email visibility                  ~3 days
  ├── communications.visibility + assigned_user_id
  ├── Inbox repo filter by viewer
  └── Inbound routing via org_email_aliases
PHASE 7: Additional OAuth providers                  Per provider 2-5 days
  ├── Google (Calendar, Gmail)
  ├── Xero / QuickBooks
  ├── Dentally (broker, encrypted key)
  ├── Meta / Google Ads
  └── ... per tenant demand
```

Total to baseline-ship multi-tenant SaaS with all four owner asks (manual + OAuth, weekly/monthly cadence, platform monitoring, per-tenant messaging): **~34 working days**.

---

## 0. ACTIVE — Backend wiring for existing UI (do this first)

51 dashboard pages, 16 feature slices. Status audit 2026-05-20:

**Wired (8):** `contacts`, `leads`, `payments`, `settings`, `system`, `finance`, `dashboard`, `overview` (partial — `AiInsightsScreen.tsx` still mock).

**Partial (1):** `health` — `KpiScorecardScreen.tsx` still mock.

**Not wired (7):** `crm`, `growth`, `intelligence`, `operations`, `wealth`, `training`, plus leftover mock screens.

Missing backend routes: `growth.routes.js`, `wealth.routes.js`, `training.routes.js`. Intelligence partial via `analytics.routes.js`.

**Effort:** ~12 working days total.
- ~4 days: existing-route + UI swap (crm, operations, leftover overview/health/intelligence/AiInsights).
- ~8 days: new route + service + repo + UI (growth, wealth, training).

Every other item in this file is blocked on this.

**Plan of attack:**
- One feature slice at a time: contacts → leads → payments → dashboard → health → settings.
- For each slice:
  1. Confirm backend routes exist under `backend/src/routes/<domain>.routes.js` (controller → service → repository → models layering preserved).
  2. Confirm Zod schemas in `backend/src/models/<domain>.js` match what UI sends.
  3. Frontend: swap `features/<domain>/data.ts` mock for `lib/api.ts` calls. `lib/api.ts` already proxies through `app/api/backend/[...path]/route.ts` (httpOnly cookie auth — do not regress).
  4. React Query hooks in `features/<domain>/hooks.ts` — keys per org+filters.
  5. Loading/empty/error states. No skeletons swapped for spinners; existing skeleton components stay.
  6. Cross-org isolation test added to backend vitest suite for any new repo method.
- Money stays integer pence end-to-end. Display via `lib/format.ts` (`(pence/100).toLocaleString('en-GB')`).
- British English (organisation, colour, optimise, centre). No emojis. No dark mode.
- Reception role keeps Inbox/Pipeline/Contacts only — enforce at route guard, not just sidebar.
- Audit every mutation to `audit_log` (already wired in `middleware/audit.js`; just don't bypass).

**Gotchas:**
- Repos use `serviceClient` (bypasses RLS) and rely on manual `.eq('organisation_id', orgId)` chaining. Every new repo method MUST replicate that filter — there is no automatic isolation on this path. `req.db` (RLS-scoped) exists but is not the current pattern.
- `npm run migrate` script is broken (points at non-existent file). Migrations are Supabase-managed; run `supabase db reset` from repo root.
- After any DDL on hosted Supabase: `NOTIFY pgrst, 'reload schema';` (PostgREST cache goes stale — recurring foot-gun).
- Two pending hosted migrations: `20260101000005_role_permissions.sql`, `20260101000006_user_status.sql`. App works without them via code defaults but admin per-org perm customisation + `users.status` need them.

---

## 0.5. PHASE 2 — Business Health calc engine, cadence, manual + OAuth UI

User-facing requirements (from 2026-05-20 conversation):
1. Both **manual entry** AND **OAuth/Connect-App** as data sources, surfaced as visible UI options.
2. Snapshot **cadence is user-chosen** (weekly OR monthly) per organisation.
3. Make it transparent where data is stored.

### Storage map (where data lives)

```
USER MANUAL ENTRY
   Settings → Business Health → "Enter Manually" tab
   PATCH /api/health
        ▼
   business_health.baseline JSONB   (one row per org, mutable)
        │
        │  (cron worker reads on cadence)
        ▼
   business_health_snapshots        (append-only history)


OAUTH / CONNECT-APP DATA
   Settings → Business Health → "Connect Apps" tab
   Stripe / Xero / Dentally / Meta / etc.
        ▼
   Provider webhook → /webhooks/<provider>
        ▼
   payments.source='stripe'         (existing table — new source col)
   leads.source='meta_ads'
   appointments.source='dentally'
        │
        │  (cron worker queries + runs lib/formulas.js)
        ▼
   business_health_snapshots        (same destination as manual)


SNAPSHOT WORKER (replacing stub at backend/src/workers/index.js:14-44)
   For each org:
     1. read business_health.snapshot_frequency
     2. if due (weekly: every Mon 02:00 UTC | monthly: 1st 02:00 UTC):
        a. query payments + leads + appointments + contacts (filtered by date window + org)
        b. merge with business_health.baseline (manual overrides for fields nothing reports on)
        c. call lib/formulas.js → { pl, valuation, ltv, marketingROI, kpis, cashFlow }
        d. INSERT INTO business_health_snapshots (label, metrics)
     3. else skip
```

### Schema changes

```sql
-- Migration: 20260101000007_business_health_cadence.sql

ALTER TABLE business_health
  ADD COLUMN snapshot_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (snapshot_frequency IN ('weekly', 'monthly')),
  ADD COLUMN last_snapshot_at TIMESTAMPTZ;

ALTER TABLE payments      ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE leads         ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE appointments  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE contacts      ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
-- Valid sources documented in code, not enforced via CHECK so providers can be added without migrations:
--   manual | stripe | xero | quickbooks | dentally | soe | google_ads | meta_ads | google_calendar | mailchimp | ...

CREATE INDEX idx_payments_source     ON payments(organisation_id, source);
CREATE INDEX idx_leads_source        ON leads(organisation_id, source);
CREATE INDEX idx_appointments_source ON appointments(organisation_id, source);

-- Schema reload after migrate:
-- NOTIFY pgrst, 'reload schema';
```

### Backend changes

**File: `backend/src/workers/index.js` — rewrite snapshot job**

Replace lines 14-44. New logic:

```js
import * as formulas_1 from "../lib/formulas.js";

// Snapshot job — runs daily at 02:00 UTC, decides per-org whether to fire
node_cron_1.default.schedule('0 2 * * *', async () => {
    const today = new Date();
    const isMonday = today.getUTCDay() === 1;
    const isFirstOfMonth = today.getUTCDate() === 1;

    const { data: orgs } = await supabase_1.serviceClient
        .from('organisations')
        .select('id, business_health(snapshot_frequency, baseline, last_snapshot_at)')
        .neq('subscription_plan', 'cancelled');

    for (const org of orgs || []) {
        const bh = org.business_health?.[0];
        if (!bh) continue;
        const due =
            (bh.snapshot_frequency === 'weekly'  && isMonday) ||
            (bh.snapshot_frequency === 'monthly' && isFirstOfMonth);
        if (!due) continue;

        try {
            const windowStart = bh.snapshot_frequency === 'weekly'
                ? new Date(today.getTime() - 7  * 86400000)
                : new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

            const [payments, leads, appointments] = await Promise.all([
                supabase_1.serviceClient.from('payments')
                    .select('amount_pence, source, paid_at')
                    .eq('organisation_id', org.id)
                    .gte('paid_at', windowStart.toISOString()),
                supabase_1.serviceClient.from('leads')
                    .select('source, status, value_pence')
                    .eq('organisation_id', org.id)
                    .gte('created_at', windowStart.toISOString()),
                supabase_1.serviceClient.from('appointments')
                    .select('source, status, starts_at, value_pence')
                    .eq('organisation_id', org.id)
                    .gte('starts_at', windowStart.toISOString()),
            ]);

            const metrics = {
                pl:            formulas_1.calculatePL(payments.data, bh.baseline),
                valuation:     formulas_1.calculateValuation(bh.baseline),
                ltv:           formulas_1.calculateLTV(payments.data, appointments.data),
                marketingROI:  formulas_1.calculateMarketingROI(leads.data, payments.data),
                kpis:          formulas_1.calculateKPIs({ payments: payments.data, appointments: appointments.data, leads: leads.data, baseline: bh.baseline }),
                cashFlow:      formulas_1.calculateCashFlow(payments.data, bh.baseline),
                window: { from: windowStart.toISOString(), to: today.toISOString() },
                source_breakdown: countBySource([payments.data, leads.data, appointments.data]),
            };

            const label = bh.snapshot_frequency === 'weekly'
                ? `Week ${getISOWeek(today)}-${today.getUTCFullYear()}`
                : `${today.toLocaleString('en-GB', { month: 'short', year: 'numeric' })}`;

            await supabase_1.serviceClient.from('business_health_snapshots').insert({
                organisation_id: org.id,
                snapshot_date: today.toISOString().split('T')[0],
                label,
                metrics,
            });

            await supabase_1.serviceClient.from('business_health')
                .update({ last_snapshot_at: today.toISOString() })
                .eq('organisation_id', org.id);
        } catch (err) {
            console.error(`Snapshot failed for org ${org.id}`, err);
        }
    }
});
```

Helpers `countBySource()` and `getISOWeek()` go in `backend/src/lib/snapshot-utils.js` (new).

**File: `backend/src/routes/health.routes.js`** — add `PATCH /api/health/cadence` endpoint:

```js
router.patch('/cadence', requireRole('owner'),
  asyncHandler(healthController.updateCadence));
```

Controller validates `{ snapshot_frequency: 'weekly' | 'monthly' }` via Zod, calls `healthService.updateCadence(orgId, frequency)`, repo updates the row.

### Frontend changes

**Route: `app/(dashboard)/health/setup/page.tsx`** — Settings → Business Health page becomes a tabbed interface:

```
┌─────────────────────────────────────────────────────────────────┐
│  Business Health                                                 │
│                                                                  │
│  Snapshot frequency:  [ Weekly ▾ ]  [ Monthly ]                  │
│  Last snapshot: 1 May 2026 — Apr 2026                            │
│                                                                  │
│  ┌──────────────────┬──────────────────────────────────────┐    │
│  │  Enter Manually  │  Connect Apps                         │    │
│  ├──────────────────┴──────────────────────────────────────┤    │
│  │                                                           │   │
│  │  (Manual tab) — existing baseline form, polished        │   │
│  │  - Revenue                                              │   │
│  │  - Costs                                                │   │
│  │  - Headcount                                            │   │
│  │  - Targets                                              │   │
│  │  Save → PATCH /api/health                               │   │
│  │                                                           │   │
│  │  (Connect Apps tab)                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │  Stripe     │  │  Xero       │  │  Dentally   │     │   │
│  │  │  [Connect]  │  │  [Connect]  │  │  [Connect]  │     │   │
│  │  │ ⓘ payments  │  │ ⓘ P&L data  │  │ ⓘ appoints  │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  │  ┌─────────────┐  ┌─────────────┐                       │   │
│  │  │  Meta Ads   │  │  Google Ads │  ... more             │   │
│  │  │  [Connect]  │  │  [Connect]  │                       │   │
│  │  └─────────────┘  └─────────────┘                       │   │
│  │                                                           │   │
│  │  Already connected providers show as:                   │   │
│  │  ✓ Stripe — last sync 2 minutes ago [Disconnect]        │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

Components to add:
- `frontend/features/health/components/CadenceSelector.tsx` — segmented control.
- `frontend/features/health/components/IntegrationsTab.tsx` — grid of provider cards.
- `frontend/features/health/components/ProviderCard.tsx` — Connect button + status.
- `frontend/features/health/components/ManualEntryTab.tsx` — existing form refactored out.
- Tab container reuses existing `components/ui/Tabs` primitive.

API hooks (React Query) under `frontend/features/health/hooks.ts`:
- `useHealthSettings()` — GET cadence + last_snapshot_at.
- `useUpdateCadence()` — PATCH cadence.
- `useIntegrations()` — GET connected providers (returns no secrets).
- `useStartConnect(provider)` — POST `/api/integrations/:provider/connect`, redirects to OAuth.

### Tests

- `backend/src/lib/formulas.test.js` — extend with snapshot-input cases (already mostly covered for individual formulas).
- `backend/src/workers/snapshot.test.js` (new) — unit test for `due` logic (mock dates → assert which orgs fire), `countBySource()`, `getISOWeek()`.
- `backend/src/services/health.service.test.js` — cadence update validates input, rejects non-owner role.
- Integration: insert payments/leads/appointments across two orgs, run worker, assert org A snapshot has only org A data (cross-org isolation).

### Effort & order within phase

1. Migration `…000007` — 30 min.
2. Schema reload + verify on hosted Supabase — 15 min.
3. Snapshot worker rewrite + helpers + tests — 1 day.
4. `PATCH /api/health/cadence` + controller + service + Zod schema — 2 hours.
5. Frontend tabs, CadenceSelector, ManualEntryTab refactor — 1 day.
6. IntegrationsTab + ProviderCard (UI only — wiring to real OAuth happens in Phase 3) — 0.5 day.

Total Phase 2: **~3 working days**.

### Acceptance criteria (Phase 2 done means)

- [ ] Owner can pick weekly or monthly in Settings → Business Health and see immediate effect on next snapshot.
- [ ] Cron worker queries real payments/leads/appointments and stores formula output in `business_health_snapshots`, not stub baseline.
- [ ] `business_health_snapshots.metrics.source_breakdown` shows where data came from.
- [ ] Settings page has visible "Enter Manually" + "Connect Apps" tabs. Connect-Apps tab can show provider cards even if no provider is wired yet (cards are disabled/coming-soon placeholders until Phase 3 lights them up).
- [ ] All migrations + endpoints + UI changes logged in `completed-tasks.md` with date.

---

## 1. Platform-admin layer (super-admin / "us, the SaaS owners")

We need our own monitoring surface separate from tenant users. Currently zero code for this. `users.role` CHECK constraint = `owner | practice_manager | reception` — excludes any platform role on purpose.

### Scope
- Track every tenant: org count, signups/day, MRR, churn, active users, integration health, error rate, audit log search, support impersonation (read-only).
- Completely separate auth path and UI — tenant users must never see this surface and must not be able to escalate.
- Platform admins are the **only** human path allowed to use `serviceClient` (currently restricted to webhooks/workers).

### Backend
- New table `platform_admins(id, email, role, created_at)`. `role` enum: `superadmin | support | readonly`. NOT in `public.users` — keeps RLS model clean and prevents a tenant owner from ever flipping a flag to become platform admin.
- New auth path `/admin/login` against `platform_admins`. Separate JWT or session — do NOT reuse tenant Supabase JWT.
- New middleware `requirePlatformAdmin(...roles)`.
- New routes under `/api/admin/*`:
  - `GET /admin/orgs` — list all organisations + counts (users, contacts, leads, MRR).
  - `GET /admin/orgs/:id` — drill-down, read-only.
  - `GET /admin/users` — global user search.
  - `GET /admin/metrics/overview` — signups, MRR, churn, active orgs (last 7/30/90d).
  - `GET /admin/audit` — cross-org audit log search.
  - `GET /admin/integrations/health` — per-provider error counters.
  - `POST /admin/impersonate/:org_id` — issues a short-lived read-only token scoped to that org, logged to audit. Cannot mutate.
- All `/admin/*` routes use `serviceClient` and log every request to a new `platform_audit_log` table (who, what, which org, when, IP).

### Frontend
- New route group `app/(admin)/` — separate layout, separate top-bar/sidebar. No tenant chrome.
- Pages: Overview (metrics), Organisations, Users, Audit, Integrations, Impersonate.
- Reuse `components/ui` primitives, no new design system.
- Login at `/admin/login` — completely separate from tenant `/login`.

### Effort
5–7 days.

---

## 2. Per-tenant outbound messaging via AWS (replace Postmark + Twilio)

### Current state (verified in code 2026-05-20)
- `backend/src/lib/postmark.js:4` — single `ServerClient(process.env.POSTMARK_SERVER_TOKEN)`. `sendEmail()` defaults `From` to `POSTMARK_FROM` or `no-reply@elevate.app`.
- `backend/src/lib/twilio.js:4` — single client from `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`. `sendSMS()` sends from `TWILIO_FROM_NUMBER`.
- Callers:
  - `services/comm.service.js:14` — `commService.send(orgId, input)` user-triggered. Receives `orgId` but never uses it for routing.
  - `workers/index.js:58` — weekly digest cron (Mon 06:00 UTC).
  - `workers/index.js:102` — workflow runner cron, `send_email` step.
- Inbound webhooks:
  - `routes/webhooks.routes.js:10-11` — `/webhooks/postmark/inbound`, `/webhooks/twilio/inbound`.
  - `services/webhook.service.js:34,38` — `postmarkInbound()` / `twilioInbound()` are empty TODO stubs.
- **Effective model:** Model A (shared). Every tenant sends from `no-reply@elevate.app` and one Twilio number. Org isolation stops at the DB log row.

### Target — AWS, per-tenant identity
**Why AWS over Postmark/Twilio:**
- SES = ~$0.10/1k emails vs Postmark $1.25/1k (12x cheaper at scale).
- Already likely in stack (S3/RDS). Single bill. Better IAM/VPC/compliance posture (helpful for dental data).
- SMS pricing comparable to Twilio (~£0.04/SMS UK) — savings marginal there.

**Costs / pain to accept:**
- SES sandbox cap 200/day until production access granted (24–48h support ticket).
- Bounce/complaint handling = we wire SNS topics + Lambdas + DLQs ourselves (Postmark gives this in UI for free).
- Deliverability reputation building is on us — warmup period needed.
- UK SMS Sender ID registration still required (same Ofcom-aligned hurdle as Twilio).
- No Twilio-style subaccount in SNS — isolation via Pools + Originators + IAM tags.

### Email — Amazon SES (per-tenant verified domains)
- Replace `lib/postmark.js` with `lib/ses.js`. Same signature, but takes `orgId` and resolves tenant identity.
- Per-tenant flow:
  1. Tenant adds `mail.theirdental.co.uk` in Settings → Integrations → Email.
  2. Backend calls `SES:CreateEmailIdentity`, stores `domain_id` in `integrations` table.
  3. Return DKIM CNAMEs + SPF + DMARC TXT records to UI. Tenant pastes into their DNS.
  4. Backend polls `GetEmailIdentity` until `VerificationStatus=SUCCESS` → flip `verified_at`.
  5. Subsequent `sendEmail({ orgId, ... })` calls use `FromEmailAddress = tenant.from_address` and `Configuration Set = org-<id>`.
- One **Configuration Set per tenant** → isolated bounce/complaint tracking, separate suppression lists, CloudWatch metrics per tenant.
- SNS topic per Configuration Set for bounce/complaint → Lambda → write to `email_events` table tagged with `org_id`.
- Fallback: if tenant not verified, send from platform default (`no-reply@elevate.app`) so onboarding isn't blocked.

### SMS — AWS End User Messaging (formerly Pinpoint SMS) / SNS
- Replace `lib/twilio.js` with `lib/sns.js`.
- Per-tenant: create a **Pool** + assign **Originator** (phone number or registered Sender ID). Store `pool_id` + `origination_identity` in `integrations`.
- No subaccount construct — isolation via IAM policies + resource tags + per-pool spending limits.
- Inbound SMS: configure two-way on the pool, inbound goes to SNS topic → webhook → route by `to_number` lookup to org.
- WhatsApp Business (optional, later): AWS End User Messaging Social (2024+) supports it; tenant's WABA still needs Meta embedded signup.

### Schema additions
```
integrations (
  id uuid pk,
  organisation_id uuid not null fk,
  provider text not null,            -- 'ses' | 'sns_sms' | 'stripe' | 'google' | ...
  config jsonb not null default '{}', -- domain_id, from_address, pool_id, origination_identity, etc.
  status text not null default 'pending', -- 'pending' | 'verifying' | 'active' | 'failed' | 'revoked'
  verified_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organisation_id, provider)
)

email_events (
  id uuid pk,
  organisation_id uuid not null fk,
  message_id text,
  event_type text,           -- 'delivered' | 'bounce' | 'complaint' | 'open' | 'click'
  payload jsonb,
  created_at timestamptz default now()
)
```

### API surface
- `POST /api/integrations/ses/domain` — body `{ domain }`. Creates SES identity, returns DNS records.
- `GET  /api/integrations/ses/status` — polls verification.
- `POST /api/integrations/sns/number` — provisions Pool + Originator. Returns number.
- `DELETE /api/integrations/:provider` — revoke.
- Hosted UI under Settings → Integrations.

### Code touchpoints
- `lib/ses.js` (new) — `sendEmail({ orgId, to, subject, body, ...})`. Looks up `integrations` row, falls back to platform default.
- `lib/sns.js` (new) — `sendSMS({ orgId, to, body })`. Same pattern.
- `services/comm.service.js` — pass `orgId` through (already has it, currently ignored at provider call).
- `workers/index.js` — both callers pass `orgId` from the cron loop.
- `services/webhook.service.js` — implement `postmarkInbound`/`twilioInbound` equivalents for SES SNS topics + SMS inbound.
- Delete `lib/postmark.js` + `lib/twilio.js` after migration.

### Phasing (recommended)
- **Phase 0 (pre-launch, low volume):** keep Postmark + Twilio. Ship faster, dental practices send low volume, deliverability handled by vendor.
- **Phase 1 (>500k emails/mo OR >50 tenants):** migrate email to SES with Configuration Sets.
- **Phase 2:** migrate SMS to SNS only if Twilio cost becomes painful. SMS migration is rarely worth the engineering at sub-100k/mo.
- Hybrid is fine: SES transactional, Postmark marketing, Twilio SMS — pick per-channel.

### Effort
- SES per-tenant domain verification: 3–4 days.
- Pinpoint SMS per-tenant numbers: 4–6 days (excluding regulatory wait).

---

## 3. Intra-org email visibility & inbound routing

Inside an org, owner emails must not be visible to reception. Currently `Inbox` UI is org-wide.

### Current state
- `communications` table has `organisation_id`, `contact_id`, `lead_id`, `direction`, `external_id` — no visibility/ownership column.
- Inbound webhooks are no-op stubs (`services/webhook.service.js:34,38`).
- Reception role limited by sidebar gating only — if they hit `/api/communications` they see all org rows.

### Changes
- Add `communications.visibility` enum: `org | role:owner | role:practice_manager | user:<uuid>`.
- Add `communications.assigned_user_id uuid` for inbox-ownership of threads.
- Repo `list()` adds filter: hide rows where viewer's role/id doesn't match visibility. Owner-equivalent always sees everything in their org.
- Inbound routing rule table `org_email_aliases(org_id, local_part, visibility, assigned_user_id)`:
  - `accounts@theirdental.co.uk` → `role:owner`
  - `reception@theirdental.co.uk` → `role:reception`
  - `info@theirdental.co.uk` → `org`
- Inbound SES (or Postmark) webhook parses `To`, matches alias, writes `communications` row with correct visibility.
- Same model for SMS — phone-number-to-visibility mapping in `org_sms_routes`.

### Effort
3–4 days.

---

## 4. "Connect App" OAuth integrations (do AFTER backend wiring is done)

**Locked decision 2026-05-20:** OAuth / Connect-App is the ONLY integration UX. Zero user-facing API-key input fields. Where a provider has no OAuth (Dentally, SOE), we use a **platform-broker fallback** — owner pastes their key ONCE in a "Connect" modal, backend encrypts with pgcrypto, key is never displayed back in the UI. End-user sees the same "Connect" button on every provider; the one-time key-paste is hidden behind it for the two PMS holdouts. No exceptions, no "advanced settings" key field, no env-var-per-tenant.

Tenants click "Connect Stripe" etc. We are the hub; provider-to-provider data flows through our backend.

### Achievable count: ~15–20 useful integrations

**True OAuth (zero user keys):**
- Stripe (Connect) — payments, payouts
- Google (Calendar, Gmail, Drive) — appointments, comms
- Microsoft 365 / Outlook — same
- Xero, QuickBooks, FreeAgent, Sage — accounting
- Mailchimp, HubSpot — marketing/CRM
- Slack — notifications
- Zoom — virtual consults
- Meta (FB/Instagram Lead Ads) — lead capture
- Google Ads, Meta Ads — marketing ROI
- DocuSign — consent forms
- Dropbox — file sync

**Platform-broker providers (one-time encrypted key paste, no OAuth available):**
- Dentally — Bearer token only, rate-limited, partial webhooks (polling required for some events). Key stored encrypted, never re-displayed.
- SOE / Software of Excellence Exact — dental PMS, API-key only. Same broker treatment.
- Companies House — public API, single platform-wide key (no per-org).

**Storage rule for broker providers:** `integrations.config` jsonb encrypted at rest via pgcrypto (`pgp_sym_encrypt`/`pgp_sym_decrypt`) with master key in env. Decryption only happens inside service-layer provider client code, never returned in API responses. GET on integrations returns `{ provider, status, verified_at, last_error }` — never the secret. Re-connect requires re-paste.

### Design — single `IntegrationProvider` interface
```
interface IntegrationProvider {
  authorize(orgId): { redirectUrl }       // start OAuth
  callback(orgId, code, state)            // exchange + store tokens
  refresh(orgId)                          // refresh access token
  revoke(orgId)
  webhook(payload, signature)             // inbound events
}
```

Implementations live in `backend/src/integrations/<provider>/`. Token storage uses the same `integrations` table from §2 (reuse — don't fork the schema). Encrypt tokens at rest with Supabase Vault or pgcrypto.

### Cross-app data flows (the "automatic" part)
- Dentally appointment created → push to Google Calendar
- Stripe payment succeeded → Xero invoice + Dentally ledger update
- Meta Lead Ads form → contact in CRM → Mailchimp sequence
- Dentally treatment plan signed (DocuSign) → Stripe payment link sent (SMS via §2)
- All orchestrated server-side. Provider-to-provider data never bypasses our backend.

### Phasing
1. Ship `IntegrationProvider` interface + token storage + Settings → Integrations UI shell.
2. Stripe Connect first (highest value, cleanest OAuth, biggest revenue lever).
3. Google Calendar/Gmail second.
4. Xero/QuickBooks third (accounting hooks unlock financial reporting screens).
5. Dentally fourth (API-key flow, polling worker).
6. Others on tenant demand.

### Effort
- Interface + storage + Settings UI: 3 days.
- Per provider: 2–5 days each depending on webhook complexity and refresh flow.

---

## Multi-tenancy status snapshot (what already works)

**Org isolation: solid.**
- `organisations` + every business table has `organisation_id NOT NULL FK ON DELETE CASCADE` (`supabase/migrations/20260101000001_schema.sql`).
- RLS policies live (`...000002_rls.sql`).
- Custom Access Token Hook injects `organisation_id` into JWT (`...000004_access_token_hook.sql`) — Supabase rule 8, app silently returns zero rows without it.
- Backend repos manually filter `.eq('organisation_id', orgId)` on every query (belt + braces with RLS).
- `middleware/auth.js` loads `req.user.organisation_id`, passes through controller → service → repo.
- Cross-org isolation has vitest coverage.

**Intra-org roles: schema solid, routing partial.**
- `users.role` CHECK constraint: `owner | practice_manager | reception` (schema line 68).
- Dynamic RBAC: `role_permissions` table + `backend/src/lib/permissions.js` catalog.
- Precedence: `catalog-deny < CODE DEFAULT_ROLE_PERMISSIONS < DB role_permissions < users.permissions`.
- Owner-toggle for Practice Manager finance access — endpoint-level.
- Reception locked to Inbox/Pipeline/Contacts — sidebar-level (NEEDS endpoint-level enforcement too).
- Email visibility inside org: not implemented (see §3).

**Auth:**
- Invite → set password → active flow.
- Orphan-safe signup (reclaims dangling `auth.users`).
- removeMember deletes both `public.users` and `auth.users`.
- httpOnly cookie JWT, same-origin proxy at `app/api/backend/[...path]/route.ts` injects Bearer server-side. No token in client JS — do not regress.

**Not done:** platform-admin role (§1), per-tenant messaging identity (§2), intra-org email visibility (§3), OAuth integrations (§4).

---

## Cross-cutting rules (do not violate when implementing any of the above)

1. No dark mode — light/white only.
2. Money in £ pence integers; display `(pence/100).toLocaleString('en-GB')`.
3. Tenant isolation: every business table has `organisation_id`; only webhooks/workers + platform admins (§1) may use `serviceClient`.
4. British English in all UI (organisation, colour, optimise, centre).
5. Reception role = CRM only (Inbox, Pipeline, Contacts). Practice Manager finance access is owner-toggled.
6. "Italy Implant Residency" is not a live offering — exclude.
7. No emojis in code/UI except explicitly specified spots.
8. Supabase Custom Access Token Hook is critical — RLS returns zero rows without it.
9. Audit every mutation to `audit_log`.
10. Stripe webhook needs raw body — `express.raw` on `/webhooks/stripe` BEFORE global JSON parser. Same will apply to AWS SNS webhooks (signature verification needs raw bytes).
11. All new financial formulas update `docs/FORMULAS.md` + add unit test.
12. New endpoints update `docs/API.md`.

## Platform admin (Phase 5) follow-ups

- [ ] Audit retention: `platform_audit_log` rows include IP + UA + payload across tenants. GDPR scope. Add TTL (e.g., 18 months) via pg_cron or scheduled worker.
- [ ] Multi-factor auth for platform admins (TOTP). Bootstrap superadmin has root over every tenant — single password is too weak.
- [ ] Platform admin password reset flow. Current: manual DB reset. Build /platform/forgot-password using Postmark.
- [ ] Subdomain split: move `(platform)/*` to `admin.elevate.app` so platform JS bundle never ships to tenant browsers (defence in depth).
- [ ] Real impersonation (one-time Supabase magic link, time-boxed, fully audited) — Phase 6 if needed.
