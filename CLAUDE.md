# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Multi-tenant SaaS for UK dental practice groups. Two apps: a Fastify-style **Express backend** (`backend/`, deploy Railway) and a **Next.js 14 frontend** (`frontend/`, deploy Vercel). Postgres + RLS on Supabase. Target launch Fri 30 May 2026.

## Commands

Backend (`cd backend`):
- `npm run dev` — watch-mode server on :8080 (`node --watch src/server.js`)
- `npm start` — prod server
- `npm test` — vitest (all). Single file: `npx vitest run path/to/x.test.js`. Single test: `npx vitest run -t "name"`
- `npm run test:integration` — `vitest.integration.config.js`
- `npm run lint` — eslint `src --ext .js`
- `npm run migrate` / `npm run seed` — `../scripts/migrate.js`, `../scripts/seed-tenant.js`

Frontend (`cd frontend`):
- `npm run dev` — :3000 · `npm run build` · `npm run lint` (next lint) · `npm run typecheck` (`tsc --noEmit`)

Local DB: `supabase start` then `cd db && supabase db reset` (runs `01_schema.sql`, `02_rls.sql`, `03_seed.sql` in order).

> CI mismatch: `.github/workflows/ci.yml` runs `npm run typecheck` and `npm run build` for **backend**, but `backend/package.json` defines neither. Backend CI fails until those scripts exist or the workflow is fixed. Frontend CI matches.

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

The committed `backend/src/**/*.js` are **compiled CommonJS output** (`"use strict"`, `__importDefault`, `exports.x`). There is no `.ts` source or `tsconfig` in the repo despite README/comments saying TypeScript. Edit the `.js` files directly; keep the existing CommonJS/`exports.` style.

### Request flow & multi-tenancy (read before touching data access)

`app.js` mounts public routes (`/healthcheck`, `/webhooks`, `/auth`) without auth, then everything under `/api` behind `authenticate` then `audit`.

`middleware/auth.js`:
- Verifies the Supabase JWT via `serviceClient.auth.getUser`.
- Loads the `users` row, sets `req.user = {id, email, organisation_id, role, access_token}`.
- Attaches `req.db = tenantClient(token)` (RLS-respecting client).

`lib/supabase.js` exposes two clients:
- `serviceClient` — **bypasses RLS**. Intended for webhooks/workers only.
- `tenantClient(token)` — RLS-scoped per request (`req.db`).

**Reality vs. intent:** repositories currently use `serviceClient` and enforce tenant isolation by manually chaining `.eq('organisation_id', orgId)` on every query, passing `req.user.organisation_id` down through controller → service → repo. RLS via `req.db` is available but not the path repos take. When adding repo methods, you MUST replicate the explicit `organisation_id` filter — there is no automatic isolation on the service-client path. Mutations are logged by `audit` middleware to `audit_log`.

Stripe webhook needs the raw body: `app.js` mounts `express.raw` on `/webhooks/stripe` **before** the global JSON parser — keep that ordering.

`lib/`: `claude.js` (Anthropic, model `claude-sonnet-4-5-20250929`), `formulas.js`, `postmark.js`, `twilio.js`, `supabase.js`. `workers/index.js` runs `node-cron` jobs (e.g. monthly business-health snapshots) using `serviceClient`; run as a separate process.

### Financial code

All money is **integer pence** — never floats. `lib/formulas.js` is the single source for financial calcs (`calculatePL`, `calculateValuation`, `calculateAssociatePay`, `calculateCashFlow`, `calculateKPIs`, `calculateLTV`, `calculateMarketingROI`, `calculateProgress`, helpers `pence`/`pct`/`formatPounds`). Any new/changed formula must update `docs/FORMULAS.md` and add a unit test (accountant reviews `FORMULAS.md` before launch).

## Frontend architecture

Next.js 14 App Router. Route groups: `app/(auth)` (login/signup/forgot), `app/(dashboard)` (the ~39 product pages). `middleware.ts` gates auth. `lib/api.ts` is the backend client; `lib/supabase-browser.ts` / `lib/supabase-server.ts` are the SSR/client Supabase helpers. React Query for server state, Tailwind + `class-variance-authority` for UI, `recharts` for charts. `preview/elevate-dental-os-v2.html` is the visual reference prototype for porting pages.

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

`develop` → staging.elevate.app (auto), `main` → app.elevate.app (auto, manual approval gate). Merge to `main` requires green CI + Maryam approval; new endpoint → update `docs/API.md`. Deploy scripts in `scripts/`. Read `docs/ARCHITECTURE.md` and `docs/API.md` for deeper detail.
