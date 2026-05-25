# pending.md

Everything not done. Newest items at top. Counts at end of each section.

Captured 2026-05-20.

---

## 1. Phase 1 — Frontend wiring (mock → real API)

8 of 16 feature slices wired. 7 still mock or partially mock.

### Not wired

| Slice | Screens still on mock | Backend route status | Effort |
|---|---|---|---|
| crm | Today, Enquiries, Templates, Sequences, Reports, Settings, Pages, Workflows (8 of 10) | Templates needs new table; rest exist | 3 days |
| operations | PayScreen + data.ts | `pay-runs.routes.js` + `tasks.routes.js` exist | 0.5 day |
| intelligence | Debt, Tax, Alerts screens | `analytics.routes.js` partial | 1 day |
| growth | Patients, Loyalty, Booking, Benchmark, Marketing (5 screens) | `growth.routes.js` shipped this session | 1.5 days |
| wealth | data.ts placeholder | `wealth.routes.js` shipped this session | 1 day |
| training | 5 placeholder components | `training.routes.js` shipped this session | 1 day |
| overview | `AiInsightsScreen.tsx` leftover mock | `analytics.routes.js` | 0.5 day |
| health | `KpiScorecardScreen.tsx` leftover mock | needs all 23 KPIs in baseline first | 1 day |

**Total Phase 1 pending: ~9.5 working days.**

### Phase 1 Templates table — new schema work

`crm/Templates` screen needs:
- Migration `20260101000011_templates.sql` — `templates(id, org_id, channel, subject?, body, variables[])`
- `routes/templates.routes.js` + 5-layer stack
- Frontend `features/crm/api.ts` extension + `TemplatesScreen` wiring

---

## 2. Phase 2 — Business Health

Done: cadence, snapshot worker rewrite, source columns. Remaining:

- Hosted Supabase: apply migrations `…000007` and `…000008` via SQL Editor, `NOTIFY pgrst, 'reload schema';`
- KPI scorecard screen wiring (depends on Phase 1 #8)
- Unit tests for `snapshot-utils.js` (`isDueForSnapshot`, `windowStart`, `getISOWeek`, `countBySource`)
- Integration test: insert payments for 2 orgs, run worker, assert snapshots are org-scoped
- Frontend: snapshot timeline view (list `business_health_snapshots` with sparkline of `metrics.pl.revenue` over time)

---

## 3. Phase 3 — Connect-App OAuth

Real OAuth shipped for Stripe (Connect). 9 OAuth stubs + 2 broker stubs ready to flip on once env vars set.

### Per provider — to fully ship

| Provider | Status | Needed |
|---|---|---|
| Stripe | OAuth wired | Webhook handler in `webhook.service.js` (currently no-op) — receive `payment_intent.succeeded` etc. and upsert into `payments` with `source='stripe'` |
| Xero | OAuth stub | Real env vars + token refresh impl + `lib/integrations/xero-provider.js` `sync()` → pull invoices into `lab_invoices` + future `expenses` table |
| QuickBooks | OAuth stub | Same as Xero |
| Google Calendar | OAuth stub | Real env vars + token refresh + sync appointments → our `appointments` table |
| Google Ads | OAuth stub | Real env vars + token refresh + sync ad spend → `marketing_spend` (new table) |
| Meta Ads | OAuth stub | Real env vars + token refresh + webhook for Lead Ads → `leads` rows |
| Mailchimp | OAuth stub | env vars |
| Slack | OAuth stub | env vars |
| Zoom | OAuth stub | env vars |
| DocuSign | OAuth stub | env vars |
| Dropbox | OAuth stub | env vars |
| Dentally | Broker stub | See `dentally.md` — apply for partner OAuth, ship validated broker now |
| SOE Exact | Broker stub | Same as Dentally |

### Cross-cutting Phase 3 polish

- `IntegrationsScreen.tsx` per-tile last-sync timestamp + resource counts (X patients, Y payments synced)
- "Force sync now" button per integration
- Disconnect confirmation modal
- Provider logos (currently text-only chips)
- Settings → Integrations grouped tab navigation (currently single scrolling page)
- OAuth state CSRF validation (currently stored, not validated on callback)

---

## 4. Phase 4 — AWS messaging

Facade shipped; per-tenant routing works. Stubs remain:

- `sendViaSES` actual `@aws-sdk/client-sesv2` call (~30 lines)
- `sendViaSNS` actual `@aws-sdk/client-sns` call (~30 lines)
- SES domain verification endpoint: `POST /api/integrations/ses/domain` → `SES.CreateEmailIdentity` → return DNS records → poll `GetEmailIdentity` until `verified`
- SNS pool provisioning + UK sender-ID registration form
- WhatsApp Business via AWS End User Messaging Social
- Bounce / complaint webhook handlers → write to `provider_events.event_type` + auto-add to suppression list
- Tests for `messaging.js` provider routing (SES active → SES, revoked → fallback)

---

## 5. Phase 5 — Platform-admin

Parallel session work. Not owned by this session. See `plans/phase5-platform-admin.md` for status.

Visible from this session: `/api/platform/*` mounted, `platform-auth.middleware.test.mjs` + `platform-admin.service.test.mjs` exist (8+5 tests).

---

## 6. Phase 6 — Intra-org visibility

Schema + repo filter shipped. Pending:

- UI for setting `visibility` per thread (currently SQL-only)
- Inbound webhook routing — parse `To:` header, match `org_email_aliases.local_part`, insert `communications.visibility` accordingly
- "Mark as read" `PATCH /api/comms/:id/read` endpoint (currently no way to flip `read_at`)
- Org admin UI to manage `org_email_aliases` (e.g. `accounts@…` → owner, `reception@…` → reception)
- Tests for visibility filter (owner sees all, reception filtered, manager partial)

---

## 7. Phase 7 — Provider syncs (real data inflow)

| Source | Target table | Current state |
|---|---|---|
| Dentally → payments / contacts / appointments | `payments source='dentally'` etc | Sync worker scheduled (15min cron), fetch calls **stubbed** |
| Stripe → payments | `payments source='stripe'` | Stripe webhook route mounted, **handler is no-op** |
| Xero → lab_invoices + expenses | `lab_invoices` + new table | Not started |
| Meta Lead Ads → leads | `leads source_provider='meta_ads'` | Webhook route not created |
| Google Ads → marketing spend | new table | Not started |
| Companies House → org metadata | new table | Not started |
| Google Calendar ↔ appointments | bidirectional sync | Not started |

---

## 8. Finance section gaps (user-facing)

This session shipped manual entry + source breakdown on **Profit** tab only. Other tabs share the same data but lack the UI affordances:

| Tab | Manual entry button | Source breakdown card | Read-only data path |
|---|---|---|---|
| Profit | ✅ shipped | ✅ shipped | ✅ |
| Cashflow | ❌ **adding this turn** | ❌ **adding this turn** | ✅ |
| Financial | ❌ **adding this turn** | ❌ **adding this turn** | ✅ |
| Valuation | ❌ **adding this turn** | ❌ **adding this turn** | ✅ |

Other finance gaps:
- Lab invoice manual entry — Financial tab reads from `lab_invoices` table; no POST endpoint exists
- Expense manual entry — no `expenses` table; not started
- Edit / delete payment — only create exists
- Bulk import CSV — no path
- Bank-feed integration (Phase 4 area)

---

## 9. CRM data + UI polish

- Inbox: contact name still derived from email address; needs join with `contacts` table for real names
- Inbox: no "mark as read" path
- Inbox: no real-time updates (polling-only, 30s)
- Inbox: reply input field has no submit handler — typing does nothing
- Pipeline: drag-and-drop between columns not implemented (clicks only)
- Pipeline: no "+ New lead" button
- Templates: needs whole new table + UI (see Phase 1 §1)
- Sequences: maps to `workflows` but UI not wired
- Reports: needs new analytics route or extension of existing `/api/analytics/*`

---

## 10. Auth + access polish

- Magic-link impersonation for platform admins (Phase 5 deferred)
- Multi-factor auth for platform admins (Phase 5 deferred)
- Password reset flow for tenants — exists in supabase, no UI integration yet
- Session timeout / forced re-auth on sensitive endpoints
- Audit log search UI (raw `audit_log` table exists, no UI)

---

## 11. Performance + observability

- Recharts not code-split → ~50 kB bundle hit on every dashboard route (per CLAUDE.md)
- No frontend test framework (per CLAUDE.md TODO)
- No Sentry on frontend (backend has it)
- No structured request logs (pino-http there, no dashboard)
- No query performance instrumentation (Supabase exposes some)
- React Query devtools not wired in dev

---

## 12. Migrations to apply on hosted Supabase

Order matters:

```
20260101000005_role_permissions.sql        (pre-session, still pending)
20260101000006_user_status.sql             (pre-session, still pending)
20260101000007_business_health_cadence.sql (this session)
20260101000008_integrations.sql            (this session)
20260101000009_platform_admins.sql         (Phase 5 session)
NOTIFY pgrst, 'reload schema';
```

Without these the new endpoints will 500 in production.

---

## 13. Env vars to set on Railway

```
INTEGRATIONS_SECRET_KEY=<openssl rand -hex 32>

# Stripe Connect (when live)
STRIPE_CONNECT_CLIENT_ID=ca_xxx
STRIPE_SECRET_KEY=sk_live_xxx
APP_URL=https://app.elevate.app

# OAuth providers (only those you turn on)
XERO_CLIENT_ID / XERO_CLIENT_SECRET
QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
META_APP_ID / META_APP_SECRET
MAILCHIMP_CLIENT_ID / MAILCHIMP_CLIENT_SECRET
SLACK_CLIENT_ID / SLACK_CLIENT_SECRET
ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET
DOCUSIGN_CLIENT_ID / DOCUSIGN_CLIENT_SECRET
DROPBOX_CLIENT_ID / DROPBOX_CLIENT_SECRET

# AWS (when migrating off Postmark/Twilio)
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY

# Platform admins (Phase 5)
PLATFORM_ADMIN_JWT_SECRET
PLATFORM_ADMIN_BOOTSTRAP_EMAIL
PLATFORM_ADMIN_BOOTSTRAP_PASSWORD
```

---

## 14. Documentation that lags reality

- `docs/API.md` — needs every new endpoint added this session (`/api/health/cadence`, `/api/integrations/*` full surface, `/api/payments` POST + source-breakdown, `/api/practices`, `/api/growth/*`, `/api/wealth/*`, `/api/training/*`)
- `docs/ARCHITECTURE.md` — needs new `lib/integrations/` directory + IntegrationProvider interface section
- `docs/FORMULAS.md` — needs updating once Dentally sync provides real revenue data + cost-side strategy locked
- `README.md` — connect-app section not yet mentioned
- `CLAUDE.md` — "Current state" section becoming stale; should reference `report.md` + `pending.md`

---

## Effort summary

| Area | Estimate |
|---|---|
| Phase 1 remaining slices | 9.5 days |
| Phase 2 polish + tests | 1 day |
| Phase 3 real OAuth per provider (× active list) | 2-5 days each |
| Phase 4 AWS SDK real calls + verification flow | 5 days |
| Phase 6 UI + inbound routing | 3 days |
| Phase 7 Dentally/Stripe/Xero real syncs | 6 days |
| Finance section polish (lab invoices + tab parity) | 1 day |
| CRM data joins + UX polish | 2 days |
| Tests for new modules | 1.5 days |
| Docs catch-up | 0.5 day |
| **Total remaining to baseline-launch state** | **~32 days** |

---

## What's actually shipping next (next session priority)

1. Apply migrations on hosted Supabase (15 min, unblocks 8 endpoints in prod)
2. Operations PayScreen wiring (0.5 day, smallest blast radius)
3. Validated broker upgrade for Dentally per `dentally.md` (30 min)
4. Frontend tests framework — Vitest + React Testing Library setup (1 day)
5. Stripe webhook handler — payments inflow without manual entry (0.5 day)

Open `pending.md`, pick top of stack, ship, append to `completed-tasks.md`.
