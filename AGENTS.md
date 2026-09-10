# AGENTS.md

Multi-tenant SaaS for UK dental practice groups (agency model: Plan4growth + sub-accounts). **Express backend** (`backend/`, Port 8080) + **Next.js 14 App Router frontend** (`frontend/`, Port 3000). Postgres + RLS on Supabase.

## Read these first — they are authoritative
- **`rules.md`** — the owner's non-negotiable work rules. Read before touching anything; where it disagrees with any other file, it wins. (Multi-tenancy, agency-vs-sub-account, no keys ever, no patient PII, verify-before-asserting, migration discipline.)
- **`CLAUDE.md`** — full architecture, command list, layering rules, and a point-in-time "current state" log (the durable architecture sections win over the log).

House rules (never violate): light theme only (no dark mode), money in **integer pence** (`(pence/100).toLocaleString('en-GB')`), British English in UI, no emojis except specified spots, "Italy Implant Residency" excluded everywhere, every mutation audited to `audit_log`, Reception sees CRM only (Inbox/Pipeline/Contacts).

## Commands
Backend (`cd backend`, native ESM):
- `npm run dev` — watch-mode server on :8080 · `npm start` — prod
- `npm test` — vitest; single file `npx vitest run test/foo.test.mjs`; single test `npx vitest run -t "name"`
- `npm run lint` · `npm run typecheck` (`node --check` on `src/*.js`) · `npm run build` (no-op echo)
- `npm run test:integration` points at `vitest.integration.config.js` which **does not exist** — don't rely on it; `npm test` is the whole suite (~300 test files)

Frontend (`cd frontend`):
- `npm run dev` — :3000 · `npm run build` · `npm run lint` · `npm run typecheck` (`tsc --noEmit`)
- **No frontend test framework** — CI does not gate frontend tests (it runs typecheck/lint/build only)
- CI frontend build needs env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`. The pre-existing local-build `/forgot-password` prerender failure (no Supabase env at build time) is documented, not a regression.

Git: solo dev — push straight to `main` (staging = `develop`). Shared working tree: stage **explicit paths**, never `git add -A`; no rebase/amend/force-push. Keep CI green; update `docs/API.md` for new endpoints.

## Backend traps (all cost real time here)
- **Native ESM**: `import`/`export`, relative imports carry `.js` extensions. No `require`/`module.exports`/`__importDefault`. `backend/dist/` is stale compiled output — ignore it, live source is `backend/src/`.
- **`serviceClient` bypasses RLS.** Repositories use it and MUST chain `.eq('organisation_id', orgId)` on every query — org comes from `req.user.organisation_id` (or `req.agencyOrgId`), **never** from request body/query. Losing the filter is a data breach, not a bug.
- **No PostgREST embeds** (`contact:contacts(...)`) under `serviceClient` — FK join without org predicate → cross-org PII read. No freeform `z.record(z.any())` update schemas (makes `organisation_id` writable). See `lib/tenant-guard.js`.
- Layering: `routes → controllers → services → repositories → models` (Zod schemas), one domain per file; wired in `src/app.js` `buildApp()`.
- **PostgREST silently truncates reads at 1000 rows** (tables and set-returning RPCs): page on a unique key and stop on an empty page, never a short one. Totals are computed in SQL/RPCs, never `.filter().length` over a list endpoint.
- Money/financial calcs: **integer pence**, single source `lib/formulas.js`; changes need a unit test + `docs/FORMULAS.md` update.
- Auth: JWT in httpOnly cookie; server-side proxies `frontend/app/api/backend/[...path]` + `.../platform-backend/[...path]` inject tokens. Two JWT systems stay isolated.

## Frontend notes
- Route groups: `app/(auth)`, `app/(dashboard)` (~60 tenant pages), `app/(platform)` (superadmin console). Feature-first modules in `frontend/features/`; shared UI in `components/ui`. `preview/elevate-dental-os-v2.html` is the visual prototype for ports. `frontend/src/` move is deferred — don't start it.
- React Query server state; Tailwind + CVA; recharts. JWT never in client JS.

## Supabase / migrations
- Run `supabase start` then `supabase db reset` **from the repo root**; migrations live in `supabase/migrations/20260101*_*.sql`, applied in numeric order, idempotent. `db/01_schema.sql`/`02_rls.sql`/`03_seed.sql` are unmanaged copies — keep them in sync with `supabase/migrations/` when changing schema.
- Live hosted project is `mkfhpzjbijbachoonytt`. **Ask before applying anything to hosted**; never run DROP/DELETE/TRUNCATE/unqualified UPDATE without explicit confirmation of that exact statement.
- After any hosted DDL: `NOTIFY pgrst, 'reload schema';` (PostgREST cache goes stale).
- Hosted `schema_migrations.version` values are **apply-time timestamps**, not repo numbers — compare migrations by name. After any deploy adding an RPC, sweep every `.rpc('…')` in `backend/src` against `pg_proc` (code has shipped calling functions never applied).
- New RPC idiom: takes `p_org`, `SECURITY DEFINER`, and `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;`.

## Security / data
- No keys, tokens, or connection strings in any file or commit — ever. Run `ggshield secret scan pre-commit` before every commit and `ggshield secret scan commit-range origin/main..HEAD` before every push. Hooks in `.claude/hooks/` enforce secrets + patient-PII checks — **do not work around them**.
- This DB holds real UK dental patients: never read patient-identifying data (names, emails, phones, DOB, postcodes, clinical notes) into the transcript — aggregate only, and ask the owner before specific-patient queries.
- Before building any feature, settle **agency vs sub-account vs both** first (see `rules.md` rule 3); agency powers are a per-user grant `users.is_agency_admin`, not "owner of an org with `is_agency`".