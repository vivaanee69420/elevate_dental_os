# CallRail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect CallRail per organisation with an API key, ingest every call by webhook and by scheduled pull, and let the owner map each tracking number to an ad channel — so Google Ads phone calls become countable leads.

**Architecture:** Mirrors the Emergent integration, which is the closest existing analogue: a pasted API key encrypted into `integrations.secrets`, a raw-body webhook authenticated by a per-organisation random token in the URL, a scheduled pull for backfill and gaps, and an owner-controlled mapping table. Calls land in their own table; nothing is written into `leads`.

**Tech Stack:** Postgres/Supabase, native-ESM Node backend, vitest, Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-03-callrail-and-google-lead-conversions-design.md`

**Scope:** THIS plan is the integration only — connect, ingest, map. The lead-conversion surface that consumes it (cards, CPL/CPB/CPA, click-through to people) is Phase A of the spec and gets its own plan. The two meet at `callrail_calls`.

## Global Constraints

- **MULTI-TENANT — the org id comes ONLY from `req.user.organisation_id`.** Never a query parameter, never a body field. Under an agency switch that value is already the sub-account's. The webhook is the one exception and resolves its org from its own path token — never from anything in the payload.
- **A call is only ever matched or mapped within its own organisation.** `serviceClient` bypasses RLS, so the explicit `organisation_id` filter IS the tenant boundary.
- **Credentials are encrypted** via `encryptSecret` / `decryptSecret` from `backend/src/lib/crypto.js`, exactly as every other provider does. An API key must never be returned by any read endpoint, logged, or included in an error message.
- **Ingestion is idempotent on CallRail's own call id.** A webhook and a pull describing the same call produce ONE row. Re-running a pull changes nothing.
- **Every call is stored; classification happens at read time.** A tracking number with no mapping row is UNMAPPED and counts toward nothing — shown in the panel as awaiting a decision, never silently folded into a channel.
- **Reuse `normaliseEmail` / `normalisePhone`** from `backend/src/lib/sheet-export/normalise.js`. Do NOT write a second normaliser: two normalisation rules would silently disagree about who is the same person, which is the one thing the dedup rule cannot survive.
- **Paged reads:** order on a unique key, `.range()`, and STOP ON AN EMPTY PAGE, NEVER A SHORT ONE. PostgREST caps responses at 1000 rows silently and that applies to set-returning RPCs identically.
- **Mandatory grant idiom on every RPC:** `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ... TO service_role;` — a newly created function in `public` IS anon-executable by default on this project.
- **RPCs are `LANGUAGE plpgsql` with `RETURN QUERY EXECUTE ... USING`**, `SECURITY DEFINER`, `SET search_path = public`.
- Routes live under `/api/integrations/callrail/*` and are `requireRole('owner')`, except the read-only status which also allows `practice_manager` — matching how Emergent does it.
- **NO DARK MODE** (rule 1). **BRITISH ENGLISH** in all UI copy (rule 4). **No emojis** (rule 7).
- Native ESM: `import`/`export`, `.js` extensions on relative imports, never `require`/`module.exports`.
- **Migration number:** `20260101000150_callrail.sql`. Do not renumber.
- **Verification:** Docker and the `supabase` CLI are NOT installed. Do not attempt `supabase start` or `db reset`. The controller verifies SQL against the hosted database inside `BEGIN … ROLLBACK`.

---

### Task 1: Migration — `callrail_calls` and `callrail_number_map`

**Files:**
- Create: `supabase/migrations/20260101000150_callrail.sql`

**Interfaces:**
- Produces tables `callrail_calls` and `callrail_number_map`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- CallRail — tracked phone calls, and the owner's map from tracking number to
-- ad channel.
--
-- WHY CALLS ARE NOT ROWS IN `leads`: writing them there would reuse more
-- machinery, but it puts rows with no pipeline, no opportunity and no GHL id
-- into a GoHighLevel-shaped table, and it makes the cross-source dedup
-- implicit at write time — where it is invisible and unfixable. A separate
-- table keeps the sources distinct and makes dedup an explicit, testable step
-- at read time.
--
-- WHY EVERY CALL IS STORED: whether a call is a Google Ads lead depends on
-- which tracking number it came in on, and that is the owner's knowledge, not
-- ours. Storing everything and classifying at read time is correct whether the
-- account uses a Google-specific number or one pool for the whole practice.
--
-- MULTI-TENANT: every row carries organisation_id; serviceClient bypasses RLS
-- so that filter IS the isolation. RLS on with no policy: anon and
-- authenticated get nothing, service_role bypasses.
-- Idempotent + additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.callrail_calls (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id       uuid REFERENCES practices(id) ON DELETE SET NULL,
  -- CallRail's own id. The idempotency key: a webhook and a pull describing
  -- the same call must produce one row, not two.
  callrail_id       text NOT NULL,
  tracking_number   text,          -- the number DIALLED; what classification keys on
  caller_number     text,          -- the number that CALLED
  caller_phone10    text,          -- normalised, for matching and dedup
  caller_name       text,
  caller_email      text,
  caller_email_norm text,
  started_at        timestamptz NOT NULL,
  duration_seconds  integer,
  answered          boolean,
  first_call        boolean,       -- CallRail's own "first time this number called"
  gclid             text,
  keywords          text,
  campaign          text,
  source            text,          -- CallRail's own source attribution
  raw               jsonb,         -- the payload as received, for forensics
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (organisation_id, callrail_id)
);

CREATE TRIGGER callrail_calls_updated_at BEFORE UPDATE ON public.callrail_calls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE public.callrail_calls ENABLE ROW LEVEL SECURITY;

-- The funnel reads a window of one org's calls; the matcher probes by phone.
CREATE INDEX IF NOT EXISTS idx_callrail_calls_org_started
  ON public.callrail_calls (organisation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_callrail_calls_org_phone
  ON public.callrail_calls (organisation_id, caller_phone10)
  WHERE caller_phone10 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_callrail_calls_org_number
  ON public.callrail_calls (organisation_id, tracking_number);

-- ---------------------------------------------------------------------------
-- The owner's classification. A number with NO row here is unmapped and counts
-- toward nothing — the panel shows it as awaiting a decision. Mirrors
-- ad_channel_pipelines and emergent_practice_map: an unmapped source is stated,
-- never guessed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.callrail_number_map (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  tracking_number text NOT NULL,
  channel         text,           -- 'google_ads' | 'meta_ads' | other; NULL = deliberately unmapped
  practice_id     uuid REFERENCES practices(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (organisation_id, tracking_number)
);

CREATE TRIGGER callrail_number_map_updated_at BEFORE UPDATE ON public.callrail_number_map
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE public.callrail_number_map ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Static self-checks — report each**

You cannot run SQL here. Confirm and report:
- `set_updated_at()` exists: `grep -rn "FUNCTION set_updated_at" supabase/migrations | head -3`
- `uuid_generate_v4()` is in use by existing migrations: `grep -rln "uuid_generate_v4" supabase/migrations | head -3`
- `organisations(id)` and `practices(id)` are the FK targets other tables use: `grep -rn "REFERENCES organisations(id)" supabase/migrations | head -3`
- `20260101000150_callrail.sql` does not already exist and 000150 is free.

- [ ] **Step 3: Put the controller's assertion SQL in your report**

```sql
SELECT c.relname, c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
       (SELECT count(*) FROM pg_indexes i
         WHERE i.schemaname='public' AND i.tablename=c.relname) AS indexes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('callrail_calls','callrail_number_map')
 ORDER BY 1;
-- Expect: 2 rows, rls_on true, policies 0 on both.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000150_callrail.sql
git commit -m "feat(callrail): calls table and the owner's tracking-number map

Calls get their own table rather than rows in leads: writing them there
would make the cross-source dedup implicit at write time, where it is
invisible and unfixable.

Every call is stored and classified at read time against an owner-controlled
map, because whether a call is a Google Ads lead depends on which tracking
number it came in on — the owner's knowledge, not ours. An unmapped number
counts toward nothing and is shown as awaiting a decision."
```

---

### Task 2: The CallRail panel — UI first, against the contract

**Files:**
- Create: `frontend/features/integrations/components/CallRailPanel.tsx`
- Create: `frontend/features/integrations/callrail-api.ts`
- Create: `frontend/features/integrations/callrail-hooks.ts`
- Modify: `frontend/features/system/components/IntegrationsScreen.tsx`

**Interfaces:**
- Consumes endpoints from Tasks 3 and 4 (not yet built — you write against this contract, and Task 3 implements it):
  - `GET /api/integrations/callrail` → `{ connected: boolean, status: string | null, lastSyncedAt: string | null, webhookUrl: string | null, numbers: Array<{ trackingNumber, channel, practiceId, callCount, lastCallAt }> }`
  - `POST /api/integrations/callrail` body `{ apiKey, accountId }` → `{ connected: true }`
  - `POST /api/integrations/callrail/sync` → `{ ingested: number }`
  - `PATCH /api/integrations/callrail/numbers/:trackingNumber` body `{ channel, practiceId }` → the updated row
  - `DELETE /api/integrations/callrail` → `{ connected: false }`

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
| Not connected | The API key + account id form, and what CallRail is for here |
| Connected, no calls yet | The webhook URL to paste into CallRail, and that the first pull runs nightly |
| Connected with calls | The number map, call counts per number, last call time, a Sync now control |
| Failed | The stored failure reason and a reconnect prompt |

**The number map is the substance of this panel.** One row per tracking number CallRail has sent, with the number, how many calls it has produced, when the last one arrived, and a channel selector (Google Ads / Meta Ads / Not an ad channel). A number with no mapping shows as **"Not yet mapped — its calls count toward nothing"**, so a gap is visible rather than silent.

Never render the API key, not even masked — the backend does not return it.

- [ ] **Step 4: Mount it and verify**

Add to `IntegrationsScreen.tsx` beside the other provider panels, matching how `EmergentPanel` is mounted.

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck and lint clean; build compiles. `npm run build` is KNOWN to exit 1 on `/(auth)/forgot-password` (no Supabase env at build time) — confirm that is the ONLY failing page.

The panel will show its not-connected state until Task 3 lands; that is expected and correct.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/integrations/components/CallRailPanel.tsx frontend/features/integrations/callrail-api.ts frontend/features/integrations/callrail-hooks.ts frontend/features/system/components/IntegrationsScreen.tsx
git commit -m "feat(callrail): integration panel with the tracking-number map

Four states with distinct copy, because an owner must be able to tell 'not
connected' from 'connected but nothing has arrived'.

The number map is the substance: a number with no mapping reads 'Not yet
mapped — its calls count toward nothing', so a gap in classification is
visible rather than silently folded into a channel."
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
- Produces: `CallRailProvider` with `callback({ apiKey, accountId })` and `verify(apiKey, accountId)`; the four connection endpoints from Task 2's contract.

- [ ] **Step 1: Write the failing tests**

Cover: a pasted key is encrypted before storage and never returned by the status read; an invalid key is rejected at connect time rather than stored and failing silently every night afterwards; the org id comes from the session; and a second org's connection is untouched by the first's.

Read `backend/test/` for an existing provider test to match — the GoHighLevel and Emergent ones are the closest.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/callrail-provider.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Mirror `gohighlevel-provider.js`'s key-paste path. **Verify the key before persisting** by calling CallRail's own account endpoint — `GET https://api.callrail.com/v3/a/{accountId}.json` with `Authorization: Token token="<key>"`. A key that cannot read its own account is rejected now, with a clear message, rather than stored and failing every night.

Add `'callrail'` to `WEBHOOK_PROVIDERS` in `integration.service.js` so the generic webhook-secret route serves it.

Routes, matching Emergent's shape:
```javascript
router.get('/callrail',    requireRole('owner', 'practice_manager'), asyncHandler(integrationController.callrailGet));
router.post('/callrail',   requireRole('owner'), asyncHandler(integrationController.callrailConnect));
router.post('/callrail/sync', requireRole('owner'), asyncHandler(integrationController.callrailSync));
router.delete('/callrail', requireRole('owner'), asyncHandler(integrationController.callrailDisconnect));
```

- [ ] **Step 4: Run tests, then the full suite**

Run: `cd backend && npx vitest run test/callrail-provider.test.mjs && npm test && npm run lint`
Report the totals.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/callrail-provider.js backend/src/services/integration.service.js backend/src/controllers/integration.controller.js backend/src/routes/integrations.routes.js backend/test/callrail-provider.test.mjs
git commit -m "feat(callrail): provider and connection routes

The key is verified against CallRail's own account endpoint before it is
stored, so a bad key is rejected at connect time with a clear message rather
than stored and failing silently every night.

It is encrypted at rest and never returned by any read endpoint."
```

---

### Task 4: The number map — repository, service, routes

**Files:**
- Create: `backend/src/repositories/callrail.repository.js`
- Create: `backend/src/services/callrail.service.js`
- Modify: `backend/src/controllers/integration.controller.js`
- Modify: `backend/src/routes/integrations.routes.js`
- Test: `backend/test/callrail.number-map.test.mjs`

**Interfaces:**
- Produces:
  - `callrailRepository.upsertCalls(orgId, rows)` — idempotent on `(organisation_id, callrail_id)`
  - `callrailRepository.numbersWithCounts(orgId)` — every tracking number seen, its call count, last call, and its mapping if any
  - `callrailRepository.upsertNumberMap(orgId, trackingNumber, { channel, practiceId })`
  - `callrailService.status(orgId)` — the payload Task 2's panel consumes
  - `PATCH /api/integrations/callrail/numbers/:trackingNumber`

- [ ] **Step 1: Write the failing tests**

The tests that matter here:
- **A number seen in calls but never mapped appears in the list, with a null channel.** That is the whole point of showing gaps.
- **Mapping a number does not alter any stored call** — classification is a read-time decision, so a remap changes the numbers immediately with no re-ingestion.
- **Cross-org isolation:** one org's numbers and mappings never appear in another's list. Assert `organisation_id` on every call.
- `upsertCalls` is idempotent: the same call twice yields one row.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/callrail.number-map.test.mjs`

- [ ] **Step 3: Implement**

Repository is "queries in, rows out". `numbersWithCounts` aggregates in SQL, not in JS — a tenant with many calls must not have them paged into memory to be counted. Page any read that can exceed 1000 rows, stopping on an EMPTY page.

- [ ] **Step 4: Run tests and the full suite; commit**

```bash
git add backend/src/repositories/callrail.repository.js backend/src/services/callrail.service.js backend/src/controllers/integration.controller.js backend/src/routes/integrations.routes.js backend/test/callrail.number-map.test.mjs
git commit -m "feat(callrail): tracking-number map, counts and status

A number seen in calls but never mapped appears in the list with a null
channel, so a classification gap is visible. Mapping is a read-time
decision and alters no stored call, so a remap takes effect immediately
with no re-ingestion."
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
- The same call delivered twice produces one row.
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
- Produces: `syncOneOrg(orgId, integration, onProgress, opts)` and `syncAllOrgs()`, matching the shape every other connector here uses.

- [ ] **Step 1: Write the failing tests**

- The pull pages CallRail's API and stops correctly — assert the number of requests, not just the row total.
- A call already ingested by webhook is not duplicated.
- One org failing does not stop the others.
- Cross-org isolation: a call is written only to the org whose key fetched it.

- [ ] **Step 2: Implement**

`GET https://api.callrail.com/v3/a/{accountId}/calls.json` with `Authorization: Token token="<key>"`, paged, over a trailing window on the nightly run and a longer one on a manual reconnect — read `google-ads-sync.js` for the window idiom and follow it.

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
- Modify: `docs/API.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run every gate and report each verbatim**

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

- [ ] **Step 2: Document the endpoints in `docs/API.md`**

All five connection/mapping routes plus the webhook, including: the organisation is taken from the session and never accepted as a parameter; the API key is never returned; an unmapped tracking number counts toward nothing.

- [ ] **Step 3: Add ONE bullet to `CLAUDE.md`'s "Current state" section**

Read two neighbouring bullets and match their density. Record: the two tables; migration `20260101000150` and its applied-status stated ACCURATELY (the controller applies it after this task, so NOT applied as you write); that calls are stored separately from `leads` and why; that classification is an owner-controlled tracking-number map with unmapped numbers counting toward nothing; both ingestion paths and the shared idempotency key; that the webhook resolves its org from the path token, never the payload; and whether CallRail signs its webhooks (from Task 5's finding).

- [ ] **Step 4: Commit**

```bash
git add docs/API.md CLAUDE.md
git commit -m "docs(callrail): document the endpoints and record the integration"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `callrail_calls`, separate from `leads` | 1 |
| `callrail_number_map`, unmapped counts toward nothing | 1, 4 |
| Panel with four states and the number map | 2 |
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
