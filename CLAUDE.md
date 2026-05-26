# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Multi-tenant SaaS for UK dental practice groups. Two apps: a Fastify-style **Express backend** (`backend/`, deploy Railway) and a **Next.js 14 frontend** (`frontend/`, deploy Railway via `frontend/Dockerfile`, service `web`). Postgres + RLS on Supabase. Target launch Fri 30 May 2026.

## Commands

Backend (`cd backend`):
- `npm run dev` — watch-mode server on :8080 (`node --watch src/server.js`)
- `npm start` — prod server
- `npm test` — vitest (all). Single file: `npx vitest run path/to/x.test.js`. Single test: `npx vitest run -t "name"`
- `npm run test:integration` — `vitest.integration.config.js`
- `npm run lint` — eslint `src --ext .js`
- `npm run seed` — `../scripts/seed-tenant.js`. (Note: `npm run migrate` points at `../scripts/migrate.js` which does **not** exist — migrations are managed by Supabase, see below. Don't rely on `npm run migrate`.)

Frontend (`cd frontend`):
- `npm run dev` — :3000 · `npm run build` · `npm run lint` (next lint) · `npm run typecheck` (`tsc --noEmit`)

Local DB: the live Supabase project is rooted at repo-root `supabase/` (`config.toml` + `supabase/migrations/`). Run `supabase start` then `supabase db reset` **from the repo root** — it applies all `supabase/migrations/20260101*_*.sql` in numeric order. The current ledger runs `000001`→`000020`: schema, RLS, seed, `000004_access_token_hook` (creates the Custom Access Token Hook — critical, see rule 8), then RBAC/`role_permissions`, user status, business-health cadence, integrations (GHL/Dentally/Xero/CSV), `platform_admins`, the `auth_bootstrap` + rollup/payment-summary/settled-receipts RPCs, and signup-approval. All are idempotent and re-apply cleanly. The `db/01_schema.sql`/`02_rls.sql`/`03_seed.sql` files are unmanaged source copies, **not** what `supabase db reset` reads; keep them in sync with `supabase/migrations/` when changing schema. After any hosted DDL run `NOTIFY pgrst, 'reload schema';` (PostgREST cache goes stale — recurring gotcha).

Backend `npm run typecheck` is `find src -name '*.js' -exec node --check {} +` (syntax check, no TS); `npm run build` is a no-op echo. `.github/workflows/ci.yml`: backend job runs typecheck/lint/**test**/build; frontend job runs typecheck/lint/build only (**no `npm test` step** — frontend tests are not gated by CI). All scripts exist; CI is green.

## Backend architecture

Strict layering, one domain per file across parallel dirs:

```
routes/ -> controllers/ -> services/ -> repositories/ -> models/
```

- **routes/** — `*.routes.js`, each exports an `express.Router`; wired in `src/app.js`.
- **controllers/** — parse/validate with the domain's Zod schema from `models/`, call the service, shape the HTTP response. No business logic.
- **services/** — business logic, orchestration, formula calls.
- **repositories/** — only Supabase data access ("queries in, rows out"). No logic.
- **models/** — Zod schemas (`*CreateSchema`, `*ListQuerySchema`, etc.), not ORM models.
- `src/app.js` `buildApp()` is the composition root; `src/server.js` is the entry point.

`backend/` is **native ESM** (`package.json` `"type": "module"`; `import`/`export`, relative imports carry `.js` extensions). It was converted from the old compiled-CommonJS output — there is still no `.ts` source or `tsconfig`. Write idiomatic ESM JS; do **not** reintroduce `require`/`module.exports`/`__importDefault`. Convention in converted files: namespace imports keep their original local var (`import * as x_1 from "../y.js"`); named `export const`/`export function`; route files `export default router`.

### Request flow & multi-tenancy (read before touching data access)

`app.js` mounts public routes (`/healthcheck`, `/webhooks`, `/auth`) without auth, then everything under `/api` behind `authenticate` then `audit`.

`middleware/auth.js`:
- Verifies the Supabase JWT via `serviceClient.auth.getUser`.
- Loads the `users` row, sets `req.user = {id, email, organisation_id, role, access_token}`.
- Attaches `req.db = tenantClient(token)` (RLS-respecting client).
- Exports `requireRole(...roles)` route gate — use for RBAC on protected endpoints.

`app.js` also serves a public HTML status page at `/` (Supabase connectivity check on boot). CORS allowlist is hardcoded (`dev.elevate.app`, `staging.elevate.app`, a Railway URL) plus `process.env.FRONTEND_URL`.

`lib/supabase.js` exposes two clients:
- `serviceClient` — **bypasses RLS**. Intended for webhooks/workers only.
- `tenantClient(token)` — RLS-scoped per request (`req.db`).

**Reality vs. intent:** repositories currently use `serviceClient` and enforce tenant isolation by manually chaining `.eq('organisation_id', orgId)` on every query, passing `req.user.organisation_id` down through controller → service → repo. RLS via `req.db` is available but not the path repos take. When adding repo methods, you MUST replicate the explicit `organisation_id` filter — there is no automatic isolation on the service-client path. Mutations are logged by `audit` middleware to `audit_log`.

Stripe webhook needs the raw body: `app.js` mounts `express.raw` on `/webhooks/stripe` **before** the global JSON parser — keep that ordering.

`lib/`: `claude.js` (Anthropic, model `claude-sonnet-4-5-20250929`), `formulas.js`, `supabase.js`, `postmark.js`, `twilio.js`, `messaging.js` (email/SMS dispatch), `crypto.js` + `webhook-token.js` + `oauth-state.js` (integration secret encryption / webhook + OAuth-state signing), `integrations/` (per-provider connectors — Dentally, GHL, Xero, CSV), `permissions.js` (RBAC catalog), `platform-admin-bootstrap.js`, `snapshot-utils.js`. `workers/index.js` runs `node-cron` jobs (e.g. monthly business-health snapshots) using `serviceClient`; run as a separate process.

**Sentry**: `src/instrument.js` (`@sentry/node`) MUST be imported before any other module (`server.js` imports it first); it is a no-op unless `SENTRY_DSN` is set, so it is safe to always load. `sendDefaultPii: true` — keep Sentry data scrubbing on for patient/financial fields. Structured logging via `pino`/`pino-http`. **Stale artifact:** `backend/dist/` is leftover compiled-CommonJS output from before the ESM conversion — ignore it; the live source is `backend/src/`.

### Financial code

All money is **integer pence** — never floats. `lib/formulas.js` is the single source for financial calcs (`calculatePL`, `calculateValuation`, `calculateAssociatePay`, `calculateCashFlow`, `calculateKPIs`, `calculateLTV`, `calculateMarketingROI`, `calculateProgress`, `calculateCAGR`, helpers `pence`/`pct`/`formatPounds`). Any new/changed formula must update `docs/FORMULAS.md` and add a unit test (accountant reviews `FORMULAS.md` before launch).

## Frontend architecture

Next.js 14 App Router. Route groups: `app/(auth)` (login/signup/forgot), `app/(dashboard)` (~60 tenant product pages), `app/(platform)` (superadmin console — orgs, signup queue, change-password). Feature-first modules under `frontend/features/` (contacts, crm, dashboard, finance, growth, health, integrations, intelligence, leads, operations, overview, payments, practices, settings, system, training, wealth, `_mock`); shared UI primitives in `frontend/components/ui` (+ `components/{dashboard,layout,setup}`). `lib/format.ts` holds money/display helpers.

**Server-side cookie auth (do not regress):** JWT lives in an **httpOnly cookie**, never in client JS. Two same-origin proxies, one per auth system: `app/api/backend/[...path]/route.ts` injects the tenant Supabase Bearer token; `app/api/platform-backend/[...path]/route.ts` injects the `platform_token` for the superadmin console. Both forward server-side to the Express backend. `middleware.ts` uses `@supabase/ssr` cookie sessions and gates `/platform` on the platform token; `lib/supabase-browser.ts` / `lib/supabase-server.ts` are the client/SSR Supabase helpers. The two JWT systems stay isolated — the single `/login` page tries tenant `/auth/login`, falls back to platform login on a plain 401.

Current code is root-level (`frontend/{app,components,features,lib}`); a move under `frontend/src/` is documented in `TODOS.md` but **deferred** (blocked on Railway deploy stability) — don't start it unprompted.

React Query for server state, Tailwind + `class-variance-authority` for UI, `recharts` for charts. `preview/elevate-dental-os-v2.html` is the visual reference prototype for porting pages.

## Project rules (from README "Key principles" — do not violate)

1. No dark mode — light/white only.
2. Money in £ pence integers; display `(pence/100).toLocaleString('en-GB')`.
3. Tenant isolation: every business table has `organisation_id`; only webhooks/workers may use `serviceClient` to bypass RLS conceptually.
4. British English in all UI (organisation, colour, optimise, centre).
5. Practice Manager finance access is Owner-toggled; Reception role = CRM only (Inbox, Pipeline, Contacts) — nothing else.
6. "Italy Implant Residency" is not a live offering — exclude everywhere.
7. No emojis in code/UI except explicitly specified spots.
8. Supabase Custom Access Token Hook is critical — without it RLS returns zero rows and the app silently appears broken.
9. Audit every mutation to `audit_log` (user_id, org_id, diff).

## Branch / deploy model

`develop` → staging.elevate.app (auto), `main` → app.elevate.app (auto). Solo developer owns the repo — push straight to `main`; keep CI green and update `docs/API.md` for any new endpoint. Deploy scripts in `scripts/`. Deeper detail in `docs/`: `ARCHITECTURE.md`, `API.md`, `FORMULAS.md`, `DEPLOYMENT.md`, `TESTING.md`, `DAILY_TASKS.md`.

## Current state (working session)

Done and committed on `main` (now in sync with `origin/main` — pushed). Note: this section is a point-in-time work log; the durable architecture lives in the sections above, which are authoritative when they conflict with this log.
- **Frontend UI**: all ~50 dashboard screens ported pixel-faithful from `preview/elevate-dental-os-v2.html`, mock-data only (`features/<section>/`, `features/_mock`), shared `components/ui` primitives. Login two-column port.
- **Dynamic RBAC**: `role_permissions` table (migration `…000005`) + code catalog `backend/src/lib/permissions.js`. Precedence: `catalog-deny < CODE DEFAULT_ROLE_PERMISSIONS < DB role_permissions (admin override) < users.permissions`. Backend never locks an owner out on DB/cache failure (code defaults are the safety net). Admin Team Permissions UI wired to live API. RLS stays the org-isolation hard boundary; perms are app-layer.
- **Auth hardening**: `/auth/login` gated on an active `public.users` row; orphan-safe signup/invite (reclaims dangling `auth.users`); `removeMember` deletes both `public.users` and `auth.users`; `users.status` (`invited`|`active`, migration `…000006`); invite → set password → active flow.
- **Backend → native ESM** (whole `backend/src`, 107 files). Tests: vitest, 47 passing (`npm test` = `vitest run`), incl. cross-org isolation.
- **Perf**: middleware no longer does a blocking backend `/auth/me` per navigation; one shared cached `useMe()` (`frontend/hooks/useMe.ts`) replaces 3 uncached fetches in sidebar/topbar/team screen.
- **Signup approval flow** (migration `…000011`, applied on hosted): `users.status` widened to `invited|active|pending|rejected`. Two owner-creation paths, both via `provisionOrgOwner` in `auth.service.js`: (1) public `POST /auth/signup` → owner `pending`, login hard-blocked (403) until a platform **superadmin** approves; (2) `POST /api/platform/orgs` (superadmin) → owner `active` now + one-time temp password returned once. Platform queue: `GET /api/platform/signups`, `POST .../signups/:id/{approve,reject}` (reject keeps the row as `rejected`). Frontend: `(platform)/platform/signups` + create-owner form on `…/orgs`. Tenant owners still self-serve more owners/reception via `provisionMember`. See memory `signup-approval-flow`.
- **Unified login** (frontend only; the two JWT systems stay isolated): the single `/login` page → Next route `app/auth/login/route.ts` tries tenant `/auth/login` first, falls back to `POST /api/platform/login` on a plain 401, sets the matching cookie (Supabase session vs `platform_token`), and redirects (`/dashboard` vs `/platform/overview`). The standalone `/platform/login` page + `/api/platform-auth/login` route + `platformLogin()` were removed. `middleware.ts`: `/platform` w/o token → `/login`; admin on `/login` → `/platform/overview`. Login route forwards the real client IP (`x-forwarded-for`) so per-IP rate-limiters key per client, not per proxy.
- **Auth security fixes**: RBAC matrix routes (`/api/admin/permissions/*`) now `requireRole('owner')` (was the delegable `permissions.manage` key — a self-escalation / owner-lockout hole; the catalog key is now effectively owner-only). `/auth/login` + `/auth/signup` get a dedicated 5/min/IP limiter; global limiter no longer keys on the spoofable `x-user-id` header. Platform `must_change_password` enforced server-side (403 on every route but `/me` + `/change-password`) with a matching UI: `(platform)/platform/change-password` + `MustChangePasswordGuard`. See memory `rbac-perms-override-ceiling`.
- **Auth hot path**: `authenticate` now resolves the user + role_permissions in ONE DB round trip via the `auth_bootstrap` RPC (migration `…000010`, applied on hosted), falling back to the old 2-query path if the RPC is absent.
- **Tests**: vitest, ~224 `it/test` calls across 25 files in `backend/test` (was 47, then 122). Cover signup→pending, login approval gate, platform create/approve/reject, `auth_bootstrap` fast-path + fallback, the `must_change_password` gate, and cross-org isolation. Test harness has `.rpc` support (`test/setup.js`).
- **Platform superadmin** seeded in `platform_admins` (hosted): `ruhith@plan4growth.com` (`must_change_password=false`). Log in via the main `/login` page.
- **Integrations** (migrations `000013`–`000020`): Dentally (practice mapping + webhook panel + sync overlay), GoHighLevel, Xero, and CSV import landed — per-provider connectors in `backend/src/lib/integrations/`, routes `integrations.routes.js` / `oauth.routes.js` / `csv-import.routes.js`, secrets encrypted (`crypto.js`). Payments dashboard backed by exact summary + rollup RPCs (`000017`–`000020`) scoped to practice + date range. File uploads use S3 (`@aws-sdk/client-s3`, `files.routes.js`).

### Next TODOs
- **Migrations on hosted Supabase**: all through `…000020` are now applied on project `Dental Os` (`mkfhpzjbijbachoonytt`). The original schema (`000001-000003`, `000005-000006`, `000009`) was set up directly without the migration ledger; this session backfilled the gaps via the Supabase MCP — `000004_access_token_hook`, `000007_business_health_cadence`, `000008_integrations` (only the `integrations` table pre-existed), plus `000010_auth_bootstrap_rpc` and `000011_signup_approval`. All idempotent; they re-apply cleanly on the next local `supabase db reset`. Reminder: after any hosted DDL run `NOTIFY pgrst, 'reload schema';` (PostgREST cache goes stale — recurring gotcha).
- **Clear pre-existing orphan auth users**: Supabase → Authentication → Users (rows with no matching `public.users`). Future removes via Team UI won't orphan.
- **Branch model**: solo developer — push straight to `main` (in sync with `origin/main`). Open feature branches: `feat/gohighlevel-integration`, `fix/auth-middleware-405`, `fix/signup-backend-url-500`.
- Backend wiring: ~50 screens still mock — replace `features/*/data.ts`/`mock.ts` with real API per domain (separate slices).
- Frontend has no test framework; recharts not code-split (bundle); `frontend/src/` move still deferred (`TODOS.md`).
- **Enable the Custom Access Token Hook on hosted (rule 8)**: the `public.custom_access_token_hook` function now EXISTS on hosted (000004 applied this session) + is granted to `supabase_auth_admin`, but it still must be turned ON in Supabase → Authentication → Hooks → Custom Access Token (or via the Management API) — that toggle is GoTrue config, not SQL, so the MCP can't set it. Low impact today (repos use `serviceClient` + manual org filters, not the RLS/`req.db` path), but required before anything relies on `tenantClient`/RLS or on `organisation_id`/`role` JWT claims.
