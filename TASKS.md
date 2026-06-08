# TASKS

Work log for Elevate Dental OS. Reverse-chronological by session. Durable
architecture lives in `CLAUDE.md`; this file tracks **what was done when** and
**what's still open**. Status keys: ✅ done · 🟡 partial · ⬜ pending · ⚠️ blocked.

Target launch: **Fri 30 May 2026** (now past — in stabilisation).

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
