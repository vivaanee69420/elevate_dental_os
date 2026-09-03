# CallRail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect one CallRail company per practice with its own API key, and ingest every call by webhook and by scheduled pull — so Google Ads phone calls become countable leads attributed to the right practice.

**Architecture:** Mirrors the **GoHighLevel multi-subaccount** pattern, because the owner has one CallRail key per company and four companies, one per practice. Each key becomes an `integration_accounts` row — provider `callrail`, the CallRail company id, its own encrypted key, its own random `webhook_token`, mapped 1:1 to a practice. A call's practice therefore comes from **the key that fetched it**, which needs no mapping step and cannot drift. Calls land in their own table; nothing is written into `leads`.

**Tech Stack:** Postgres/Supabase, native-ESM Node backend, vitest, Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-03-callrail-and-google-lead-conversions-design.md`

**Scope:** THIS plan is the integration only — connect, ingest, map. The lead-conversion surface that consumes it (cards, CPL/CPB/CPA, click-through to people) is Phase A of the spec and gets its own plan. The two meet at `callrail_calls`.

## Global Constraints

- **MULTI-TENANT — the org id comes ONLY from `req.user.organisation_id`.** Never a query parameter, never a body field. Under an agency switch that value is already the sub-account's. The webhook is the one exception and resolves its org from its own path token — never from anything in the payload.
- **A call is only ever matched or mapped within its own organisation.** `serviceClient` bypasses RLS, so the explicit `organisation_id` filter IS the tenant boundary.
- **Credentials are encrypted** via `encryptSecret` / `decryptSecret` from `backend/src/lib/crypto.js`, exactly as every other provider does. An API key must never be returned by any read endpoint, logged, or included in an error message.
- **Ingestion is idempotent on CallRail's own call id.** A webhook and a pull describing the same call produce ONE row. Re-running a pull changes nothing.
- **Every call is stored; a call's practice is the practice of the company that fetched it.** There is no tracking-number map. A connected CallRail company with no `practice_id` is UNASSIGNED: its calls are stored, attributed to no practice, and shown in the panel as awaiting a decision — never silently folded into a practice.
- **Reuse `normaliseEmail` / `normalisePhone`** from `backend/src/lib/sheet-export/normalise.js`. Do NOT write a second normaliser: two normalisation rules would silently disagree about who is the same person, which is the one thing the dedup rule cannot survive.
- **Paged reads:** order on a unique key, `.range()`, and STOP ON AN EMPTY PAGE, NEVER A SHORT ONE. PostgREST caps responses at 1000 rows silently and that applies to set-returning RPCs identically.
- **Mandatory grant idiom on every RPC:** `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ... TO service_role;` — a newly created function in `public` IS anon-executable by default on this project.
- **RPCs are `LANGUAGE plpgsql` with `RETURN QUERY EXECUTE ... USING`**, `SECURITY DEFINER`, `SET search_path = public`.
- Routes live under `/api/integrations/callrail/*` and are `requireRole('owner')`, except the read-only status which also allows `practice_manager` — matching how Emergent does it.
- **NO DARK MODE** (rule 1). **BRITISH ENGLISH** in all UI copy (rule 4). **No emojis** (rule 7).
- Native ESM: `import`/`export`, `.js` extensions on relative imports, never `require`/`module.exports`.
- **Migration number:** `20260101000154_callrail.sql`. Do not renumber.
- **Verification:** Docker and the `supabase` CLI are NOT installed. Do not attempt `supabase start` or `db reset`. The controller verifies SQL against the hosted database inside `BEGIN … ROLLBACK`.

---

### Task 1: Migration — `callrail_calls`

**Files:**
- Create: `supabase/migrations/20260101000154_callrail.sql`

**Interfaces:**
- Produces the table `callrail_calls`, scoped to an `integration_accounts` row.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- CallRail — tracked phone calls, one row per call, scoped to the CallRail
-- COMPANY (an integration_accounts row) that fetched it.
--
-- WHY NO TRACKING-NUMBER MAP: the owner holds one API key per CallRail
-- company and one company per practice. A call's practice therefore follows
-- from the key that fetched it — integration_accounts.practice_id — which
-- needs no mapping step, cannot drift, and reuses the pattern GoHighLevel
-- multi-subaccount already established here.
--
-- tracking_number and source are still stored. Not to classify with, but so
-- the first sync can SHOW what CallRail actually reports. The owner's
-- position is that every tracked call came from the ad — "if they see the ad
-- then only they call" — and that is very likely right for a CallRail set up
-- solely for Google Ads. Storing the source means that assumption is
-- checkable against real data rather than permanent and invisible.
--
-- WHY CALLS ARE NOT ROWS IN `leads`: writing them there puts rows with no
-- pipeline, no opportunity and no GHL id into a GoHighLevel-shaped table, and
-- makes the cross-source dedup implicit at write time — where it is invisible
-- and unfixable. A separate table makes dedup an explicit, testable read-time
-- step.
--
-- MULTI-TENANT: every row carries organisation_id; serviceClient bypasses RLS
-- so that filter IS the isolation. RLS on with no policy.
-- Idempotent + additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.callrail_calls (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id        uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- The CallRail company this call came from. Its practice_id is the call's
  -- practice; practice_id is denormalised here so a read never needs the join.
  integration_account_id uuid REFERENCES integration_accounts(id) ON DELETE SET NULL,
  practice_id            uuid REFERENCES practices(id) ON DELETE SET NULL,
  -- CallRail's own id: the idempotency key. A webhook and a pull describing
  -- the same call must produce one row.
  callrail_id            text NOT NULL,
  tracking_number        text,
  caller_number          text,
  caller_phone10         text,     -- normalised; the dedup and matching key
  caller_name            text,
  caller_email           text,
  caller_email_norm      text,     -- normalised
  started_at             timestamptz NOT NULL,
  duration_seconds       integer,
  answered               boolean,
  first_call             boolean,  -- CallRail's own "first time this number called"
  gclid                  text,
  keywords               text,
  campaign               text,
  source                 text,     -- what CallRail itself attributes the call to
  raw                    jsonb,    -- payload as received, for forensics
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  UNIQUE (organisation_id, callrail_id)
);

DROP TRIGGER IF EXISTS callrail_calls_updated_at ON public.callrail_calls;
CREATE TRIGGER callrail_calls_updated_at BEFORE UPDATE ON public.callrail_calls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE public.callrail_calls ENABLE ROW LEVEL SECURITY;

-- The funnel reads one org's window; the matcher probes by phone; the panel
-- counts per company.
CREATE INDEX IF NOT EXISTS idx_callrail_calls_org_started
  ON public.callrail_calls (organisation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_callrail_calls_org_phone
  ON public.callrail_calls (organisation_id, caller_phone10)
  WHERE caller_phone10 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_callrail_calls_account
  ON public.callrail_calls (integration_account_id, started_at DESC);

NOTIFY pgrst, 'reload schema';
```

**No `callrail_number_map` table.** An earlier draft had one; the owner's one-key-per-practice setup makes it unnecessary, and an unnecessary mapping step is a place for the data to drift out of agreement with reality.

- [ ] **Step 2: Static self-checks — report each**

You cannot run SQL here. Confirm and report:
- `set_updated_at()` exists: `grep -rn "FUNCTION set_updated_at" supabase/migrations | head -3`
- `uuid_generate_v4()` is in use by existing migrations: `grep -rln "uuid_generate_v4" supabase/migrations | head -3`
- `organisations(id)` and `practices(id)` are the FK targets other tables use: `grep -rn "REFERENCES organisations(id)" supabase/migrations | head -3`
- `20260101000154_callrail.sql` does not already exist and 000154 is free.

- [ ] **Step 3: Put the controller's assertion SQL in your report**

```sql
SELECT c.relname, c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
       (SELECT count(*) FROM pg_indexes i
         WHERE i.schemaname='public' AND i.tablename=c.relname) AS indexes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname = 'callrail_calls';
-- Expect: 1 row, rls_on true, policies 0.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000154_callrail.sql
git commit -m "feat(callrail): calls table, scoped to the CallRail company

Calls get their own table rather than rows in leads: writing them there
would make the cross-source dedup implicit at write time, where it is
invisible and unfixable.

A call's practice follows from the key that fetched it — one API key per
CallRail company, one company per practice — so there is no tracking-number
map to drift. A company with no practice assigned is attributed to nothing
and shown as awaiting a decision."
```

---

### Task 2: The CallRail panel — UI first, against the contract

**Files:**
- Create: `frontend/features/integrations/components/CallRailPanel.tsx`
- Modify: `frontend/features/integrations/api.ts` (append the CallRail types and fetchers)
- Modify: `frontend/features/integrations/hooks.ts` (append the CallRail React Query hooks)
- Modify: `frontend/features/system/components/IntegrationsScreen.tsx`

**Do NOT create `callrail-api.ts` / `callrail-hooks.ts`.** Every provider in this directory — GoHighLevel, QuickBooks, Emergent, Google Sheets, Google Sheets Writer — shares the single `api.ts` and `hooks.ts`. A per-provider file here would be the only one of its kind.

**Interfaces:**
- Consumes endpoints from Tasks 3 and 4 (not yet built — you write against this contract, and Task 3 implements it):
  - `GET /api/integrations/callrail` → `{ connected: boolean, accounts: Array<{ id, label, callrailAccountId, practiceId, practiceName, status, lastSyncedAt, lastError, webhookUrl, callCount, lastCallAt }>, sourceBreakdown: Array<{ source, callCount }> }`
  - `POST /api/integrations/callrail/accounts` body `{ apiKey, callrailAccountId, label, practiceId }` → the created row (no key echoed back)
  - `PATCH /api/integrations/callrail/accounts/:id` body `{ practiceId?, label? }` → the updated row
  - `POST /api/integrations/callrail/accounts/:id/sync` → `{ ingested: number }`
  - `DELETE /api/integrations/callrail/accounts/:id` → `{ removed: true }`
  - `POST /api/integrations/callrail/sync` → `{ ingested: number }` (every company)
  - `DELETE /api/integrations/callrail` → `{ connected: false }` (disconnect the provider and all its companies)

**There is deliberately NO singleton `POST /api/integrations/callrail` key-paste route.** The first company added IS the connection — exactly as GoHighLevel multi-subaccount works here, where the single `integrations` row is only a lightweight "connected" marker and every credential lives on an `integration_accounts` row. A second key-holding path would be a second place for a credential to live.

- [ ] **Step 1: Read the conventions you must match — do not invent**

- `cat frontend/features/integrations/components/EmergentPanel.tsx` — the closest analogue: API key connect, webhook URL display, status. Match its structure.
- `cat frontend/features/integrations/components/EmergentPracticeMapping.tsx` — the mapping-table idiom.
- `cat frontend/tailwind.config.ts` — the real tokens (`ink`, `ink-muted`, `border`, `surface`, `bg`, `success`, `danger`, `warning`, `rounded-panel`). A previous plan invented `slate`/`emerald` classes that do not exist here and every one had to be corrected.
- `sed -n '1,30p' frontend/lib/api.ts` — the `api()` helper. **The path must begin `/api/...`**: the Next proxy forwards it verbatim and the backend mounts under `/api`, so omitting the prefix gives a SILENT 404 that renders as an empty state.

- [ ] **Step 2: Write the api client and hooks**

Types mirroring the contract above; fetchers via `api()`; React Query hooks matching the sibling integration hooks' key shape and `staleTime`. Mutations invalidate the status query so the panel reflects a connect or a mapping change without a reload.

**Send no organisation id.** The backend takes it from the session, where an agency switch has already resolved it to the sub-account.

- [ ] **Step 3: Write the panel**

Four states, each with its own copy — a generic empty panel would leave an owner unable to tell "not connected" from "connected but nothing arrived":

| State | What it shows |
|---|---|
| Not connected | The Add company form (API key + CallRail company id + label + practice), and what CallRail is for here |
| Connected, no calls yet | The webhook URL to paste into CallRail, and that the first pull runs nightly |
| Connected with calls | The company list, call counts per company, last call time, a Sync now control |
| Failed | The stored failure reason and a reconnect prompt |

**The company list is the substance of this panel.** One row per connected CallRail company: its label, the practice it is mapped to, how many calls it has produced, when the last one arrived, and its sync status — plus Add company (API key + CallRail company id + practice), Sync now, and Disconnect. Mirror `GoHighLevelPanel.tsx`, which is exactly this shape for GHL subaccounts; read it first.

A company connected but not yet mapped to a practice shows as **"No practice assigned — its calls are not attributed"**, so an unassigned company is visible rather than silently counting nowhere.

Also show, once calls exist, **what CallRail itself attributes them to**. The working assumption is that every tracked call came from the ad; this is where that assumption becomes checkable against real data rather than permanent and invisible.

Never render the API key, not even masked — the backend does not return it.

- [ ] **Step 4: Mount it and verify**

Add to `IntegrationsScreen.tsx` beside the other provider panels, matching how `EmergentPanel` is mounted.

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck and lint clean; build compiles. `npm run build` is KNOWN to exit 1 on `/(auth)/forgot-password` (no Supabase env at build time) — confirm that is the ONLY failing page.

The panel will show its not-connected state until Task 3 lands; that is expected and correct.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/integrations/components/CallRailPanel.tsx frontend/features/integrations/api.ts frontend/features/integrations/hooks.ts frontend/features/system/components/IntegrationsScreen.tsx
git commit -m "feat(callrail): integration panel listing the connected companies

Four states with distinct copy, because an owner must be able to tell 'not
connected' from 'connected but nothing has arrived'.

The company list is the substance: a company with no practice assigned reads
'No practice assigned — its calls are not attributed', so an unassigned
company is visible rather than silently counting nowhere."
```

---

### Task 3: Provider and connection routes

**Files:**
- Create: `backend/src/lib/integrations/callrail-provider.js`
- Modify: `backend/src/services/integration.service.js`
- Modify: `backend/src/controllers/integration.controller.js`
- Modify: `backend/src/routes/integrations.routes.js`
- Test: `backend/test/callrail-provider.test.mjs`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` (`lib/crypto.js`), `integrationRepository`.
- Produces: `callrailProvider.verify(apiKey, callrailAccountId)` — resolves the key against CallRail and returns the account's own name, or throws a message safe to show the owner. Task 4 calls this before persisting a key.
- Produces: `GET /api/integrations/callrail`, `POST /api/integrations/callrail/sync`, `DELETE /api/integrations/callrail`. **Not** a key-paste `POST /api/integrations/callrail` — see Task 2's contract for why.

- [ ] **Step 1: Write the failing tests**

Cover: `verify` accepts a good key and returns the account name; `verify` rejects a 401 with a message that does NOT contain the key; the status read for an org with no connection returns `connected: false` rather than throwing; the org id comes from the session; and a second org's connection is untouched by the first's disconnect.

Read `backend/test/` for an existing provider test to match — the GoHighLevel and Emergent ones are the closest.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/callrail-provider.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Mirror `gohighlevel-provider.js`'s key-paste path. **Verify the key before persisting** by calling CallRail's own account endpoint — `GET https://api.callrail.com/v3/a/{accountId}.json` with `Authorization: Token token="<key>"`. A key that cannot read its own account is rejected now, with a clear message, rather than stored and failing every night.

Add `'callrail'` to `WEBHOOK_PROVIDERS` in `integration.service.js` so the generic webhook-secret route serves it.

Routes, matching Emergent's shape:
```javascript
router.get('/callrail',       requireRole('owner', 'practice_manager'), asyncHandler(integrationController.callrailGet));
router.post('/callrail/sync', requireRole('owner'), asyncHandler(integrationController.callrailSync));
router.delete('/callrail',    requireRole('owner'), asyncHandler(integrationController.callrailDisconnect));
```

**These are STATIC paths and must be registered BEFORE the generic `/:provider` routes** in `integrations.routes.js`, or `/callrail` is swallowed by the generic handler. Read where the GoHighLevel and Google Sheets static routes sit and put these beside them.

- [ ] **Step 4: Run tests, then the full suite**

Run: `cd backend && npx vitest run test/callrail-provider.test.mjs && npm test && npm run lint`
Report the totals.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/callrail-provider.js backend/src/services/integration.service.js backend/src/controllers/integration.controller.js backend/src/routes/integrations.routes.js backend/test/callrail-provider.test.mjs
git commit -m "feat(callrail): provider verification and the status routes

A key is verified against CallRail's own account endpoint before it is ever
stored, so a bad key is rejected at connect time with a clear message rather
than stored and failing silently every night. The failure message never
contains the key.

There is no key-paste route on the provider itself: every credential lives on
an integration_accounts row, one per CallRail company, so there is exactly one
place a key can be."
```

---

### Task 4: CallRail companies — repository, service, routes

**Files:**
- Create: `backend/src/repositories/callrail.repository.js`
- Create: `backend/src/services/callrail.service.js`
- Modify: `backend/src/controllers/integration.controller.js`
- Modify: `backend/src/routes/integrations.routes.js`
- Test: `backend/test/callrail.accounts.test.mjs`

**Interfaces:**
- Produces:
  - `callrailRepository.upsertCalls(orgId, rows)` — idempotent on `(organisation_id, callrail_id)`
  - `callrailRepository.accountsWithCounts(orgId)` — every connected CallRail company, its practice, call count, last call, status
  - `callrailRepository.sourceBreakdown(orgId)` — what CallRail itself attributes calls to, so the "every call is an ad call" assumption is checkable
  - `callrailService.status(orgId)` — the payload Task 2's panel consumes
  - `callrailService.addAccount(orgId, { apiKey, callrailAccountId, label, practiceId })` — calls Task 3's `verify` FIRST, then encrypts the key, creates the provider marker row if absent, and inserts the `integration_accounts` row with a fresh random `webhook_token`
  - `callrailService.updateAccount(orgId, id, { practiceId, label })` — restamps `callrail_calls.practice_id` for that account when the practice changes
  - `POST /api/integrations/callrail/accounts`, `PATCH /api/integrations/callrail/accounts/:id`, `DELETE /api/integrations/callrail/accounts/:id`, `POST /api/integrations/callrail/accounts/:id/sync`

- [ ] **Step 1: Write the failing tests**

The tests that matter here:
- **A company connected but not yet mapped to a practice is listed, with a null practice** — the owner must see it is unassigned rather than have its calls silently attributed nowhere.
- **Changing a company's practice restamps its existing calls**, so a correction takes effect on history rather than only on calls arriving afterwards. (`practice_id` is denormalised onto `callrail_calls`, so this is a real update, not a join.)
- **Cross-org isolation:** one org's companies and calls never appear in another's list. Assert `organisation_id` on every call.
- `upsertCalls` is idempotent: the same call twice yields one row.
- **The source breakdown reports what CallRail says**, so if a company's calls are not all ad calls the owner can see it rather than discovering it in a wrong CPL.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/callrail.accounts.test.mjs`

- [ ] **Step 3: Implement**

Repository is "queries in, rows out". `accountsWithCounts` aggregates in SQL, not in JS — a tenant with many calls must not have them paged into memory to be counted. Page any read that can exceed 1000 rows, stopping on an EMPTY page.

- [ ] **Step 4: Run tests and the full suite; commit**

```bash
git add backend/src/repositories/callrail.repository.js backend/src/services/callrail.service.js backend/src/controllers/integration.controller.js backend/src/routes/integrations.routes.js backend/test/callrail.accounts.test.mjs
git commit -m "feat(callrail): companies, counts and status

One CallRail company per practice, each with its own key: a call's practice
follows from the key that fetched it, so there is no mapping step to drift.

A company with no practice assigned is listed with a null practice rather
than hidden, and reassigning one restamps its existing calls, so a
correction takes effect on history and not only on what arrives next."
```

---

### Task 5: Webhook ingestion

**Files:**
- Modify: `backend/src/app.js` (raw-body mount)
- Modify: `backend/src/routes/webhooks.routes.js`
- Modify: `backend/src/controllers/webhook.controller.js`
- Create: `backend/src/lib/integrations/callrail-webhook.js`
- Test: `backend/test/callrail-webhook.test.mjs`

**Interfaces:**
- Produces: `POST /webhooks/callrail/:token`, and `parseCallPayload(body)` mapping CallRail's shape to a `callrail_calls` row.

- [ ] **Step 1: Establish how CallRail authenticates its webhooks — do not assume**

Check CallRail's current documentation for whether the Post-Call webhook is signed, and how. Report what you find.

**The per-organisation random token in the URL path is the primary authentication either way** — the same pattern GoHighLevel's per-account `webhook_token` uses here (`getByWebhookToken`). If CallRail also supplies a signature, verify it as a second factor using the raw body, matching the Dentally and Emergent HMAC pattern. If it does not, say so plainly in your report and in a code comment, so nobody later assumes a signature is being checked when it is not.

- [ ] **Step 2: Write the failing tests**

- An unknown token is rejected — and the response must not reveal whether the token merely mismatched or the org has no CallRail connection.
- The org is resolved from the TOKEN, never from anything in the payload. A payload claiming another `organisation_id` changes nothing.
- The same call delivered twice produces one row. **Assert this through the real upsert, on the real conflict target `(organisation_id, callrail_id)`** — a unique constraint only delivers idempotency if the write actually upserts on it. This codebase has been burned by an identity key that looked sound on paper (`treatment_accepted`'s hash of mutable fields, corrected in `000149`); `callrail_id` is CallRail's own opaque id rather than a synthesised hash, so the risk is far lower, but "far lower" is not "tested".
- A payload missing its call id or start time is rejected rather than stored half-formed.
- `caller_phone10` and `caller_email_norm` are populated with the SHARED normalisers.

- [ ] **Step 3: Run to verify they fail, then implement**

Mount the raw body in `app.js` beside its siblings:
```javascript
    // CallRail webhook needs the raw body for signature verification.
    app.use('/webhooks/callrail', express_1.default.raw({ type: '*/*', limit: '1mb' }));
```
Route: `router.post('/callrail/:token', asyncHandler(webhookController.callrail));`

Ingest through `callrailRepository.upsertCalls`, so the webhook and the pull share one write path and one idempotency key.

- [ ] **Step 4: Run tests and the full suite; commit**

```bash
git add backend/src/app.js backend/src/routes/webhooks.routes.js backend/src/controllers/webhook.controller.js backend/src/lib/integrations/callrail-webhook.js backend/test/callrail-webhook.test.mjs
git commit -m "feat(callrail): webhook ingestion, authenticated by path token

The organisation is resolved from the token, never from the payload — a
payload naming another organisation changes nothing.

Webhook and pull share one write path and one idempotency key, so the same
call arriving twice produces one row."
```

---

### Task 6: Scheduled pull, for backfill and the gaps a webhook leaves

**Files:**
- Create: `backend/src/lib/integrations/callrail-sync.js`
- Modify: `backend/src/workers/index.js`
- Test: `backend/test/callrail-sync.test.mjs`

**Interfaces:**
- Produces: `syncAccount(orgId, account, onProgress, opts)` and `syncAllOrgs()`. **Per-ACCOUNT, not per-org** — credentials live on `integration_accounts`, one row per CallRail company, so there is no org-level key to sync with. Read `gohighlevel-sync.js`'s `syncAccount`/`syncAllOrgs` pair: `syncAllOrgs` fans out over every active account of every org. That connector's own lesson applies here: select accounts by `status IN ('active','failed')`, never `status = 'active'` alone, or one transient error freezes a company forever.

- [ ] **Step 1: Write the failing tests**

- The pull pages CallRail's API and stops correctly — assert the number of requests, not just the row total.
- A call already ingested by webhook is not duplicated — same assertion as Task 5, through the same `(organisation_id, callrail_id)` conflict target, proving both paths share one identity.
- One account failing does not stop the others, and a `failed` account is retried on the next run rather than frozen out.
- Cross-org isolation: a call is written only to the org whose key fetched it, with that account's `practice_id`.

- [ ] **Step 2: Implement**

`GET https://api.callrail.com/v3/a/{callrailAccountId}/calls.json` with `Authorization: Token token="<decrypted key>"`, paged, over a trailing window on the nightly run and a longer one on a manual reconnect — read `google-ads-sync.js` for the window idiom and follow it. Every row written carries the ACCOUNT's `organisation_id` and `practice_id`; never a value from the API response.

**A webhook delivers once.** Anything arriving during a deploy or an outage is gone, and no webhook can reach calls from before connection. That is why this exists; say so in the header comment.

Register the nightly job in `workers/index.js` beside the other sync jobs.

- [ ] **Step 3: Run tests and the full suite; commit**

```bash
git add backend/src/lib/integrations/callrail-sync.js backend/src/workers/index.js backend/test/callrail-sync.test.mjs
git commit -m "feat(callrail): scheduled pull for backfill and webhook gaps

A webhook delivers once: anything arriving during a deploy is gone, and no
webhook reaches calls from before connection. The pull closes both, sharing
the webhook's write path and idempotency key."
```

---

### Task 7: Gates, docs, state log

**Files:**
- Modify: `db/01_schema.sql`
- Modify: `db/02_rls.sql`
- Modify: `docs/API.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Sync the unmanaged schema mirrors**

CLAUDE.md's rule is unconditional: `db/01_schema.sql` and `db/02_rls.sql` are source copies that are NOT what `supabase db reset` reads, and they must be kept in sync when the schema changes. Task 1 added a table and nothing has updated them.

Add `callrail_calls` to `db/01_schema.sql` and its `ENABLE ROW LEVEL SECURITY` to `db/02_rls.sql`, matching the surrounding formatting exactly — read how a comparable recent table (`ghl_appointments`, `integration_accounts`) appears in each file and follow it. Copy the column list verbatim from `supabase/migrations/20260101000154_callrail.sql`, including the `ON DELETE SET NULL` on `integration_account_id`.

**This blocks merge.** A drifted mirror is worse than an absent one: the next person to read it will believe it.

- [ ] **Step 2: Run every gate and report each verbatim**

```
cd backend  && npm test
cd backend  && npm run lint
cd backend  && npm run typecheck
cd frontend && npm run typecheck
cd frontend && npm run lint
cd frontend && npm run build
ggshield secret scan commit-range origin/main..HEAD
```
`npm run build` exits 1 on `/(auth)/forgot-password` only. Confirm no OTHER page fails.

- [ ] **Step 3: Document the endpoints in `docs/API.md`**

Every route in Task 2's contract plus the webhook, including: the organisation is taken from the session and never accepted as a parameter; the API key is never returned by any read; a company with no practice assigned attributes its calls to nothing.

- [ ] **Step 4: Add ONE bullet to `CLAUDE.md`'s "Current state" section**

Read two neighbouring bullets and match their density. Record: the ONE new table `callrail_calls` and its reuse of `integration_accounts` for credentials; migration `20260101000154` and its applied-status stated ACCURATELY (the controller applies it after this task, so NOT applied as you write); that calls are stored separately from `leads` and why; that a call's practice comes from the key that fetched it, with no tracking-number map, and that an unassigned company attributes to nothing; both ingestion paths and the shared idempotency key; that the webhook resolves its org from the path token, never the payload; and whether CallRail signs its webhooks (from Task 5's finding).

- [ ] **Step 5: Commit**

```bash
git add db/01_schema.sql db/02_rls.sql docs/API.md CLAUDE.md
git commit -m "docs(callrail): sync the schema mirrors, document the endpoints"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `callrail_calls`, separate from `leads` | 1 |
| One key per company, practice from the key that fetched the call | 1, 3, 4 |
| Panel with four states and the company list | 2 |
| API key connect, encrypted, verified before storing | 3 |
| Webhook ingestion, org from token | 5 |
| Scheduled pull for backfill and gaps | 6 |
| Idempotent on CallRail's call id | 1 (unique key), 5, 6 |
| Shared normalisers, no second implementation | 5 (Global Constraints) |
| Cross-org isolation | 3, 4, 5, 6 |
| Migration applied on hosted | 7 (handed to controller) |

**Gap found and closed:** the spec's dedup rule (one person, one lead across CallRail and GoHighLevel) and the existing-patient separation are NOT in this plan — they belong to the read path, which the spec scopes to Phase A. This plan's job is to land the calls with the right normalised keys so that dedup is possible; `caller_phone10` and `caller_email_norm` exist for exactly that, and Task 5 tests them. Stated here so the omission is deliberate rather than forgotten.

**Placeholder scan:** no TBD/TODO. Tasks 2 and 5 deliberately specify behaviour plus instructions to read the real tokens and check CallRail's live documentation, rather than inventing class names or asserting a signature scheme I have not verified.

**Type consistency:** `upsertCalls(orgId, rows)` is called from Tasks 5 and 6 with that signature. The status payload in Task 2's contract matches what Task 4's `callrailService.status` produces. Route paths are identical between Task 2's client and Tasks 3 and 4's routes.
