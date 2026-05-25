# highleveltodo.md — GoHighLevel integration

Companion to `highlevel.md`. Minimal inbound slice + blocker fixes.
**Status after this session: backend + tests + connect UI shipped on branch `feat/gohighlevel-integration`. 153 backend tests pass (was 122).**

> **Tomorrow's queue (added end of session 2):**
> 1. Finish GHL connect config (creds + apply 000013 + e2e) — see "GHL connect: make it actually work" below.
> 2. Build forgot-password completion flow — see "Forgot password (broken — finish it)" below.
> Also shipped this session (separate concerns, decide commit split): **auth login fix** (serviceClient session contamination + error/absent 503/403 split) and **integration error-handling fix** (graceful 501 + AppError messages surface).

---

## DONE this session

### Blockers fixed
- [x] **B1. `integrations` schema reconciled** — migration `supabase/migrations/20260101000013_gohighlevel_integration.sql`: idempotent `ADD COLUMN IF NOT EXISTS` (secrets, verified_at, expires_at, scopes, last_sync_at, refresh_in_progress_at), legacy status value migration + new 5-value CHECK + default 'pending'. Same migration adds GHL columns to contacts/leads.
- [x] **B2. OAuth callback auth** — `lib/oauth-state.js` (HMAC sign/verify, 10-min TTL, provider check, constant-time compare). Public route `GET /oauth/:provider/callback` (`routes/oauth.routes.js`) mounted in `app.js` outside `/api`. `integration.controller.oauthCallback` derives orgId from verified state, redirects to frontend. `redirect_uri` now uses `BACKEND_PUBLIC_URL`.

### Backend
- [x] `lib/integrations/gohighlevel-provider.js` — authorize (chooselocation + signed state), callback (token exchange, user_type=Location, store locationId/companyId), refresh (single-use rotation + claim guard), revoke. Registered in `lib/integrations/index.js`.
- [x] `lib/integrations/gohighlevel-sync.js` — inbound `syncAllOrgs`/`syncOneOrg`; helpers `toPence`, `normalizePhone`, `mapStage`, `extractContact`, `matchOrCreateContact`; ensureFreshToken; 429 retry-after handling. (Lives in `lib/integrations/` to match the `dentally-sync.js` precedent, not `workers/`.)
- [x] Repo: `claimRefresh` / `clearRefresh` / `setSyncTime` (`repositories/integration.repository.js`).
- [x] Hourly cron wired in `workers/index.js`.
- [x] `docs/API.md` updated (public callback + integrations endpoints).

### Frontend
- [x] **Connect flow** — works with zero new code: GHL auto-appears in `IntegrationsScreen` (backend-driven `available` list) with a Connect button → `redirectUrl` → `window.location`.
- [x] Pipeline card tag — `GHL Synced` / `Manual Entry` on each card (`PipelineScreen.tsx`), driven by `lead.sync_status`. Added `sync_status`/`ghl_*` to the `Lead` type.

### Tests (vitest, all green)
- [x] `test/oauth-state.test.mjs` (7) — roundtrip, tamper, wrong key, expiry, provider mismatch, malformed, missing secret.
- [x] `test/gohighlevel-sync.test.mjs` (13) — toPence/normalizePhone/mapStage/extractContact + matchOrCreateContact priority (ghl_id → email → create).
- [x] `test/gohighlevel-provider.test.mjs` (8) — authorize URL/state, callback success/failure/missing-code, refresh claim-guard skip + rotation + always-clear.
- [x] `test/setup.js` — added `.or()` to the query mock + test env defaults.

---

## REMAINING for tomorrow

### Verify (do FIRST)
- [ ] Run `supabase db reset` from repo root — confirm `000013` applies clean and the suite still boots. (Not run this session — supabase local stack not started.)
- [ ] On hosted: `\d integrations` to confirm columns/CHECK, then apply `000013`, then `NOTIFY pgrst, 'reload schema';`.
- [ ] Set Railway env: `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `OAUTH_STATE_SECRET`, `BACKEND_PUBLIC_URL`.
- [ ] Confirm GHL V2 opportunity payload shape (`pipelineStageId`, `stageName`, `monetaryValue`, `contact{}`) vs current LeadConnector docs; adjust `extractContact`/`syncOneOrg` field reads if needed.
- [ ] End-to-end OAuth test against a real GHL sandbox location (the one path no unit test covers).

### Frontend polish (deferred, not blocking)
- [ ] Lock GHL-mastered fields (pipeline stage) on `sync_status==='synced'` leads + warning banner ("managed by GoHighLevel"). Needs wiring where stage mutation happens (drag / edit modal).
- [ ] "Synced with GoHighLevel · last updated Xm ago" banner atop the pipeline (needs the integrations query on the CRM page).
- [ ] Handle `?connected=` / `?error=` query on `/integrations` (toast/status after redirect).
- [ ] Stage-mapping settings screen — deferred; ships with heuristic + default for now.

### Known deviations from `highlevel.md` (intentional)
- Sync code in `lib/integrations/` not `workers/` (matches dentally precedent).
- Connection-error status uses `'failed'` (the integrations CHECK has no `'error'`/`'expired'`); frontend banner should key off `status==='failed'`.
- Refresh concurrency: optimistic `refresh_in_progress_at` claim, not `SELECT FOR UPDATE`.
- `db/01_schema.sql` (unmanaged copy) NOT updated — already drifted from `000008`; reconcile separately if you care about that mirror.

### Deferred to a follow-up PR (out of this slice)
- Real-time webhook — must be PUBLIC under `/webhooks/...` (NOT `/api`, which 401s server-to-server), with signature verification + raw body (mirror Stripe ordering) + idempotency.
- Push-back / bi-directional sync (Elevate → GHL).
- Deleted-opportunity soft-delete (Edge Case 5).
- Batched contact dedup (per-opp lookups fine at 100/run).
- Advisory-lock RPC (only if the optimistic guard proves insufficient).

---

## Parallelization (worktrees)
- Lane A (blockers) — DONE, merged path for B/C.
- Lane B (backend provider + sync) — DONE.
- Lane C (frontend) — connect + tag DONE; polish items above remain (independent of B).

---

## GHL connect: make it actually work (session 2 — tomorrow)

Connect now fails gracefully with a clear 501 "not configured" (was an opaque 500).
Done this session: `OAUTH_STATE_SECRET` + `BACKEND_PUBLIC_URL` set in `backend/.env`;
service wraps config errors as 501; `errors.js` surfaces AppError messages.

Still needed to complete a real connection:
- [ ] **Create a GoHighLevel marketplace app** (marketplace.gohighlevel.com) → get client id/secret.
  Register redirect URI: `http://localhost:8080/oauth/gohighlevel/callback` (local) and the prod
  `${BACKEND_PUBLIC_URL}/oauth/gohighlevel/callback`. Scopes: contacts + opportunities read/write.
- [ ] Put `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET` in `backend/.env`, then **restart the backend**
  (`node --watch` does NOT reload on a `.env`-only change).
- [ ] **Apply migration `000013` to hosted** (integrations schema reconcile + GHL columns) +
  `NOTIFY pgrst, 'reload schema';` — else token persistence / sync fail on hosted.
- [ ] End-to-end: Connect → GHL chooselocation → callback → row `active` → hourly sync pulls opps.
- [ ] Confirm GHL V2 opportunity payload field names vs `extractContact`/`syncOneOrg`.

---

## Forgot password (broken — finish it) (session 2 — tomorrow)

**Current state: half-wired, dead-ends.** `app/(auth)/forgot-password/page.tsx` calls
`supabase.auth.resetPasswordForEmail(email, { redirectTo: '/login' })` — sends a Supabase
recovery email, but the link lands on `/login` and **nothing consumes the recovery token**.
There is NO page to set a new password. So reset is effectively non-functional.

To finish:
- [ ] **Build `/update-password` (or `/reset-password`) page** that:
  - on load, picks up the Supabase recovery session from the URL hash
    (`@supabase/ssr` / supabase-browser detects `type=recovery`),
  - form: new password + confirm → `supabase.auth.updateUser({ password })`,
  - on success → redirect to `/login` (or straight to `/dashboard` if the recovery session is usable),
  - handle expired/invalid recovery link with a clear message + "request a new link".
- [ ] Point `forgot-password` `redirectTo` at that page (not `/login`).
- [ ] Confirm Supabase project SMTP is configured so recovery emails actually send (hosted + local).
- [ ] No backend route needed (Supabase GoTrue owns recovery), BUT verify the login provisioning
  gate still applies after reset — an `active` user logs in fine; a `pending`/`invited`/orphan does not.
- [ ] Same gap likely affects the **invite → set-password** flow (no set-password page found either);
  check whether invited members can actually set their first password, and reuse the same page if so.
- [ ] Add a frontend test once the page exists (frontend has no test framework yet — see TODOS).
