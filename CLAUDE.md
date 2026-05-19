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

Local DB: the live Supabase project is rooted at repo-root `supabase/` (`config.toml` + `supabase/migrations/`). Run `supabase start` then `supabase db reset` **from the repo root** — it applies `supabase/migrations/2026010100000{1..4}_*.sql` in order: schema, RLS, seed, then `..._access_token_hook.sql` (creates the Custom Access Token Hook — critical, see rule 8). The `db/01_schema.sql`/`02_rls.sql`/`03_seed.sql` files are unmanaged source copies, **not** what `supabase db reset` reads; keep them in sync with `supabase/migrations/` when changing schema.

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

`lib/`: `claude.js` (Anthropic, model `claude-sonnet-4-5-20250929`), `formulas.js`, `postmark.js`, `twilio.js`, `supabase.js`. `workers/index.js` runs `node-cron` jobs (e.g. monthly business-health snapshots) using `serviceClient`; run as a separate process.

### Financial code

All money is **integer pence** — never floats. `lib/formulas.js` is the single source for financial calcs (`calculatePL`, `calculateValuation`, `calculateAssociatePay`, `calculateCashFlow`, `calculateKPIs`, `calculateLTV`, `calculateMarketingROI`, `calculateProgress`, `calculateCAGR`, helpers `pence`/`pct`/`formatPounds`). Any new/changed formula must update `docs/FORMULAS.md` and add a unit test (accountant reviews `FORMULAS.md` before launch).

## Frontend architecture

Next.js 14 App Router. Route groups: `app/(auth)` (login/signup/forgot), `app/(dashboard)` (the ~39 product pages). Feature-first modules under `frontend/features/` (contacts, dashboard, health, leads, payments, settings); shared UI primitives in `frontend/components/ui` (+ `components/{dashboard,layout,setup}`). `lib/format.ts` holds money/display helpers.

**Server-side cookie auth (do not regress):** JWT lives in an **httpOnly cookie**, never in client JS. `lib/api.ts` calls a same-origin proxy `app/api/backend/[...path]/route.ts`, which injects the Bearer token server-side before forwarding to the Express backend. `middleware.ts` uses `@supabase/ssr` cookie sessions; `lib/supabase-browser.ts` / `lib/supabase-server.ts` are the client/SSR Supabase helpers.

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

`develop` → staging.elevate.app (auto), `main` → app.elevate.app (auto, manual approval gate). Merge to `main` requires green CI + Maryam approval; new endpoint → update `docs/API.md`. Deploy scripts in `scripts/`. Deeper detail in `docs/`: `ARCHITECTURE.md`, `API.md`, `FORMULAS.md`, `DEPLOYMENT.md`, `TESTING.md`, `DAILY_TASKS.md`.

## Current state (working session)

Done and committed (local `main`, **not pushed** beyond `320deb8`):
- **Frontend UI**: all ~50 dashboard screens ported pixel-faithful from `preview/elevate-dental-os-v2.html`, mock-data only (`features/<section>/`, `features/_mock`), shared `components/ui` primitives. Login two-column port.
- **Dynamic RBAC**: `role_permissions` table (migration `…000005`) + code catalog `backend/src/lib/permissions.js`. Precedence: `catalog-deny < CODE DEFAULT_ROLE_PERMISSIONS < DB role_permissions (admin override) < users.permissions`. Backend never locks an owner out on DB/cache failure (code defaults are the safety net). Admin Team Permissions UI wired to live API. RLS stays the org-isolation hard boundary; perms are app-layer.
- **Auth hardening**: `/auth/login` gated on an active `public.users` row; orphan-safe signup/invite (reclaims dangling `auth.users`); `removeMember` deletes both `public.users` and `auth.users`; `users.status` (`invited`|`active`, migration `…000006`); invite → set password → active flow.
- **Backend → native ESM** (whole `backend/src`, 107 files). Tests: vitest, 47 passing (`npm test` = `vitest run`), incl. cross-org isolation.
- **Perf**: middleware no longer does a blocking backend `/auth/me` per navigation; one shared cached `useMe()` (`frontend/hooks/useMe.ts`) replaces 3 uncached fetches in sidebar/topbar/team screen.

### Next TODOs
- **Run two migrations on hosted Supabase** (SQL Editor), idempotent: `20260101000005_role_permissions.sql`, `20260101000006_user_status.sql`; then `NOTIFY pgrst, 'reload schema';` (PostgREST cache goes stale after DDL — recurring gotcha). App now works without them (code defaults) but they're needed for per-org admin permission *customisation* + `users.status`.
- **Clear pre-existing orphan auth users**: Supabase → Authentication → Users (rows with no matching `public.users`). Future removes via Team UI won't orphan.
- **Push** local `main` (8 commits ahead) — direct push bypasses the CI/Maryam `main` gate; consider a branch+PR per the branch model.
- Backend wiring: ~50 screens still mock — replace `features/*/data.ts`/`mock.ts` with real API per domain (separate slices).
- Frontend has no test framework; recharts not code-split (bundle); `frontend/src/` move still deferred (`TODOS.md`).
- Re-enable/verify Supabase Custom Access Token Hook on the hosted project (rule 8) — local migration `…000004` only covers local dev.
