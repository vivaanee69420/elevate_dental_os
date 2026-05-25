# Quickstart for Developer · Zero to Live

**Read this top to bottom before writing any code.**

This is the critical path. Anything not on this path is deferred until v1.1.

---

## Day 0 · Understand what you have

1. Open `01-prototype/elevate-dental-os.html` in any browser. No server. No setup. Just open the file.
2. Click every section in the left sidebar. The UI is feature-complete with sample data. The backend's job is to replace that sample data with real data and persist state across users / browsers.
3. Open `01-prototype/elevate-data-dictionary.html`. This lists every data point in the UI, what source it comes from, and how often it syncs. Treat this as your "what to build" inventory.
4. Read `02-launch-control-handoff/DATA_CONNECTION_PLAYBOOK.md`. This is the implementation-ready spec — what to do for Dentally, Xero, QuickBooks, GHL, reconciliation, manual feed, and security.

---

## Day 1 · Local environment up

```bash
cd 05-backend-starter
cp .env.example .env       # edit later for real credentials
docker-compose up -d       # starts Postgres + Redis + the Express app
npm install
npm run migrate            # loads the schema from 05-backend-starter/migrations/
npm run dev                # http://localhost:4000
```

You should now have:
- Postgres running on port 5432 with the full schema loaded
- Redis running on port 6379 (used for job queue + sessions)
- Express running on port 4000 with `/health` returning `{ ok: true }`
- The prototype at `http://localhost:4000` pointing at the local API

If any of that fails, fix it before doing anything else.

---

## Week 1 · Auth + RBAC + prototype hooked up

Goal: every screen in the prototype reads from the API, not from `localStorage`. Permissions enforced server-side.

1. Implement `POST /auth/login` with email + password + MFA TOTP (`speakeasy`).
2. Issue JWTs signed with `JWT_SECRET`. Set `httpOnly` cookies.
3. Implement `src/auth/middleware.js` to gate every protected route by role.
4. Replace the prototype's `loadCurrentRole()` and `loadPermissions()` with API calls.
5. Wire `team-permissions` page to `GET/PUT /api/permissions`.
6. Seed one owner user (`owner@gmdental.local`) for local dev.

**Acceptance:** owner can log in, switch roles, see Wealth + Launch Control. Non-owner roles get `403` when they try.

---

## Week 2 · Xero connector (highest unlock: ~60% of finance UI)

Follow `04-integrations/XERO_SETUP.md` step by step.

1. Register the app at https://developer.xero.com (Web App, OAuth 2.0).
2. Implement `GET /api/xero/connect` → redirects to Xero OAuth consent.
3. Implement `GET /api/xero/callback` → exchanges code for tokens, stores per-entity tenant ID.
4. Implement nightly jobs in `src/jobs/xero-sync.js`:
   - Pull `ProfitAndLoss` report monthly
   - Pull `BalanceSheet` monthly
   - Pull `Invoices`, `Payments`, `Contacts`, `Accounts` daily
   - Pull bank balances hourly
5. Normalize into the `accounting_*` and `monthly_financials` tables.
6. Update prototype pages `profit`, `cashflow`, `financial`, `valuation`, `finance-pro` to read from `/api/finance/*`.

**Acceptance:** Xero P&L for one entity displays in the Finance section. Numbers match Xero directly. Refresh tokens rotate cleanly.

---

## Week 3 · Dentally connector

Follow `04-integrations/DENTALLY_SETUP.md`.

1. Confirm Dentally account region and access path. Region determines the base URL — UK = `https://api.dentally.co`.
2. Register an integration in Dentally and obtain credentials.
3. Implement `src/connectors/dentally/client.js` with:
   - `User-Agent` header on every request (Dentally rejects without it)
   - Date-filter helper — never pull more than 3 months at a time
   - Pagination wrapper — 100 per page max
4. Implement the webhook receiver at `POST /webhooks/dentally`:
   - Persist raw payload to `raw_events`
   - Enqueue a fetch-by-ID job to grab the full object
   - Upsert into normalized tables
5. Webhooks to enable: `appointment.created/updated/deleted`, `patient.created/updated/deleted`, `payment.created/updated/deleted`.
6. Nightly backfill of last 90 days.
7. Update prototype pages `dashboard`, `patients`, `chair`, `treatments`, `uda`, `practice-iq` to read live data.

**Acceptance:** Today's appointments appear in the UI within 15 minutes of a Dentally change. Webhook log clean. No failed retries.

---

## Week 4 · GoHighLevel connector

Follow `04-integrations/GOHIGHLEVEL_SETUP.md`.

1. Use Private Integration Token (single-location) for v1 — defer the Marketplace OAuth dance to v1.1.
2. Implement `src/connectors/ghl/client.js` with API key auth.
3. Sync contacts, opportunities, conversations, tasks every 15 minutes.
4. Webhook receiver at `POST /webhooks/ghl` for contact/opportunity status changes.
5. Build a `ghl_links` table — store deep-link URLs per sub-account / module so the prototype can deep-link into GHL.
6. Wire the `inbox`, `pipeline`, `callcentre-dashboard`, `crm-today`, `crm-leads` pages.
7. Implement the "Collapse for GHL" sidebar pattern — when deep-linking into GHL, the Elevate sidebar collapses so screen real estate goes to GHL.

**Acceptance:** Lead created in GHL appears in the Elevate inbox within 15 minutes. Clicking a lead deep-links into the GHL conversation. Sidebar collapses when in GHL view.

---

## Week 5 · Reconciliation engine

Follow `03-backend-spec/RECONCILIATION_RULES.md`.

1. Implement reconciliation runners in `src/reconciliation/`:
   - `cash-received.js` — Dentally payments vs accounting receipts · daily · 0.5% tolerance
   - `revenue-by-practice.js` — Dentally invoiced value vs P&L · weekly · 1.0% tolerance
   - `aged-debt.js` — Dentally balances vs AR report · weekly · exact match
   - `treatment-starts.js` — GHL won opps vs Dentally starts · daily · lead-level match
   - `entity-totals.js` — Practice totals vs group close · monthly · 0.5% tolerance
2. Persist runs to `reconciliation_runs` and exceptions to `reconciliation_exceptions`.
3. Use the approved exception categories — anything else needs owner sign-off.
4. Build the approval flow: dual sign-off (uploader + approver), audit-logged.
5. Wire the `launch-reconciliation` page to read from these tables.

**Acceptance:** Daily reconciliation runs at 02:00 local time. Exceptions appear in the queue with the right category. Owner can resolve / route from the UI. Audit event written on every action.

---

## Week 6 · Manual feed + Stripe

1. Implement `POST /api/uploads/csv` with schema validation per template type.
2. Persist uploads to `manual_uploads` + `manual_upload_rows` with `source_type = 'manual'`.
3. Build the approval gate — uploaded files stay in staging until a second user (with the right role) approves.
4. Stripe: follow `04-integrations/STRIPE_SETUP.md` — Connect for multi-practice, OAuth for accounts, webhooks for `payment_intent.succeeded` etc.

**Acceptance:** Philippa can upload `monthly_financials_template.csv` for Ashford. Validation rejects bad rows with line-level errors. Gaurav approves it. Audit event written. Numbers appear in the dashboard tagged as manual.

---

## Week 7 · UAT with one practice

Pick Ashford as the pilot. It has the cleanest data.

1. Connect Ashford's real Xero tenant.
2. Connect Ashford's real Dentally site.
3. Connect Ashford's real GHL sub-account.
4. Run reconciliation for two consecutive weeks.
5. Both weeks must come in within tolerance with zero unresolved exceptions before promoting any other practice.

**Acceptance:** Two clean reconciliations · sign-off from finance · no critical bugs open · monitoring + alerting live.

---

## Week 8 · Group rollout

In order: Rochester → Warwick Lodge → Barnet → FTS Bexleyheath.

Onboard one practice per day. After each, watch reconciliation for 48 hours before adding the next.

---

## What to defer to v1.1 (do NOT build now)

These are tempting but will burn your timeline:

- ❌ Online booking — Dentally handles this
- ❌ Full CRM rebuild — GHL stays the engine, Elevate is the command layer
- ❌ NextGen Dentally OAuth — start on v1 access; migrate when Dentally rolls it out (end of June 2026)
- ❌ Marketplace OAuth for GHL — use Private Integration Token for v1
- ❌ Iframe-embedded GHL — deep-link instead. Iframe-first is fragile, GHL changes their UI often.
- ❌ Associate pay calculations — needs accountant-approved rule set first
- ❌ Mobile app — UI is responsive enough for tablet, phone is post-launch
- ❌ Open Banking — Xero gives bank data via reconciled feed; defer Open Banking until pension / multi-account scenarios need it

---

## Where each integration's docs live

- **Dentally** → `04-integrations/DENTALLY_SETUP.md`
- **Xero** → `04-integrations/XERO_SETUP.md`
- **QuickBooks** → `04-integrations/QUICKBOOKS_SETUP.md` (alternative to Xero per entity)
- **GoHighLevel** → `04-integrations/GOHIGHLEVEL_SETUP.md`
- **Stripe** → `04-integrations/STRIPE_SETUP.md`
- **Open Banking** → `04-integrations/OPEN_BANKING_SETUP.md` (post-v1)

---

## When you get stuck

- API contract questions → `03-backend-spec/API_CONTRACT.md`
- Schema questions → `03-backend-spec/DATABASE_SCHEMA.sql` + `03-backend-spec/DATA_MODEL.md`
- Permission questions → `03-backend-spec/PERMISSIONS_MODEL.md`
- Reconciliation questions → `03-backend-spec/RECONCILIATION_RULES.md`
- Deployment questions → `06-deployment/DEPLOYMENT_RUNBOOK.md`
- Security questions → `06-deployment/SECURITY_BASELINE.md`

---

**Last thing:** the prototype is the source of truth for UX. If the spec disagrees with the prototype, fix the spec, then build to the prototype.
