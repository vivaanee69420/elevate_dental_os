# TASKS

Work log for Elevate Dental OS. Reverse-chronological by session. Durable
architecture lives in `CLAUDE.md`; this file tracks **what was done when** and
**what's still open**. Status keys: ✅ done · 🟡 partial · ⬜ pending · ⚠️ blocked.

Target launch: **Fri 30 May 2026** (now past — in stabilisation).

---

## Session — 2026-06-08 · Meta Ads OAuth connect debugging (PAUSED — blocked on secret)

Goal: get Meta Ads `Connect` working. Code is fine — this is all Meta-app +
Railway-env config. No code changes made.

### Root causes found (two, stacked)
1. **Wrong secret.** `.env` `META_APP_SECRET=df9d6182155e8b31cb7f872bb8a9e5f0`
   belongs to the OLD app `1703170187610025`, NOT the new app `1475546453835204`.
   Proven via direct Meta API:
   - `client_id=1703… + df9d…` → returns access_token ✅ (valid pair, old app)
   - `client_id=1475… + df9d…` → `Error validating client secret` ❌
   A secret validates against exactly one app, so `1475…`'s real secret is still
   unknown / never copied.
2. **Railway env stale.** Prod authorize URL showed `client_id=1703…` +
   `redirect_uri=localhost:8080` → Railway had old `META_APP_ID` and default
   `BACKEND_PUBLIC_URL`. The authorize `redirect_uri` is built from
   `BACKEND_PUBLIC_URL` (`meta-ads-provider.js:36`); `client_id` = live read-out
   of `META_APP_ID`.

### Progress this session
- `BACKEND_PUBLIC_URL` on Railway now correct → redirect_uri shows the railway
  domain. ✅
- `META_APP_ID` on Railway STILL `1703…` → authorize still uses the old app. ❌

### Browser "Feature not available" / "App is not active"
- Served by Facebook (backend logs show nothing — flow never reaches callback).
- = the app being used (`1703…`) has Facebook Login not configured/published.
  New apps use **Publish**, not a Dev/Live toggle.
- Likely **Facebook Login for Business vs classic** mismatch: code sends classic
  `/dialog/oauth?scope=ads_read` (no `config_id`). FB-Login-for-Business needs a
  `config_id`. If the app only offers "for Business", either add the **classic
  Facebook Login** product OR patch `config_id` into the authorize URL.

### To finish (pick ONE app, make id+secret+config consistent)
- **Path A — old app `1703…` (creds already verified working):** publish it +
  configure classic Facebook Login + register prod redirect URI
  `https://elevatedentalos-production.up.railway.app/oauth/meta_ads/callback`.
  Railway: `META_APP_ID=1703170187610025`, `META_APP_SECRET=df9d6182…`. Redeploy.
- **Path B — new app `1475…`:** get its REAL secret (Basic → Show), verify via
  `curl "https://graph.facebook.com/oauth/access_token?client_id=1475546453835204&client_secret=<SECRET>&grant_type=client_credentials"`
  (must return access_token, not error). Then set `META_APP_ID=1475…` +
  that secret on Railway backend AND worker. Register the prod redirect URI on
  app `1475`. Redeploy.
- Verify after: prod authorize URL must read `client_id=<chosen app>` +
  railway redirect. Connect → check `integrations.last_error` for `meta_ads`
  (currently "Error validating client secret", org d3256296-…).
- Rotate `df9d6182…` (old app secret) + the secrets pasted in chat once stable.

### Note
- Diagnostic: `client_id` in the FB authorize URL = live value of backend's
  `META_APP_ID`; `redirect_uri` = `BACKEND_PUBLIC_URL`. Use them to confirm which
  env the running backend actually loaded (env only reloads on restart/redeploy).

---

## Session — 2026-06-08 · Architecture / scaling / security review (PLAN, not yet built)

Request: review architecture, sync performance, reliability, security; produce a
prioritised roadmap. Grounded in actual source, not the work log.

### Findings (already built — do NOT rebuild)
- Sync is already non-blocking — `integration.controller.js:56` fire-and-forget,
  UI polls `/sync-progress`.
- Worker process exists — `workers/index.js` (node-cron) + `ghl-sync-once.js`.
- Token encryption AES-256-GCM at rest (`crypto.js`); tokens never reach frontend.
- Webhook HMAC verify + signed per-org URL token w/ `timingSafeEqual`.
- Rate limiting: 100/min/IP global + 50/min/verified-user + 5/min login. helmet on.

### Key bottleneck
- Sync **progress** lives in a module-level `Map` (`lib/integrations/sync-progress.js`,
  "lost on restart") and sync **execution** is a bare Promise in the web process.
  → dies on restart/deploy, no retry, **pins app to a single web instance**
  (progress poll to a 2nd instance reads an empty Map).

### Decisions (user)
- **No MFA** (internal/consulting product).
- **No Redis** — use **Postgres** instead: `pg-boss` for the job queue (durable in
  the already-backed-up DB, transactional with data writes, zero new infra) +
  snapshot tables/matviews for KPI cache. Redis throughput ceiling is far above
  this scale; fewer moving parts = the stated reliability goal.

### Plan — sync → pg-boss (two isolated pieces)
- **A. Progress: Map → `sync_progress` table.** New migration: table keyed
  (organisation_id, provider) with running/pct/phase/page/total_pages/done/error/
  updated_at. Rewrite `sync-progress.js` set/getProgress as async upsert/select
  (same 3-fn interface). `/sync-progress` then answers from any instance + survives
  restart. ~300 upserts/Dentally pull = trivial; debounce later if noisy.
- **B. Execution: in-web Promise → pg-boss job on the worker.** Web `sync()` →
  `boss.send('integration-sync', {orgId,provider,full}, {singletonKey:
  "<orgId>:<provider>", retryLimit:3, retryBackoff:true})`, returns immediately.
  Worker `boss.work('integration-sync', …)` reuses existing `integrationService.syncNow`
  (already writes progress). `singletonKey` replaces the in-memory stale-flag
  concurrency guard (delete it). `bootstrapDentally`/`bootstrapGohighlevel` →
  `integration-bootstrap` job, same shape. pg-boss connects to Supabase Postgres
  (direct conn string, own `pgboss` schema).

### Roadmap (status ⬜ pending)
Critical
- ⬜ **RLS backstop**: enable Custom Access Token Hook (rule 8) + turn RLS on
  *under* the existing manual `.eq('organisation_id')` filters (fail closed on a
  missed filter) + per-repo cross-org isolation test. 32 repos on `serviceClient`,
  only 1 uses `req.db` — manual filter is currently the ONLY tenant wall. Highest
  severity (patient + financial PII).
- ⬜ **Sync → pg-boss** (plan A+B above).

Important
- ⬜ Incremental sync: persist per-(org,provider,resource) cursor; commit cursor
  only after page lands → crash-safe resume.
- ⬜ Webhook replay protection: reject stale provider timestamp + dedupe on event id
  (`webhook-token.js` is intentionally no-expiry).
- ⬜ Audit logins + data exports to `audit_log` (mutations already covered by `audit` mw).
- ⬜ Turn on CSP (`helmet({contentSecurityPolicy:false})` today) + turn on Sentry
  (dep installed, no-op until `SENTRY_DSN` set; keep PII scrubbing for patient/financial).
- ⬜ Secret rotation: key-id prefix on ciphertext blobs; run a verified backup-restore drill.

Future
- ⬜ Dentally → webhook-driven deltas; nightly full sync = reconciliation backstop only.
- ⬜ Cloudflare WAF in front of Railway; per-tenant rate tiers.

NOT doing: MFA, Redis, load balancers, k8s, sharding (wrong scale).

---

## Session — 2026-06-08 · Command Centre custom date range

Commit `ebb75d7` on `main`. Request: "since we have past data from years can we
add filters here" (Command Centre / Dashboard).

### Context
- Period chips MTD/QTD/6M/YTD all anchor to **now** (`rangeToDates` uses
  `new Date()`) — no way to view past years.
- Backend already honours arbitrary `from/to` on `dashboard-summary` +
  `revenue-series` (`_monthWindow`, chart capped 36 months) → frontend-only fix.
- Verified data extent: `payments` span **2020-01 → 2026-06**, 86k rows / 54
  months. Multi-year filtering is real, not empty.

### Decisions (user)
- Filter shape: **custom date range** (not year-selector / YoY-compare).
- Interaction: **always-visible From/To** inputs beside the chips.

### Done ✅
- ✅ Always-visible From/To `<input type="date">` after the chip group in
  `DashboardScreen.tsx`. Editing either → custom mode, drives all KPIs + chart.
- ✅ `custom` state overrides preset `period`; `periodLabel` = "Custom" when set.
- ✅ Bounds `min 2020-01-01` / `max today`; reversed dates auto-swap; inputs
  pre-filled from current period so one edit activates custom; preset chip click
  clears custom + restores relative window.
- ✅ `npm run typecheck` + `npm run lint` clean.

### Open ⬜
- ⬜ Live browser QA (needs dev server + login) — confirm a 2024 window changes
  numbers + chart; not yet run.

Files: `frontend/features/dashboard/components/DashboardScreen.tsx`.

---

## Session — 2026-06-08 · QuickBooks full data fetch

Commit `fc7fac8` on `main`. Started from "is QuickBooks completely wired?" audit.

### Audit findings (before work)
- QBO OAuth + current-month P&L sync already existed (provider/sync/cron/tests),
  but only fetched **current-month P&L** — not "completely wired".
- 4 gaps identified: (1) no multi-month backfill, (2) P&L only — no Balance
  Sheet / Cashflow / Receivables, (3) `quickbooks` missing from frontend
  `SYNCABLE` (no Refresh button), (4) Intuit creds + live UAT pending.

### Decisions (user)
- Cashflow: **option B** — pull QBO receipts into weekly view + dedupe.
- Debt Recovery: **build full QBO receivables feed**.
- Backfill depth: **12 months**.

### Done ✅
- ✅ **12-month P&L backfill** — `syncOneOrg` backfills 12 months on first connect
  / full refresh (`!last_sync_at || full`); nightly cron stays current-month only.
- ✅ **Balance Sheet → `bank_accounts`** (`source='quickbooks'`) — real Cashflow
  opening balance.
- ✅ **Invoice (Balance>0) → `invoices`** (`source='quickbooks'`, default practice)
  — QBO debtors now flow into the existing Debt Recovery slice.
- ✅ **Payment → `payments`** (`source='quickbooks'`, settled) — Cashflow weekly
  receipts (option B), **deduped** vs existing non-QBO settled by date+amount
  (no Stripe double-count). Secondary pulls best-effort (`safePull`).
- ✅ **Migration `000057`** — `bank_accounts.source` + `external_id` +
  `uq_bank_accts_src_ext`. **Applied + verified on hosted** (`mkfhpzjbijbachoonytt`).
- ✅ `quickbooks` added to frontend `SYNCABLE` (Refresh button).
- ✅ 12 new unit tests; full backend suite **589/589 green**; eslint + tsc clean.
- ✅ Branch audit: confirmed `main` is ahead of all 7 branches/worktrees; nothing
  to merge (the 2 non-merged branches carry only deletions main already reflects).

### Open ⬜ (user setup — can't be coded)
- ⬜ Set `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` on web + worker.
- ⬜ Register Intuit redirect URI; confirm Connect completes end-to-end (sandbox).
- ⬜ **UAT vs live/sandbox company** — verify P&L / Balance Sheet / Invoice /
  Payment JSON shapes, bank/cash extraction heuristic, and receipt dedupe.
- ⬜ Branch + worktree cleanup (offered, awaiting confirm).

Files: `backend/src/lib/integrations/quickbooks-sync.js`,
`backend/test/quickbooks-sync.test.mjs`,
`frontend/features/system/components/IntegrationsScreen.tsx`,
`supabase/migrations/20260101000057_*.sql`, `qb.md`.

---

## Prior sessions (reconstructed from git + CLAUDE.md + memory)

### Notifications service ✅
In-app + AWS SES email + SNS SMS. Migration `000052`. Outbox drain worker
(retry/backoff), `/webhooks/ses-events` bounce/complaint suppression (SSRF guard,
topic allowlist, SNS signature verify v1+v2), triggers (signup→admins, invite,
approve/reject, weekly digest), inbox + preferences screens, topbar bell.
Merged via `fae34e6`. Memory: `notification-service`.
- ⬜ `SNS_TOPIC_ARN` must be set for bounce-suppression in prod.

### Health — live actuals + historised inputs ✅
- KPI Scorecard live actuals (`9e00e05`, migration `000056`).
- Manual inputs (baseline/targets/KPIs) historised via `snapshots.inputs` + as-of
  reads (migration `000054`); as-of period filter. Memory: `manual-input-history`.
- 🟡 `chair_utilisation` still **overwrites** (history = Phase B, migration `000055`
  groundwork). Memory: `manual-input-history`.

### Meta Ads + period-windowed analytics ✅
Real Meta OAuth + spend sync mirroring Google Ads (`9af1581`). Meta token model
differs (no refresh_token, long-lived `fb_exchange_token`, decimal-string spend).
Analytics rollups period-windowed (`since`/`until`, migrations `000049`/`000053`).
Memory: `meta-ads-integration`.

### Dentally integration + fixes 🟡
Practice mapping + webhook panel + sync overlay; on-connect bootstrap
(detect→create-practices→pull) fixing empty-siteMap zero-data; 12-month connect
window + nightly one-time full backfill; killed stuck progress bar (6 weighted
phases) `283729b`. Memories: `dentally-onconnect-bootstrap`,
`dentally-sync-progress-phases`.
- ⚠️ **Data gaps (need re-sync + price feed):**
  - 34% of synced appts have null `contact_id` AND null `pms_patient_id` — names
    unrecoverable without re-sync; no deposit data. Memory: `dentally-appt-contact-linkage-gap`.
  - `associate_id` null on all ~329k appts; no price/production source →
    Treatments + Pay screens can't be fully wired. Memory: `dentally-treatment-pay-data-wall`.
  - `/invoice_items` (name + item_price) is the real per-treatment fee feed and is
    **not pulled**; `treatment_plans` silently fails (0 vs 61k). Memory:
    `dentally-invoice-items-real-fees`.

### Debt Recovery ✅
`invoices` table (migration `000027`), `/api/debt` (repo→service→controller→route),
`DebtScreen` wired live to `useDebt()`. Merged `0e84719`. (QBO now also feeds this
— see today's session.)

### Business Hub ✅
Group performance funnel KPIs wired to live `treatment_plans` (RPC `000048`) + GHL
leads (`e4931cf`); null-practice-leads gotcha fixed. Month/day period filter
windows rollups via `since`/`until` (migration `000049`). Memories:
`business-hub-group-performance`, `business-hub-period-filter`,
`overview-data-aggregation`.

### LMS Module Library ✅
Global catalogue (no org_id), superadmin-authored. Migrations `000045` (courses),
`000047` (course→module→lesson + categorised files), `000048`
(`course_resources.category` — marking-rubrics | additional-resources). Admin +
tenant Materials tabs, folder-tree browser, downloads. All applied on hosted.
Memory: `module-library-lms`.

### Integrations layer (Dentally / GHL / Xero / CSV) ✅
Per-provider connectors (`backend/src/lib/integrations/`), routes
(`integrations`/`oauth`/`csv-import`), secrets encrypted. Payments dashboard on
exact summary + rollup RPCs (`000017`–`000020`). S3 file uploads. GHL via Private
Integration Token + Location ID (V2). Migrations `000013`–`000033` applied hosted.
Memory: `ghl-integration-api-key`.

### Auth / RBAC / signup approval ✅
Dynamic RBAC (`role_permissions` `000005` + `permissions.js` catalog), grant-ceiling
enforcement, signup-approval flow (public signup → pending → superadmin approve;
migrations `000006`/`000011`), `auth_bootstrap` one-round-trip fast path
(`000010`), unified login (two isolated JWT systems), platform superadmin console,
`must_change_password` gate. Memories: `rbac-perms-override-ceiling`,
`signup-approval-flow`.

### Foundational ✅
- Backend converted to **native ESM** (107 files).
- ~50 dashboard screens ported pixel-faithful from `preview/` (mock-data origin).
- Custom Access Token Hook function created on hosted (`000004`).

---

## Standing TODOs (cross-session, still open)

- ⚠️ **Enable Custom Access Token Hook on hosted** (rule 8) — function exists +
  granted, but the GoTrue toggle (Supabase → Auth → Hooks) is config, not SQL;
  MCP can't set it. Required before anything relies on `tenantClient`/RLS or
  `organisation_id`/`role` JWT claims. Low impact today (repos use `serviceClient`
  + manual org filters).
- ⬜ **Clear pre-existing orphan auth users** (Supabase → Auth → Users, no matching
  `public.users`). Future Team-UI removes won't orphan.
- 🟡 **~50 screens still mock** — replace `features/*/data.ts`/`mock.ts` with real
  API per domain (separate slices).
- 🟡 **Dentally re-sync + price feed** needed to unblock Treatments/Pay + recover
  null appt linkage (see Dentally section).
- ⬜ Frontend has **no test framework**; CI does not gate frontend tests.
- ⬜ `recharts` not code-split (bundle size); `frontend/src/` move deferred
  (`TODOS.md`).
- ⬜ Branch/worktree cleanup (this session's audit: 7 branches stale/merged).
