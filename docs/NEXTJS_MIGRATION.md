# Next.js 14 → 16 Migration Plan

Status: **PLANNED, not started.** Do this as its own branch with a full QA pass
(`/qa` + build + manual smoke) before the 30 May 2026 launch. Do NOT bundle it
into an unrelated change.

Owner action doc — written 2026-06-17 during the CSO security pass. Pinning the
exact breaking changes that apply to *this* codebase so the upgrade is mechanical,
not archaeology.

---

## Why we're doing this

`next@14.2.x` is on its last legs for security backports. `npm audit` flags a stack
of advisories whose fix version is only `16.3.0+` (Vercel stopped backporting to 14).
Current pin after the security pass: **`next@14.2.35`** (latest 14.2.x — strictly
better than the 14.2.5 we were on, picks up everything still backported).

The residual advisories and whether they actually touch us:

| Advisory | Class | Applies to us? |
|---|---|---|
| Image Optimizer DoS / unbounded disk cache (`remotePatterns`) | DoS | **No** — we use zero `next/image` (verified) |
| RSC / Server Components DoS | DoS | Deprioritised (DoS) |
| HTTP request smuggling in **rewrites** | Real | **No** — no `rewrites` in `next.config.js` (verified) |
| Cache poisoning (middleware redirects / RSC cache-bust) | Real | Low — no fetch caching, no rewrites |
| CSP-nonce XSS (App Router) | Real | **No** — our CSP is report-only, no nonces |
| `beforeInteractive` script XSS | Real | **No** — not used |
| WebSocket-upgrade SSRF | Real | **No** — App Router app, no WS upgrade handlers |

Net: **current real-world exposure is near zero**, which is why this is scheduled,
not an emergency. The upgrade is the clean long-term fix and keeps `npm audit` green.

---

## Current state (as scanned 2026-06-17)

- `next@14.2.35`, `react@18.3.1`, `react-dom@18.3.x`
- Node 22 (both Dockerfiles `FROM node:22-alpine`)
- **App Router only** (`app/`), `output: 'standalone'`, deployed on Railway via
  `frontend/Dockerfile`
- `experimental.instrumentationHook: true` in `next.config.js`
- 4 Route Handlers (`app/api/**/route.ts`) — incl. the two backend proxies
- 1 file uses `next/headers` (`lib/supabase-server.ts` → `cookies()`)
- `middleware.ts` using `@supabase/ssr` (`createServerClient`) + the `/platform`
  cookie gate
- 4 `useSearchParams` call sites, 2 pages reading `params`/`searchParams`
- 6 routes with `export const dynamic = 'force-dynamic'`
- 1 `next/font` usage
- **Not used (so their breaking changes are N/A):** `next/image`, `rewrites`,
  `redirects`, server actions (`'use server'`), `next.config` `eslint`/`amp`
  options, explicit `fetch` caching / `revalidate` / `unstable_cache`

---

## Breaking changes that AFFECT this app

### 1. `middleware.ts` → `proxy.ts` (v16) — REQUIRED

v16 renames the file and the export. The Node runtime is used (`proxy` does not
support the `edge` runtime — fine for us, we don't pin edge).

- `mv frontend/middleware.ts frontend/proxy.ts`
- Rename `export async function middleware(req)` → `export async function proxy(req)`
- The `export const config = { matcher: [...] }` stays the same.
- If any `skipMiddlewareUrlNormalize` flag existed it becomes `skipProxyUrlNormalize`
  (we don't use it).
- Our middleware uses `@supabase/ssr` `createServerClient` + `req.cookies` /
  `res.cookies` — that API is unchanged; only the file/export name moves.
- Re-verify the security cookie hardening added in the CSO pass survives the rename
  (the `secureCookieOpts()` helper forcing httpOnly+Secure+SameSite).

### 2. `next lint` removed (v16) — REQUIRED (breaks CI)

`next build` no longer lints, and `next lint` is gone.

- `frontend/package.json`: `"lint": "next lint"` → ESLint CLI directly,
  e.g. `"lint": "eslint . --max-warnings=0"` (or adopt Biome).
- Add a real `eslint.config.*` / keep `.eslintrc` with `eslint-config-next`'s flat
  config (`@next/eslint-plugin-next`).
- Remove any `eslint: {}` block from `next.config.js` (we don't have one — confirm).
- **CI impact:** `.github/workflows/ci.yml` frontend job runs `npm run lint`. It
  keeps working once the script points at the ESLint CLI. Verify the workflow goes
  green on the branch before merge.

### 3. Async Request APIs fully enforced (v15 soft, v16 hard) — REQUIRED

`cookies()`, `headers()`, `draftMode()`, and `params` / `searchParams` are async.
v15 warned; **v16 removes the sync fallback entirely.**

- `lib/supabase-server.ts`: `cookies()` must be `await cookies()`. This cascades —
  `getSupabaseServer()` / `getSupabaseRoute()` become `async` (or await inside), and
  every caller (the 4 route handlers, server components using them) must `await`.
- The 2 pages reading `params` / `searchParams`: type them as `Promise<...>` and
  `await` before use.
- Run the codemod (below) — it handles most of these mechanically. Manually audit
  the Supabase helper cascade, since making it async ripples through callers.

### 4. React 19 required (v15+) — REQUIRED

- Bump `react` + `react-dom` to 19, and `@types/react` / `@types/react-dom`.
- Watch: `useFormState` → `useActionState`; ref-as-prop changes; stricter
  hydration. Check `recharts`, `@tanstack/react-query`, `class-variance-authority`,
  and any other UI deps for React 19 peer support **before** bumping (this is the
  most likely source of runtime surprises).

### 5. Turbopack default (v16)

`next dev` (and build) default to Turbopack. Our custom `webpack` cache override in
`next.config.js` (the dev `config.cache = { type: 'memory' }` PackFileCache fix) is a
**webpack** hook — under Turbopack it's ignored. Decide: opt back into webpack
(`--webpack` / config flag) or drop the override and confirm the chunk-404 issue it
worked around doesn't recur under Turbopack. Re-test the dev server self-heal.

---

## Breaking changes that DO NOT affect this app (cleared)

So a future reviewer doesn't re-investigate:

- **`next/image` changes** — we use none.
- **`rewrites` / `redirects` config** — none in `next.config.js`.
- **Server Actions changes** — no `'use server'` anywhere.
- **`amp` config removal** — never used AMP.
- **`eslint` config option removal** — not set in our config.
- **fetch caching default flip** — we don't rely on Next's fetch cache (React Query
  owns server state; routes are `force-dynamic`). No `revalidate`/`unstable_cache`.

---

## Migration steps

1. Branch: `chore/next-16-upgrade` (own branch, not bundled).
2. **Check dep compatibility first** — confirm `recharts`, `@tanstack/react-query`,
   `@supabase/ssr`, `@supabase/supabase-js`, `class-variance-authority`,
   `tailwind*` all support React 19 / Next 16. If any lag, resolve before bumping.
3. Run the official codemod:
   ```
   cd frontend
   npx @next/codemod@latest upgrade latest
   ```
   It bumps `next`/`react`/`react-dom`, migrates async request APIs, `next lint` →
   ESLint CLI, `middleware` → `proxy`, strips `unstable_`/`experimental_ppr`.
4. Manually finish what the codemod can't:
   - The `lib/supabase-server.ts` async-cookies cascade (verify all callers await).
   - Re-apply / verify the CSO cookie hardening after the `middleware`→`proxy` rename.
   - Decide Turbopack vs webpack for the dev-cache override.
   - `experimental.instrumentationHook` — instrumentation is stable in 15+; the
     experimental flag may warn/no-op. Move to the stable `instrumentation.ts`
     convention if needed (we use it for Sentry/OTel).
5. `frontend/package.json` lint script → ESLint CLI; add flat ESLint config.
6. `rm -rf frontend/.next` then `npm run build` (stale `.next` across major versions
   causes the `/_document` PageNotFoundError — seen during the 14.2.35 bump).
7. Update `frontend/Dockerfile` if the standalone output path / start command
   changed (verify `output: 'standalone'` server entry is unchanged; Node 22 is fine
   for Next 16).
8. Confirm the CSP report-only header in `next.config.js` still emits (the
   `async headers()` API is unchanged across these versions).

## QA checklist (before merge)

- [ ] `npm run typecheck` clean (`tsc --noEmit` with React 19 types)
- [ ] `npm run lint` clean via the new ESLint CLI
- [ ] `rm -rf .next && npm run build` clean (no `/_document` error)
- [ ] `/qa` pass on the running app — login (tenant + platform), the two API proxies
      (`/api/backend/*`, `/api/platform-backend/*`), session refresh, `/platform`
      gate, charts render (recharts + React 19), forms submit
- [ ] Cookie flags still httpOnly+Secure+SameSite after `proxy.ts` rename
- [ ] CI green on the branch (backend + frontend jobs)
- [ ] `npm audit` (frontend, prod) clean or only accepted advisories
- [ ] Deploy to staging first; smoke-test before main

## Rollback

Single squashed commit on its own branch → revert the merge commit. Pin back to
`next@14.2.35` + `react@18.3.1` and `rm -rf .next` if anything regresses in prod.

## Open questions / risks

- **React 19 peer support** of `recharts` is the top risk — verify the installed
  major supports React 19, or bump it, before starting.
- Turbopack may surface build/runtime differences vs webpack — budget time to A/B
  the dev + prod build.
- `instrumentationHook` → stable `instrumentation.ts`: confirm Sentry
  (`src/instrument` equivalent on the frontend, if any) still initialises.
- Whether to go straight 14 → 16 or stage via 15 first. Codemod supports direct
  `upgrade latest`; staging via 15 makes the async-API and React-19 changes easier
  to bisect if something breaks. Recommend **15 first, then 16** if time allows.
