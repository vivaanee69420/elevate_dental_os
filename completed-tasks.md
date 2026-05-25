# completed-tasks.md

Log of work shipped on Elevate Dental OS. Append-only. Newest at top. Date format: ISO (YYYY-MM-DD). Source of truth for "what's done" — pairs with `TODO_IMPORTANT.md` ("what's next").

---

## 2026-05-20 — Finance inflow: Dentally sync + Stripe-ready + manual entry

User direction: finance data pulls from Dentally + other connected apps, and a manual fallback is always available.

**Backend:**
- New `POST /api/payments` — manual entry, always stamps `source='manual'`. Zod `paymentManualCreateSchema`. Full 5-layer wiring (controller `createManual` + service + `paymentRepository.insertManual`).
- New `GET /api/payments/source-breakdown?days=N` — provenance aggregate per source over window. Drives the trust widget.
- New `GET /api/practices` — minimal list endpoint so UIs can pick a practice. Mounted under `/api/practices`.
- New `lib/integrations/dentally-sync.js` — `syncOneOrg(orgId, integration)` and `syncAllOrgs()`. Reads encrypted Bearer key via `crypto.decryptSecret`. Stubbed Dentally REST GETs against `api.dentally.co/v1/{patients,appointments,payments}`; inline comments describe the real upsert paths (source='dentally', external_id, processed_at).
- Worker cron — Dentally sync runs `*/15 * * * *`; only fires for orgs with active dentally integration row.
- Snapshot worker bug fix — was querying `payments.paid_at` (column does not exist); now uses `processed_at`. Would have caused empty snapshots for any org once data lands.

**Frontend (Finance):**
- `features/finance/api.ts` — typed `getPaymentSourceBreakdown(days)`, `recordManualPayment(input)`.
- `features/finance/hooks.ts` — `usePaymentSourceBreakdown(days)` + `useRecordManualPayment()` (invalidates finance-series / cashflow / financial / source-breakdown on success).
- New `SourceBreakdownCard.tsx` — shows where the money came from (Stripe/Dentally/manual/etc.) over last 30 days. Per-provider colour bars, count + £ + %. Empty state nudges to connect apps.
- New `ManualPaymentModal.tsx` — full form (practice, amount in £ → converts to pence, method, date, description). Submits via `useRecordManualPayment`.
- `ProfitScreen.tsx` — header gets "+ Add payment" + "Export PDF" buttons; SourceBreakdownCard renders above the chart; modal mounts on click; `useEffect` fetches `/api/practices` for the picker.

**Tests:** backend vitest 105/105 ✓; frontend typecheck/lint/build ✓.

**Files this turn:** 4 backend new (dentally-sync.js, practices.routes.js, +manual payment plumbing across model/repo/service/controller/routes, app.js mount), 4 frontend new (SourceBreakdownCard, ManualPaymentModal, finance api+hooks additions, ProfitScreen wiring). 1 worker bug fix. Report updated with §11b finance section.

## 2026-05-20 — Phases 2/3/4/6/7 scaffolded + Phase 1 continued

**Phase 2 (Business Health calc + cadence):**
- Migration `20260101000007_business_health_cadence.sql` — `business_health.snapshot_frequency` + `last_snapshot_at`; `source`/`source_provider` cols on payments/leads/appointments/contacts.
- Snapshot worker rewritten — runs daily 02:00 UTC, per-org cadence via `isDueForSnapshot`, queries real payments/leads/appointments, runs `lib/formulas.js`, writes derived `metrics.pl/ltv/marketingROI/source_breakdown/counts` to `business_health_snapshots`.
- New helpers `backend/src/lib/snapshot-utils.js` (getISOWeek, countBySource, isDueForSnapshot, windowStart, snapshotLabel).
- New endpoint `PATCH /api/health/cadence` (owner only). Zod `cadenceUpdateSchema`. 5-layer wiring (controller/service/repo/model).
- Frontend `useUpdateCadence`, `useSnapshots` hooks. `<CadenceCard>` on Progress screen with Weekly/Monthly toggle.

**Phase 3 (Connect-App OAuth foundation):**
- Migration `20260101000008_integrations.sql` — `integrations` table (encrypted secrets BYTEA), `provider_events` audit, `communications.visibility`/`assigned_user_id` cols, `org_email_aliases` routing table.
- `backend/src/lib/crypto.js` — AES-256-GCM encrypt/decrypt for secrets at rest.
- `backend/src/lib/integrations/provider-interface.js` — single `IntegrationProvider` contract every connector implements.
- Stripe Connect: real OAuth + token exchange (`lib/integrations/stripe-provider.js`).
- Brokers: Dentally + SOE (key-paste, encrypted, never re-displayed).
- 9 OAuth stubs: Xero, QuickBooks, Google Calendar, Google Ads, Meta Ads, Mailchimp, Slack, Zoom, DocuSign, Dropbox. Real URL builders + token POST; gated on env vars.
- Repo expanded: `upsertSecrets`, `markFailed`, `markRevoked`, `getByProvider`. Never returns secrets via API.
- Service expanded: `startConnect`, `finishConnect`, `revoke`, `refresh`. Backwards-compat `connect()` shim.
- Controller adds `callback`, `refresh`, `revoke`. Routes: full `/api/integrations/*` surface (owner only).
- Frontend `features/integrations/{api,hooks}.ts`. `IntegrationsScreen` rewritten — Connect/Disconnect with broker-key modal; encrypted-at-rest disclaimer.

**Phase 4 (Per-tenant AWS messaging):**
- `backend/src/lib/messaging.js` facade. `sendEmail({ orgId, ... })` / `sendSMS({ orgId, ... })` route per-tenant: SES → fallback Postmark, SNS → fallback Twilio.
- Every send logs to `provider_events` (provider + external_id + event_type).
- `comm.service.send` migrated to facade. Both worker callers (weekly digest + workflow runner) migrated.
- SES/SNS actual AWS SDK calls stubbed (write provider_events with synthetic id); ~30 lines from real.

**Phase 6 (Intra-org email visibility):**
- `communications.visibility` enum cols + `assigned_user_id`. `org_email_aliases` table for inbound routing.
- `comm.repository.list(orgId, q, viewer)` — owner sees all; reception/manager filtered by visibility + assigned_user_id.
- Controller threads `viewer={id, role}` through.

**Phase 7 (Missing backend routes):**
- `routes/growth.routes.js` — /patients /marketing /loyalty /booking /benchmark (org-scoped aggregators).
- `routes/wealth.routes.js` (owner only) — /net /fire /pension /property.
- `routes/training.routes.js` — /library /my /mentorship /one-to-one.
- All mounted in `app.js`.

**Tests:**
- Backend vitest: 105/105 passing (11 test files). No new tests added for new modules; flagged in report.md §9 for next session.
- Frontend `typecheck` clean. `lint` clean. `build` 51 routes succeed.

**Documentation:**
- `report.md` written at repo root — full data-flow map, phase-by-phase status, file manifest, env var checklist, outstanding work, recommended next 5 actions.

**Files this turn:** 11 backend new, 14 backend modified, 4 frontend new, 8 frontend modified, 2 migrations, 1 report.

## 2026-05-20 — Phase 1, Step 2: CRM Pipeline wired + Step 1 path bug fixed

- **Bugfix from Step 1:** `features/crm/api.ts` called `/comms` instead of `/api/comms`. Same-origin proxy strips `/api/backend/` and forwards `<path>` verbatim — backend mounts API at `/api/*`, so frontend paths must include `/api/` prefix (verified against `features/contacts/api.ts` convention). Both `fetchCommunications` and `sendCommunication` corrected.
- Replaced `features/leads/api.ts` shim with typed contracts: `Lead`, `LeadStatus`, `LeadsListResponse`, `LeadsListFilters`, plus `updateLead()` for status mutations.
- Replaced `features/leads/hooks.ts` shim with typed `useLeads(filters)` (staleTime 30s) and `useUpdateLead()` mutation (invalidates list). Backwards-compatible — existing `LeadsScreen` and `DashboardScreen` call `useLeads()` with no args.
- Rewrote `features/crm/components/PipelineScreen.tsx`:
  - Dropped `LEADS`, `TASK_NOW` mock imports.
  - Wires to `useLeads()`, groups by `status` into 6 kanban columns matching prototype stages.
  - Money via `lib/format.formatPence` (integer pence end-to-end).
  - Contact name from joined `lead.contact.first_name + last_name`, falls back to `Lead <id-prefix>`.
  - Loading + error states added; UI styling unchanged.
- Tests:
  - Frontend typecheck: clean.
  - Frontend lint: ✔ no warnings.
  - Backend vitest: 11 files, 105 tests passing (13 new from parallel Phase 5 session).
- Files changed: 2 rewritten (`leads/api.ts`, `leads/hooks.ts`), 1 rewritten (`PipelineScreen.tsx`), 1 patched (`crm/api.ts` path prefix).
- Observed: parallel Phase 5 session has progressed — `backend/src/app.js:145` now mounts `platformAdminRouter` at `/api/platform`. No conflict with this session's work.

## 2026-05-20 — Phase 1, Step 1: CRM Inbox wired to /api/comms

- Wrote `plans/phase1-backend-wiring.md` (full Phase 1 scope: 14 steps across 7 mock slices + 2 partial-wire screens; per-step pattern; cross-cutting rules; exit criteria).
- Wrote `plans/phase5-platform-admin.md` (self-contained Phase 5 plan for parallel Claude session; reserved migration `…000009`; strict guard rails; 21-step execution order).
- New file `frontend/features/crm/api.ts` — typed wrappers `fetchCommunications` + `sendCommunication` over `lib/api.ts`.
- New file `frontend/features/crm/hooks.ts` — React Query `useCommunications` (staleTime 30s) + `useSendCommunication` (invalidates list).
- Rewrote `frontend/features/crm/components/InboxScreen.tsx`:
  - Dropped `INBOX_THREADS` / `THREAD_MESSAGES` mock imports.
  - Added `groupIntoThreads()` reducer keyed by `contact_id → lead_id → channel+address`.
  - Renders against real `communications` rows; `read_at`-based unread counter; subject preserved on email threads.
  - Loading + error + empty states added; UI styling pixel-identical.
- Tests:
  - Frontend `npm run typecheck`: clean.
  - Frontend `npm run lint`: ✔ No ESLint warnings or errors.
  - Frontend `npm run build`: succeeds, 51 routes prerendered.
  - Backend `npm test`: 9 test files, 92 tests passing (up from 47 baseline noted in CLAUDE.md).
- No regressions. Backend untouched this step; only frontend additive.
- Files changed: 2 new (`api.ts`, `hooks.ts`), 1 rewritten (`InboxScreen.tsx`). `data.ts` left intact — other CRM screens still import its non-Inbox exports.

## 2026-05-20 — Backend wiring audit + Connect-App direction locked

- Audited 16 frontend feature slices vs 21 backend route files.
- Verified 8 slices fully wired to real API (contacts, leads, payments, settings, system, finance, dashboard, overview-mostly).
- Identified 7 slices still on mock data (crm, growth, intelligence, operations, wealth, training, plus leftover screens).
- Identified 3 missing backend route files (`growth.routes.js`, `wealth.routes.js`, `training.routes.js`).
- Confirmed `business_health` snapshot worker is a stub — copies baseline as-is, no formulas run yet (`backend/src/workers/index.js:31`).
- **Decision locked:** OAuth/Connect-App is the only integration UX. No user-facing API-key input fields. Dentally + SOE fall back to platform-broker model (one-time encrypted paste, never re-displayed).
- Wrote `TODO_IMPORTANT.md` covering: backend wiring (§0), platform-admin layer (§1), per-tenant AWS messaging (§2), intra-org email visibility (§3), Connect-App OAuth integrations (§4).

## 2026-05-20 — Documentation: TODO_IMPORTANT.md created

- New strategic backlog file at repo root.
- Captured 4 major workstreams with effort estimates, schema sketches, phasing, and cross-cutting rules.
- Includes multi-tenancy status snapshot showing what already works (org isolation, RLS, RBAC, auth hardening).

---

# Pre-2026-05-20 — Snapshot of work done before this session began

(Aggregated from `CLAUDE.md` "Current state" section + recent commit history. Best-effort dates from git log where available.)

## Frontend

- Ported ~50 dashboard screens pixel-faithful from `preview/elevate-dental-os-v2.html`. Mock-data only via `features/<section>/` + `features/_mock`.
- Shared UI primitives under `components/ui` (+ `components/{dashboard,layout,setup}`).
- Login two-column port complete.
- App Router route groups in place: `app/(auth)`, `app/(dashboard)`, `app/api/backend/[...path]/route.ts` (Bearer-injecting proxy).
- React Query + Tailwind + `class-variance-authority` + `recharts` set up.
- Server-side cookie auth working: httpOnly JWT, no token in client JS, `middleware.ts` uses `@supabase/ssr`, `lib/supabase-browser.ts` + `lib/supabase-server.ts` helpers.

## Backend

- Converted entire `backend/src` tree (107 files) from compiled-CommonJS output to native ESM. `"type": "module"`, `import`/`export`, `.js` extensions on relative imports.
- Strict 5-layer architecture enforced: `routes/ → controllers/ → services/ → repositories/ → models/`.
- `src/app.js` `buildApp()` composition root + `src/server.js` entry.
- Public routes (`/healthcheck`, `/webhooks`, `/auth`) mounted before `authenticate` + `audit`.
- Stripe webhook `express.raw` mounted before global JSON parser (raw body preservation).
- CORS allowlist hardcoded for `dev.elevate.app`, `staging.elevate.app`, Railway URL, plus `FRONTEND_URL` env.
- Vitest suite green: 47 tests passing, including cross-org isolation coverage.
- ESLint configured, CI green via `.github/workflows/ci.yml` (backend: typecheck/lint/test/build; frontend: typecheck/lint/build).

## Database & multi-tenancy

- Supabase migrations created at `supabase/migrations/2026010100000{1..6}_*.sql`:
  - `…000001_schema.sql` — full schema, every business table has `organisation_id NOT NULL FK ON DELETE CASCADE`.
  - `…000002_rls.sql` — RLS policies on every business table.
  - `…000003_seed.sql` — demo org + users seed.
  - `…000004_access_token_hook.sql` — Supabase Custom Access Token Hook injecting `organisation_id` into JWT (rule 8 — RLS returns zero rows without this).
  - `…000005_role_permissions.sql` — dynamic per-org RBAC table.
  - `…000006_user_status.sql` — `users.status` enum (`invited` / `active`).
- Cross-org isolation verified via vitest integration tests.
- Repos use `serviceClient` + manual `.eq('organisation_id', orgId)` filter on every query (belt + braces with RLS).

## RBAC & auth

- Dynamic role/permission system:
  - `role_permissions` table for per-org admin overrides.
  - `backend/src/lib/permissions.js` — code catalog + `DEFAULT_ROLE_PERMISSIONS`.
  - Precedence chain: `catalog-deny < CODE DEFAULT < DB role_permissions < users.permissions`.
  - Owner-lockout safety: code defaults are the floor, DB/cache failure cannot strip owner access.
  - Admin Team Permissions UI wired to live API.
- Auth hardening:
  - `/auth/login` gated on active `public.users` row.
  - Orphan-safe signup/invite — reclaims dangling `auth.users` rows.
  - `removeMember` deletes both `public.users` and `auth.users` atomically.
  - `users.status` (`invited` → `active`) — full invite + set-password flow.
- RLS continues to be the hard org-isolation boundary; permissions are app-layer only.

## Communications (current state — pre-AWS rewrite)

- `backend/src/lib/postmark.js` — single `ServerClient` from `POSTMARK_SERVER_TOKEN`, `sendEmail()` defaults `From` to platform domain.
- `backend/src/lib/twilio.js` — single client from `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`, `sendSMS()` from `TWILIO_FROM_NUMBER`.
- Callers wired: `services/comm.service.js` user-triggered send, `workers/index.js` weekly digest cron, `workers/index.js` workflow runner cron.
- Inbound webhook routes mounted (`/webhooks/postmark/inbound`, `/webhooks/twilio/inbound`) but service methods are TODO stubs.

## Workers

- `backend/src/workers/index.js` running `node-cron`:
  - Monthly business-health snapshot — 1st of month 02:00 UTC. **MVP stub** — copies `business_health.baseline` straight into `business_health_snapshots.metrics`, no formula calc yet.
  - Weekly digest email — Mondays 06:00 UTC, owners per org.
  - Workflow runner — every minute, processes pending `workflow_runs` steps.

## Performance

- Middleware no longer makes a blocking backend `/auth/me` call per navigation.
- Shared cached `useMe()` (`frontend/hooks/useMe.ts`) replaces 3 uncached fetches in sidebar/topbar/team screen.

## Tooling & deploy

- `scripts/deploy-prod.sh`, `scripts/deploy-staging.sh`, `scripts/seed-tenant.js`, `scripts/setup-aws.sh` in place.
- Railway deploy targets: backend service + `web` (frontend via `frontend/Dockerfile`).
- Branch model: `develop` → staging (auto), `main` → app.elevate.app (auto + manual approval gate).
- Docs in `docs/`: ARCHITECTURE.md, API.md, FORMULAS.md, DEPLOYMENT.md, TESTING.md, DAILY_TASKS.md.

## Recent commits (verified from git log on `main`)

- `b25cc60` — fix(financial): wrap useSearchParams in Suspense to unblock prod build
- `bd3227a` — admin can create users and assign permissions
- `5bbf929` — feat(ui): real organisation name in topbar + restore .table styles
- `03e061e` — feat: integrate real backend analytics endpoints and remove client-side mock data generation
- `2e89686` — perf(frontend): drop per-nav backend /auth/me; shared cached useMe + docs

## Outstanding (not yet shipped — tracked in TODO_IMPORTANT.md)

- Run hosted-Supabase migrations `…000005` + `…000006` via SQL Editor, then `NOTIFY pgrst, 'reload schema';`
- Clear pre-existing orphan `auth.users` rows.
- Push local `main` (8 commits ahead of remote at session start).
- Per-tenant AWS SES + SNS messaging (currently Postmark + Twilio platform-shared).
- Connect-App OAuth integrations (Stripe, Xero, Dentally, etc.).
- Platform-admin (super-admin) monitoring layer.
- Intra-org email visibility rules.
- Backend wiring of 7 mock-only feature slices.
- Real snapshot worker (replace stub baseline-copy with formula-driven calc).

## 2026-05-20 — Phase 5: Platform-admin layer shipped

- Migration `supabase/migrations/20260101000009_platform_admins.sql` created (local; hosted apply still pending — run via SQL Editor + `NOTIFY pgrst, 'reload schema';`).
- New tables: `platform_admins`, `platform_audit_log`. RLS disabled by design; access gated entirely by `middleware/platform-auth.js`.
- Backend stack (native ESM, 5-layer):
  - `models/platform-admin.model.js` — Zod schemas
  - `repositories/platform-admin.repository.js` — serviceClient-only, cross-tenant aggregations
  - `services/platform-admin.service.js` — audit-logged business logic, fail-closed
  - `controllers/platform-admin.controller.js`
  - `middleware/platform-auth.js` — verifies platform JWT (separate `PLATFORM_ADMIN_JWT_SECRET`), `requirePlatformRole(...)`
  - `routes/platform-admin.routes.js` — mounted at `/api/platform` (login rate-limited 5/min/IP)
  - `lib/platform-admin-bootstrap.js` — on first boot, creates initial superadmin from env with `must_change_password=true`
- One-line addition to `backend/src/app.js`: `app.use('/api/platform', platformAdminRouter);` mounted BEFORE tenant `/api` so tenant `authenticate` middleware never runs on platform routes (hard auth isolation).
- Frontend:
  - `app/api/platform-auth/login` + `app/api/platform-auth/logout` — set/clear `platform_token` httpOnly cookie
  - `app/api/platform-backend/[...path]` — same-origin proxy, reads cookie, forwards as Bearer
  - `lib/platform-api.ts` — `platformApi`, `platformLogin`, `platformLogout`
  - `middleware.ts` — additive `/platform/*` matcher gating on `platform_token` cookie (tenant logic untouched)
  - `app/(platform)/` route group → literal `platform/*` URLs with own dark sidebar + red PLATFORM banner
  - Pages: login, overview (metrics), orgs list+detail, users (global search), audit log, integrations health
- Auth isolation verified by middleware tests: tenant JWT rejected on `/api/platform/*` (wrong issuer + `typ`), platform JWT rejected on tenant `/api/*` (signed with different key).
- Every `/api/platform/*` request writes a `platform_audit_log` row with `platform_admin_id, action, ip_address, user_agent, payload`. If the insert fails the whole request fails 500.
- **Plan-patched risks** (eng review prior to implementation):
  - Path renamed `/api/admin/*` → `/api/platform/*` (avoided collision with tenant `/api/admin/permissions`).
  - Audit changed from best-effort to fail-closed.
  - "Impersonation" reduced to admin-scoped read endpoints only — never crosses into tenant `/api/*` with a Supabase token. Real impersonation deferred to Phase 6 (TODO).
  - Bootstrap admin flagged `must_change_password=true`; force-change UI deferred (TODO).
  - Login endpoint hard rate-limit added (`express-rate-limit`, 5/min/IP).
- Verification:
  - Backend vitest: **105/105 passing** (8 new platform-auth middleware tests + 5 new service tests).
  - Frontend `npm run typecheck` ✓, `npm run lint` ✓ (no warnings), `npm run build` ✓ (all 11 platform routes generated).
- Docs: `docs/API.md` extended with the `/api/platform/*` surface; this entry appended to `completed-tasks.md`.

### Required deployment steps (NOT yet performed)
1. Apply `supabase/migrations/20260101000009_platform_admins.sql` on hosted Supabase (SQL Editor), then `NOTIFY pgrst, 'reload schema';`.
2. Add Railway env: `PLATFORM_ADMIN_JWT_SECRET` (≥32 random hex chars), `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`, `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD`.
3. On first restart, bootstrap creates the first superadmin; sign in at `/platform/login` and rotate the password.
4. Carry-over TODOs are tracked in `TODO_IMPORTANT.md` (audit retention/GDPR, MFA, real password-reset, subdomain split, real impersonation).
