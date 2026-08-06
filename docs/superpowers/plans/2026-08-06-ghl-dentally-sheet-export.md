# GHL → Dentally Conversion Export to Google Sheets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a patient gets their first-ever Dentally appointment, match them against GHL contacts with pipeline leads and append one conversion row (name, email, phone, pipeline name, appointment date, lead incoming date) to an owner-connected, write-scoped Google Sheet — one tab per practice.

**Architecture:** Outbox queue (`sheet_export_queue`, migration `000121`) filled by an enqueue RPC (single SQL source of truth for "first appointment post-connect"), drained by a service that matches (email OR phone, normalised, exact) and appends via a new `google_sheets_writer` OAuth connection (full `spreadsheets` scope — completely separate from the read-only Call Reporting connection). Real-time via a debounced fire-and-forget kick from the Dentally webhook; a 15-minute worker sweep is the reconciliation backstop.

**Tech Stack:** Express (native ESM, `.js` extensions on relative imports), Supabase (serviceClient + manual `organisation_id` filters — house convention), Google Sheets API v4, vitest, Next.js 14 frontend panel.

**Spec:** `docs/superpowers/specs/2026-08-06-ghl-dentally-sheet-export-design.md` — read it first; it is authoritative on semantics.

## Global Constraints

- Backend is **native ESM**: `import`/`export`, relative imports carry `.js`. Never `require`/`module.exports`.
- Every repository query MUST chain `.eq('organisation_id', orgId)` (or pass `p_org` to an RPC) — there is no automatic tenant isolation on the serviceClient path.
- Secrets: AES-GCM via `lib/crypto.js`; never in logs, errors, or API responses.
- British English in all UI copy ("organisation", "practice"). No emojis. No dark mode.
- Dates in the sheet: `dd/mm/yyyy`, Europe/London.
- Reception role must never see any of this (routes gated `requireRole('owner')` or `requireRole('owner','practice_manager')`).
- All migrations idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS` before `CREATE POLICY`).
- After hosted DDL: `NOTIFY pgrst, 'reload schema';`.
- Run backend tests with `cd backend && npx vitest run test/<file>` ; full suite `npm test` must stay green.
- Commit after every task (small conventional-commit messages).

---

### Task 1: Migration `000121` — queue table + RPCs

**Files:**
- Create: `supabase/migrations/20260101000121_sheet_export_queue.sql`
- Modify: `db/01_schema.sql` (append the same table — keep unmanaged copies in sync per CLAUDE.md)

**Interfaces:**
- Produces: table `sheet_export_queue`; RPCs `sheet_export_enqueue(p_org uuid, p_since timestamptz) → int`, `sheet_export_claim(p_org uuid, p_limit int, p_include_no_match boolean) → setof sheet_export_queue`, `sheet_export_phone_candidates(p_org uuid, p_digits text) → contacts subset`. Later tasks call these via `serviceClient.rpc(...)`.

- [ ] **Step 1: Write the migration**

```sql
-- Sheet export queue: one row per Dentally patient whose FIRST appointment
-- was created after the google_sheets_writer connection was set up. Outbox
-- for the GHL→Dentally conversion export. Spec:
-- docs/superpowers/specs/2026-08-06-ghl-dentally-sheet-export-design.md

CREATE TABLE IF NOT EXISTS sheet_export_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  appointment_starts_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','exported','no_match','failed')),
  matched_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  matched_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sheet_export_queue_org_contact
  ON sheet_export_queue(organisation_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_sheet_export_queue_org_status
  ON sheet_export_queue(organisation_id, status);
-- Supports the enqueue RPC's first-appointment scan.
CREATE INDEX IF NOT EXISTS idx_appointments_org_contact_created
  ON appointments(organisation_id, contact_id, created_at);

ALTER TABLE sheet_export_queue ENABLE ROW LEVEL SECURITY;
-- Worker/webhook-only table: RLS enabled with NO tenant policy — identical to
-- sheet_sources/sheet_leads (000118). The anon/tenant path is fully blocked;
-- the app path is serviceClient + explicit .eq('organisation_id', orgId)
-- (rule 3), and the RPCs below are SECURITY DEFINER taking p_org.

-- Enqueue: patients whose FIRST-ever non-cancelled Dentally appointment was
-- created at/after p_since. Patients with ANY appointment created before
-- p_since never enqueue (go-forward-only). Idempotent via ON CONFLICT.
CREATE OR REPLACE FUNCTION sheet_export_enqueue(p_org UUID, p_since TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH firsts AS (
    SELECT DISTINCT ON (a.contact_id)
           a.contact_id, a.id AS appointment_id, a.practice_id, a.starts_at
    FROM appointments a
    WHERE a.organisation_id = p_org
      AND a.contact_id IS NOT NULL
      AND a.status <> 'cancelled'
      AND a.created_at >= p_since
    ORDER BY a.contact_id, a.starts_at ASC
  ), ins AS (
    INSERT INTO sheet_export_queue
      (organisation_id, practice_id, contact_id, appointment_id, appointment_starts_at)
    SELECT p_org, f.practice_id, f.contact_id, f.appointment_id, f.starts_at
    FROM firsts f
    JOIN contacts c ON c.id = f.contact_id AND c.organisation_id = p_org
    WHERE c.pms_external_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM appointments prior
        WHERE prior.organisation_id = p_org
          AND prior.contact_id = f.contact_id
          AND prior.status <> 'cancelled'
          AND prior.created_at < p_since)
    ON CONFLICT (organisation_id, contact_id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::int FROM ins;
$$;

-- Atomic claim: pending (respecting exponential backoff), stale processing
-- (crashed drainer >10 min), and optionally young no_match rows. SKIP LOCKED
-- keeps concurrent drains (webhook kick vs cron sweep) on disjoint sets.
CREATE OR REPLACE FUNCTION sheet_export_claim(
  p_org UUID, p_limit INT DEFAULT 50, p_include_no_match BOOLEAN DEFAULT FALSE)
RETURNS SETOF sheet_export_queue
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE sheet_export_queue q
  SET status = 'processing', claimed_at = NOW(), updated_at = NOW()
  WHERE q.id IN (
    SELECT id FROM sheet_export_queue
    WHERE organisation_id = p_org
      AND attempts < 10
      AND (
        (status = 'pending' AND (attempts = 0 OR
          updated_at < NOW() - make_interval(mins =>
            LEAST(POWER(2, LEAST(attempts, 10)), 1440)::int)))
        OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '10 minutes')
        OR (p_include_no_match AND status = 'no_match'
            AND created_at > NOW() - INTERVAL '30 days'))
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED)
  RETURNING q.*;
$$;

-- Phone-candidate lookup: GHL contacts whose digits-only phone ends with
-- p_digits (last 9 significant digits). SQL-side because stored phone
-- formatting varies ("07123 456789" vs "+447123456789").
CREATE OR REPLACE FUNCTION sheet_export_phone_candidates(p_org UUID, p_digits TEXT)
RETURNS TABLE (id UUID, first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
               ghl_contact_id TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
         c.ghl_contact_id, c.created_at
  FROM contacts c
  WHERE c.organisation_id = p_org
    AND c.ghl_contact_id IS NOT NULL
    AND length(p_digits) >= 9
    AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE '%' || p_digits;
$$;

GRANT EXECUTE ON FUNCTION sheet_export_enqueue(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION sheet_export_claim(UUID, INT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION sheet_export_phone_candidates(UUID, TEXT) TO service_role;
```

Check the exact function-grant idiom against 000118/000119 (`grant execute … to service_role` vs also revoking from `anon`/`authenticated`) and mirror it.

- [ ] **Step 2: Syntax-check the SQL**

If local Supabase is running (`supabase status`): `supabase db reset` from repo root and confirm it applies cleanly twice (idempotency). If not running, eyeball against 000118/000119 idioms — do not block the task on Docker.

- [ ] **Step 3: Append the table definition to `db/01_schema.sql`** (same SQL, table + indexes only — that file holds schema, not RPCs).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000121_sheet_export_queue.sql db/01_schema.sql
git commit -m "feat(sheet-export): migration 000121 — sheet_export_queue + enqueue/claim/phone-candidate RPCs"
```

---

### Task 2: Normalisers (`normaliseEmail`, `normalisePhone`)

**Files:**
- Create: `backend/src/lib/sheet-export/normalise.js`
- Test: `backend/test/sheet-export-normalise.test.mjs`

**Interfaces:**
- Produces: `normaliseEmail(raw) → string|null` (trimmed, lowercased; null if empty/no `@`). `normalisePhone(raw) → { canonical, suffix9 }|null` — canonical is `44`-prefixed digits for UK numbers (`07123 456789`, `+44 7123-456789`, `447123456789` all → `447123456789`); `suffix9` is the last 9 digits (for the SQL candidate lookup); null when fewer than 10 digits remain.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/sheet-export-normalise.test.mjs
import { describe, it, expect } from 'vitest';
import { normaliseEmail, normalisePhone } from '../src/lib/sheet-export/normalise.js';

describe('normaliseEmail', () => {
  it('trims and lowercases', () => {
    expect(normaliseEmail('  Jane.Smith@Example.COM ')).toBe('jane.smith@example.com');
  });
  it('rejects empties and non-emails', () => {
    expect(normaliseEmail('')).toBeNull();
    expect(normaliseEmail('   ')).toBeNull();
    expect(normaliseEmail(null)).toBeNull();
    expect(normaliseEmail('not-an-email')).toBeNull();
  });
});

describe('normalisePhone', () => {
  it('canonicalises all UK forms to 44…', () => {
    for (const raw of ['07123 456789', '+447123456789', '447123456789',
                       '07123-456-789', '(07123) 456789', '+44 7123 456789']) {
      expect(normalisePhone(raw)?.canonical).toBe('447123456789');
    }
  });
  it('returns the last-9-digit suffix for SQL lookup', () => {
    expect(normalisePhone('07123 456789')?.suffix9).toBe('123456789');
  });
  it('rejects numbers with fewer than 10 digits', () => {
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('0712345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
  it('leaves non-UK international numbers digits-only untouched', () => {
    expect(normalisePhone('+1 555 123 4567')?.canonical).toBe('15551234567');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/sheet-export-normalise.test.mjs`
Expected: FAIL — cannot resolve `../src/lib/sheet-export/normalise.js`.

- [ ] **Step 3: Implement**

```js
// backend/src/lib/sheet-export/normalise.js
// Contact-identity normalisers for the GHL→Dentally sheet export matcher.
// Exact equality after normalisation ONLY — no fuzzy matching by design.

export function normaliseEmail(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s || !s.includes('@')) return null;
    return s;
}

// UK-centric canonicalisation: 07… / +447… / 447… all collapse to 44-prefixed
// digits. <10 digits is too ambiguous to trust for identity — discard.
export function normalisePhone(raw) {
    let digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.startsWith('0044')) digits = `44${digits.slice(4)}`;
    else if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
    if (digits.length < 10) return null;
    return { canonical: digits, suffix9: digits.slice(-9) };
}
```

- [ ] **Step 4: Run to verify pass** — same command, expect all PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): email/UK-phone normalisers"` (add both files).

---

### Task 3: `google_sheets_writer` OAuth provider

**Files:**
- Create: `backend/src/lib/integrations/google-sheets-writer-provider.js`
- Modify: `backend/src/lib/integrations/index.js` (add the import so the provider registers — mirror how `google-sheets-provider.js` is imported there)
- Test: `backend/test/sheet-export-writer-provider.test.mjs`

**Interfaces:**
- Consumes: `registerProvider` from `./provider-interface.js`, `integrationRepository` (existing methods `upsert`, `upsertSecrets`, `getByProvider`, `markFailed`, `markRevoked`, `claimRefresh`, `clearRefresh`), `encryptSecret`/`decryptSecret` from `../crypto.js`, `parseSpreadsheetId` from `./google-sheets-provider.js`.
- Produces: `WRITER_PROVIDER_ID = 'google_sheets_writer'`; `GoogleSheetsWriterProvider` (authorize/callback/refresh/revoke — same contract as `GoogleSheetsProvider`); `writerFetch(orgId, path, { method='GET', params={}, body } ) → json` — authenticated Sheets API call with one 401 refresh-retry and bounded 429/5xx backoff.

- [ ] **Step 1: Write the failing test** (mirror `backend/test/google-sheets-oauth-redirect.test.mjs` — open it first and copy its env/stub conventions)

```js
// backend/test/sheet-export-writer-provider.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: {
    upsert: vi.fn(async () => ({})),
    upsertSecrets: vi.fn(async () => ({})),
    getByProvider: vi.fn(async () => null),
    markFailed: vi.fn(async () => ({})),
    markRevoked: vi.fn(async () => ({})),
    claimRefresh: vi.fn(async () => true),
    clearRefresh: vi.fn(async () => ({})),
  },
}));

describe('google_sheets_writer provider', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEETS_CLIENT_ID = 'cid';
    process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'csec';
    process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-32-bytes!!';
    process.env.BACKEND_PUBLIC_URL = 'https://api.example.com';
  });

  it('authorize URL requests the FULL spreadsheets scope (write), not readonly', async () => {
    const { GoogleSheetsWriterProvider } =
      await import('../src/lib/integrations/google-sheets-writer-provider.js');
    const { redirectUrl } = await GoogleSheetsWriterProvider.authorize('org-1');
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('scope')).toContain('auth/spreadsheets');
    expect(url.searchParams.get('scope')).not.toContain('spreadsheets.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('state carries provider=google_sheets_writer so the shared callback routes here', async () => {
    const { GoogleSheetsWriterProvider } =
      await import('../src/lib/integrations/google-sheets-writer-provider.js');
    const { verifyState } = await import('../src/lib/oauth-state.js');
    const { redirectUrl } = await GoogleSheetsWriterProvider.authorize('org-1');
    const state = new URL(redirectUrl).searchParams.get('state');
    expect(verifyState(state).provider).toBe('google_sheets_writer');
  });
});
```

(Check `oauth-state.js` for the real verify export name — if it differs from `verifyState`, use the real one.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/sheet-export-writer-provider.test.mjs` → module-not-found FAIL.

- [ ] **Step 3: Implement the provider**

Copy `google-sheets-provider.js` and adapt — the file is ~230 lines and the deltas are small and mechanical:

```js
// backend/src/lib/integrations/google-sheets-writer-provider.js
// Google Sheets WRITE connection — powers the GHL→Dentally conversion export.
// A deliberately SEPARATE provider row from 'google_sheets' (Call Reporting):
// that one stays spreadsheets.readonly; this one holds the full read/write
// spreadsheets scope and only ever touches the ONE destination sheet whose id
// the owner pastes (config.spreadsheet_id). No Drive scope — no file listing.
```

Deltas from `google-sheets-provider.js`:
1. `PROVIDER_ID` → export `const WRITER_PROVIDER_ID = 'google_sheets_writer'`.
2. `SCOPES` → `['https://www.googleapis.com/auth/spreadsheets']` only (no drive.file — the owner pastes the URL; there is no picker).
3. `redirectUri()` — same borrowed-path logic verbatim (a dedicated `GOOGLE_SHEETS_CLIENT_ID` uses the registered `google_sheets` callback path; the Google Ads fallback uses `google_ads`). The signed state carries `provider: WRITER_PROVIDER_ID`, and the public `/oauth/:provider/callback` routes on the state, so no new redirect URI registration is needed:
   ```js
   function redirectUri() {
       const path = process.env.GOOGLE_SHEETS_CLIENT_ID ? 'google_sheets' : 'google_ads';
       return `${backendUrl()}/oauth/${path}/callback`;
   }
   ```
4. Rename `sheetsFetch` → `writerFetch` and widen it to accept `{ method = 'GET', params = {}, body }`; when `body` is present send `JSON.stringify(body)` with `Content-Type: application/json`. Keep the identical 401-refresh-once and 429/5xx bounded-backoff logic.
5. `sync` provider hook → delegate to the drainer (added in Task 7):
   ```js
   async sync(orgId) {
       const { sheetExportService } = await import('../../services/sheet-export.service.js');
       return sheetExportService.drainOrg(orgId, { includeNoMatch: true });
   },
   ```
6. `registerProvider({ id: WRITER_PROVIDER_ID, label: 'Google Sheets Export', authStyle: 'oauth', category: 'reporting' }, GoogleSheetsWriterProvider);`
7. In `backend/src/lib/integrations/index.js`, add the import line next to the existing `google-sheets-provider.js` one.

- [ ] **Step 4: Run tests** — provider test PASSES; also run the full suite (`npm test`) to confirm registering a new provider broke nothing.

- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): google_sheets_writer OAuth provider (full spreadsheets scope)"`.

---

### Task 4: Queue repository

**Files:**
- Create: `backend/src/repositories/sheet-export.repository.js`
- Test: `backend/test/sheet-export-repository.test.mjs`

**Interfaces:**
- Consumes: `serviceClient` from `../lib/supabase.js`; RPCs from Task 1.
- Produces (all org-scoped; every method takes `orgId` first):
  - `enqueue(orgId, sinceIso) → number` (RPC `sheet_export_enqueue`)
  - `claim(orgId, { limit = 50, includeNoMatch = false }) → rows[]` (RPC `sheet_export_claim`)
  - `markExported(orgId, ids[])` — status `exported`, `exported_at = now`
  - `markNoMatch(orgId, id, reason)` — status `no_match`, `last_error = reason`
  - `markRetry(orgId, id, message)` — back to `pending`, `attempts + 1`, `last_error`; at `attempts >= 10` flips to `failed`
  - `counts(orgId) → { pending, processing, exported, no_match, failed }`
  - `getContact(orgId, contactId) → row|null` (id, first_name, last_name, email, phone, pms_external_id)
  - `ghlCandidatesByEmail(orgId, email) → rows[]` — `.eq('organisation_id', orgId).not('ghl_contact_id','is',null).ilike('email', escaped)` where `escaped` = email with `%`,`_`,`\` backslash-escaped (ilike with no wildcards ⇒ case-insensitive equality)
  - `ghlCandidatesByPhone(orgId, suffix9) → rows[]` (RPC `sheet_export_phone_candidates`)
  - `pipelineLeads(orgId, contactIds[]) → rows[]` — leads with `ghl_pipeline_id` not null, `.in('contact_id', ids)`, ordered `created_at` asc
  - `practices(orgId) → [{id, name}]`

- [ ] **Step 1: Write failing tests.** Open `backend/test/sheet.repository.test.mjs` first and reuse its supabase-mock harness conventions from `test/setup.js` (the harness records `.from()` chains and supports `supaRec.rpcProvider` for RPC stubbing). Cover:
  - `enqueue` calls the RPC with `{ p_org, p_since }` (assert via `supaRec.rpcCalls`).
  - `claim` passes `p_limit`/`p_include_no_match` through.
  - `markRetry` at attempts 9 → status `failed`; below → `pending` with attempts+1.
  - **Cross-org isolation (house standard):** every `.from('sheet_export_queue')` / `.from('contacts')` / `.from('leads')` chain contains `.eq('organisation_id', <org>)`, and RPC calls carry `p_org` — assert on the recorded chains for BOTH a query run as org A and org B.
  - `ghlCandidatesByEmail` escapes `%`/`_` in the email before `ilike`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Follow `sheet.repository.js` style ("queries in, rows out", no logic beyond the `markRetry` attempts branch). `markRetry`:

```js
async markRetry(orgId, id, message) {
    const { data } = await serviceClient.from('sheet_export_queue')
        .select('attempts').eq('organisation_id', orgId).eq('id', id).maybeSingle();
    const attempts = (data?.attempts ?? 0) + 1;
    const status = attempts >= 10 ? 'failed' : 'pending';
    await serviceClient.from('sheet_export_queue')
        .update({ status, attempts, last_error: String(message ?? '').slice(0, 500),
                  updated_at: new Date().toISOString() })
        .eq('organisation_id', orgId).eq('id', id);
    return { status, attempts };
},
```

- [ ] **Step 4: Run tests → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): queue repository (RPC-backed, org-scoped)"`.

---

### Task 5: Matcher service

**Files:**
- Create: `backend/src/services/sheet-export-match.service.js`
- Test: `backend/test/sheet-export-match.test.mjs`

**Interfaces:**
- Consumes: `sheetExportRepository` (Task 4), `normaliseEmail`/`normalisePhone` (Task 2), `integrationAccountRepository.list(orgId, 'gohighlevel')` and `integrationRepository.getByProvider(orgId, 'gohighlevel')` for pipeline definitions.
- Produces: `findMatch(orgId, dentallyContact) → { matchedContact, lead, pipelineName, leadCreatedAt } | null` and `pipelineNameMap(orgId) → Map<pipelineId, name>`.

- [ ] **Step 1: Write failing tests** (mock the three repositories with `vi.mock`). Cases — each is one `it`:
  1. Email hit: Dentally contact `{email: 'Jane@X.com'}` → candidate with `email: 'jane@x.com'`, one pipeline lead → returns that contact + lead + resolved pipeline name.
  2. Phone-only hit: no email match, phone `07123 456789` matches candidate stored as `+447123456789` (repo phone-RPC mocked to return it; service re-verifies canonical equality in JS).
  3. Ambiguity tiebreak: two candidates share the email; only one has a pipeline lead → that one wins. Both have leads → most recently created contact wins.
  4. No pipeline lead on the matched contact → returns `null` (caller marks `no_match`).
  5. Earliest lead selection: matched contact has leads created 2026-03-01 and 2026-01-15 → `leadCreatedAt` is 2026-01-15 and `pipelineName` comes from THAT lead's `ghl_pipeline_id`.
  6. Unresolvable pipeline id → `pipelineName` falls back to the raw id (never blank).
  7. Dentally contact with neither email nor phone → `null` without any repo candidate call.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```js
// backend/src/services/sheet-export-match.service.js
// Pure-read matcher: Dentally patient contact -> GHL contact with a pipeline
// lead. Exact equality after normalisation; auditable tiebreaks; never mutates
// contacts/leads. Tenant isolation: every read is org-scoped in the repository.
import { sheetExportRepository } from '../repositories/sheet-export.repository.js';
import { integrationAccountRepository } from '../repositories/integration-account.repository.js';
import { integrationRepository } from '../repositories/integration.repository.js';
import { normaliseEmail, normalisePhone } from '../lib/sheet-export/normalise.js';

export async function pipelineNameMap(orgId) {
    const byId = new Map();
    const accounts = await integrationAccountRepository.list(orgId, 'gohighlevel').catch(() => []);
    for (const account of accounts ?? []) {
        for (const p of account.config?.pipelines ?? []) {
            if (p?.id && !byId.has(p.id)) byId.set(String(p.id), p.name ?? String(p.id));
        }
    }
    if (byId.size === 0) {
        const legacy = await integrationRepository.getByProvider(orgId, 'gohighlevel').catch(() => null);
        for (const p of legacy?.config?.pipelines ?? []) {
            if (p?.id) byId.set(String(p.id), p.name ?? String(p.id));
        }
    }
    return byId;
}

async function pickCandidate(orgId, candidates) {
    if (candidates.length === 0) return null;
    const leads = await sheetExportRepository.pipelineLeads(orgId, candidates.map((c) => c.id));
    const byContact = new Map();
    for (const lead of leads) {
        if (!byContact.has(lead.contact_id)) byContact.set(lead.contact_id, []);
        byContact.get(lead.contact_id).push(lead);
    }
    // Tiebreak: prefer a candidate that actually holds a pipeline lead; if
    // several (or none) do, most recently created contact. Recorded upstream in
    // matched_contact_id so the choice is auditable, never silent.
    const withLeads = candidates.filter((c) => byContact.has(c.id));
    const pool = withLeads.length > 0 ? withLeads : candidates;
    pool.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const chosen = pool[0];
    const chosenLeads = byContact.get(chosen.id) ?? [];
    if (chosenLeads.length === 0) return null; // matched a person, but no pipeline lead
    chosenLeads.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { contact: chosen, lead: chosenLeads[0] }; // EARLIEST lead = true incoming date
}

export async function findMatch(orgId, dentallyContact) {
    const email = normaliseEmail(dentallyContact?.email);
    const phone = normalisePhone(dentallyContact?.phone);
    if (!email && !phone) return null;

    let picked = null;
    if (email) {
        const candidates = (await sheetExportRepository.ghlCandidatesByEmail(orgId, email))
            .filter((c) => c.id !== dentallyContact.id && normaliseEmail(c.email) === email);
        picked = await pickCandidate(orgId, candidates);
    }
    if (!picked && phone) {
        const candidates = (await sheetExportRepository.ghlCandidatesByPhone(orgId, phone.suffix9))
            .filter((c) => c.id !== dentallyContact.id
                && normalisePhone(c.phone)?.canonical === phone.canonical);
        picked = await pickCandidate(orgId, candidates);
    }
    if (!picked) return null;

    const names = await pipelineNameMap(orgId);
    const pid = String(picked.lead.ghl_pipeline_id);
    return {
        matchedContact: picked.contact,
        lead: picked.lead,
        pipelineName: names.get(pid) ?? pid,
        leadCreatedAt: picked.lead.created_at,
    };
}
```

- [ ] **Step 4: Run tests → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): GHL↔Dentally contact matcher (email/phone, auditable tiebreaks)"`.

---

### Task 6: Sheet writer (tabs + idempotent append)

**Files:**
- Create: `backend/src/lib/integrations/google-sheets-writer.js`
- Test: `backend/test/sheet-export-writer.test.mjs`

**Interfaces:**
- Consumes: `writerFetch` (Task 3).
- Produces:
  - `HEADER = ['Name','Email','Phone','Source (Pipeline)','Appointment Date','Lead Incoming Date','Export ID']`
  - `ensurePracticeTab(orgId, spreadsheetId, practiceId, practiceName) → tabTitle` — rename-safe via developer metadata key `practice:<uuid>`
  - `appendRows(orgId, spreadsheetId, tabTitle, rows[][])` — `values.append`, `valueInputOption=RAW`
  - `readExportIds(orgId, spreadsheetId, tabTitle) → Set<string>` — reads column G
  - `formatLondonDate(iso) → 'dd/mm/yyyy'`

- [ ] **Step 1: Write failing tests** with `vi.mock('../src/lib/integrations/google-sheets-writer-provider.js', ...)` stubbing `writerFetch`. Cases:
  1. `formatLondonDate('2026-08-12T18:30:00Z')` → `'12/08/2026'`; and a BST-boundary value `'2026-06-30T23:30:00Z'` → `'01/07/2026'` (Europe/London, DST-correct).
  2. `ensurePracticeTab` when metadata already maps the practice UUID → returns the CURRENT title of that sheetId (rename-safe), performs no `batchUpdate`.
  3. `ensurePracticeTab` when absent → issues one `batchUpdate` containing `addSheet` + `createDeveloperMetadata` (key `practice:<uuid>`) and appends the `HEADER` row.
  4. `appendRows` POSTs to `/v4/spreadsheets/<id>/values/<encoded tab>!A1:append` with `valueInputOption=RAW`, `insertDataOption=INSERT_ROWS` and the rows in `body.values`.
  5. `readExportIds` parses a `values.get` response of column G into a Set, skipping the header cell.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```js
// backend/src/lib/integrations/google-sheets-writer.js
// Tab management + idempotent append for the conversion export. Tab identity
// is the practice UUID in spreadsheet developer metadata — NOT the display
// name — so renaming a practice in the app never forks a new tab.
import { writerFetch } from './google-sheets-writer-provider.js';

export const HEADER = ['Name', 'Email', 'Phone', 'Source (Pipeline)',
    'Appointment Date', 'Lead Incoming Date', 'Export ID'];

export function formatLondonDate(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date(iso));
}

const metaKey = (practiceId) => `practice:${practiceId}`;

export async function ensurePracticeTab(orgId, spreadsheetId, practiceId, practiceName) {
    const meta = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}`, {
        params: { fields: 'sheets(properties(sheetId,title)),developerMetadata(metadataKey,metadataValue)' },
    });
    const mapped = (meta.developerMetadata ?? [])
        .find((m) => m.metadataKey === metaKey(practiceId));
    if (mapped) {
        const sheet = (meta.sheets ?? [])
            .find((s) => String(s.properties?.sheetId) === String(mapped.metadataValue));
        if (sheet) return sheet.properties.title;
    }
    // Create the tab + stamp the practice UUID as spreadsheet-level metadata.
    const title = String(practiceName || 'Unassigned').slice(0, 90);
    const created = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests: [{ addSheet: { properties: { title } } }] },
    });
    const sheetId = created.replies?.[0]?.addSheet?.properties?.sheetId;
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests: [{ createDeveloperMetadata: { developerMetadata: {
            metadataKey: metaKey(practiceId), metadataValue: String(sheetId),
            location: { spreadsheet: true }, visibility: 'DOCUMENT',
        } } }] },
    });
    await appendRows(orgId, spreadsheetId, title, [HEADER]);
    return title;
}

export async function appendRows(orgId, spreadsheetId, tabTitle, rows) {
    if (!rows.length) return { appended: 0 };
    const range = encodeURIComponent(`${tabTitle}!A1`);
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}:append`, {
        method: 'POST',
        params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
        body: { values: rows },
    });
    return { appended: rows.length };
}

// Column G = Export ID (queue row uuid). Read on retry so a crash between
// append and mark-exported can never double-write a conversion.
export async function readExportIds(orgId, spreadsheetId, tabTitle) {
    const range = encodeURIComponent(`${tabTitle}!G2:G`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}`);
    return new Set((res.values ?? []).map((r) => String(r[0] ?? '')).filter(Boolean));
}
```

(If a duplicate-title `addSheet` 400s because two practices share a display name, the implementer should suffix ` (2)` and retry once — add that guard and a test if time allows; otherwise note it in the tab-title slice.)

- [ ] **Step 4: Run tests → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): tab-per-practice sheet writer with metadata identity + export-id dedup"`.

---

### Task 7: Drainer service

**Files:**
- Create: `backend/src/services/sheet-export.service.js`
- Test: `backend/test/sheet-export-service.test.mjs`

**Interfaces:**
- Consumes: Tasks 3–6 modules; `integrationRepository` (`getByProvider`, `mergeConfig`, `markRevoked`, `markFailed`, `setSyncTime`); `parseSpreadsheetId` from `google-sheets-provider.js`.
- Produces `sheetExportService` with:
  - `drainOrg(orgId, { includeNoMatch = false }) → { skipped? | exported, noMatch, retried }`
  - `kickDrain(orgId)` — fire-and-forget, 60 s in-memory debounce per org, never throws
  - `setDestination(orgId, url)` — parse + verify access (metadata GET) + `mergeConfig({ spreadsheet_id, export_since: existing ?? now })`
  - `status(orgId)` — connection status + `counts` + destination id
  - `disconnect(orgId)` — `markRevoked`
  - `drainAllOrgs()` — for the worker; enumerate orgs the same way `google-sheets-sync.js syncAllOrgs` does (open it and mirror), per-org failures isolated

- [ ] **Step 1: Write failing tests** (all collaborators `vi.mock`ed). Cases:
  1. Not connected / revoked / no `spreadsheet_id` → `{ skipped: ... }`, no RPC calls.
  2. Happy path: enqueue called with `config.export_since`; one claimed row → matcher returns a match → `ensurePracticeTab` + `appendRows` called with the six display fields + queue uuid, `markExported` called with the row id, and the row values use `formatLondonDate`.
  3. Matcher returns null → `markNoMatch`, nothing appended.
  4. `appendRows` throws → `markRetry` with the error message; no `markExported`; the error does NOT propagate out of `drainOrg`.
  5. Row whose uuid is already in `readExportIds` → skipped from append but STILL `markExported` (the crash-recovery path).
  6. Rows grouped: two claimed rows, same practice → ONE `appendRows` call with two value rows.
  7. `kickDrain` twice within the debounce window → `drainOrg` runs once.
  8. **Cross-org isolation:** `drainOrg('org-a')` never passes `org-b` to any collaborator (assert every mock call's first arg).
  9. No token material in any thrown/logged string (assert `markRetry` message comes from `err.message`, and give the thrown error a `secrets`-looking property that must not appear).
  10. `appendRows` throws with `err.status = 404` → `integrationRepository.markFailed` called with `'destination sheet not accessible'` AND the rows get `markRetry` (stay pending for after reconnect).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```js
// backend/src/services/sheet-export.service.js
// Outbox drainer for the GHL→Dentally conversion export. All external I/O
// (Google) lives HERE — never in the webhook request path. Claim is atomic
// (FOR UPDATE SKIP LOCKED RPC) so the webhook-kicked drain and the worker
// sweep operate on disjoint rows; exactly-once appends via the Export ID
// column dedup. Spec: docs/superpowers/specs/2026-08-06-ghl-dentally-sheet-export-design.md
import { sheetExportRepository } from '../repositories/sheet-export.repository.js';
import { integrationRepository } from '../repositories/integration.repository.js';
import { findMatch } from './sheet-export-match.service.js';
import { WRITER_PROVIDER_ID } from '../lib/integrations/google-sheets-writer-provider.js';
import { parseSpreadsheetId } from '../lib/integrations/google-sheets-provider.js';
import { ensurePracticeTab, appendRows, readExportIds, formatLondonDate }
    from '../lib/integrations/google-sheets-writer.js';

const lastKick = new Map(); // orgId -> ms; 60s debounce, in-process only

export const sheetExportService = {
    async status(orgId) {
        const integ = await integrationRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
        const counts = integ ? await sheetExportRepository.counts(orgId) : null;
        return {
            connected: !!integ && integ.status !== 'revoked',
            status: integ?.status ?? 'not_connected',
            spreadsheetId: integ?.config?.spreadsheet_id ?? null,
            exportSince: integ?.config?.export_since ?? null,
            lastError: integ?.last_error ?? null,
            counts,
        };
    },

    async setDestination(orgId, url) {
        const spreadsheetId = parseSpreadsheetId(url);
        if (!spreadsheetId) throw Object.assign(new Error('Not a valid Google Sheets URL'), { status: 400 });
        const integ = await integrationRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
        if (!integ || !integ.secrets) throw Object.assign(new Error('Connect Google Sheets export first'), { status: 409 });
        // Verify we can actually reach the sheet with the write-scoped token.
        const { writerFetch } = await import('../lib/integrations/google-sheets-writer-provider.js');
        await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}`, {
            params: { fields: 'spreadsheetId' },
        });
        // export_since is stamped ONCE — this is the go-forward-only cutoff.
        const export_since = integ.config?.export_since ?? new Date().toISOString();
        await integrationRepository.mergeConfig(orgId, WRITER_PROVIDER_ID, { spreadsheet_id: spreadsheetId, export_since });
        return { spreadsheetId, exportSince: export_since };
    },

    async disconnect(orgId) {
        await integrationRepository.markRevoked(orgId, WRITER_PROVIDER_ID);
        return { ok: true };
    },

    kickDrain(orgId) {
        const now = Date.now();
        if ((lastKick.get(orgId) ?? 0) > now - 60_000) return;
        lastKick.set(orgId, now);
        // Fire-and-forget AFTER the webhook 200 — a Google outage must never
        // block appointment ingestion or trigger Dentally webhook retries.
        setImmediate(() => {
            this.drainOrg(orgId).catch((err) => {
                console.warn('[sheet-export] kicked drain failed', { orgId, err: err?.message || String(err) });
            });
        });
    },

    async drainOrg(orgId, { includeNoMatch = false } = {}) {
        const integ = await integrationRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
        if (!integ || integ.status === 'revoked' || !integ.secrets) return { skipped: 'not_connected' };
        const spreadsheetId = integ.config?.spreadsheet_id;
        const since = integ.config?.export_since;
        if (!spreadsheetId || !since) return { skipped: 'no_destination' };

        await sheetExportRepository.enqueue(orgId, since);
        const rows = await sheetExportRepository.claim(orgId, { limit: 50, includeNoMatch });
        if (rows.length === 0) return { exported: 0, noMatch: 0, retried: 0 };

        const practiceName = new Map((await sheetExportRepository.practices(orgId)).map((p) => [p.id, p.name]));
        const perPractice = new Map(); // practiceId -> [{ queueRow, values }]
        let exported = 0, noMatch = 0, retried = 0;

        for (const row of rows) {
            try {
                const contact = await sheetExportRepository.getContact(orgId, row.contact_id);
                const match = contact ? await findMatch(orgId, contact) : null;
                if (!match) {
                    await sheetExportRepository.markNoMatch(orgId, row.id,
                        contact ? 'no GHL pipeline lead matched' : 'contact missing');
                    noMatch += 1;
                    continue;
                }
                const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
                const values = [name, contact.email ?? '', contact.phone ?? '',
                    match.pipelineName, formatLondonDate(row.appointment_starts_at),
                    formatLondonDate(match.leadCreatedAt), row.id];
                await sheetExportRepository.recordMatch(orgId, row.id, match.matchedContact.id, match.lead.id);
                const key = row.practice_id ?? 'unassigned';
                if (!perPractice.has(key)) perPractice.set(key, []);
                perPractice.get(key).push({ queueRow: row, values });
            } catch (err) {
                await sheetExportRepository.markRetry(orgId, row.id, err?.message || 'match failed');
                retried += 1;
            }
        }

        for (const [practiceId, batch] of perPractice) {
            try {
                const title = await ensurePracticeTab(orgId, spreadsheetId, practiceId,
                    practiceName.get(practiceId) ?? 'Unassigned');
                const already = await readExportIds(orgId, spreadsheetId, title);
                const fresh = batch.filter((b) => !already.has(b.queueRow.id));
                await appendRows(orgId, spreadsheetId, title, fresh.map((b) => b.values));
                await sheetExportRepository.markExported(orgId, batch.map((b) => b.queueRow.id));
                exported += batch.length;
            } catch (err) {
                // Distinct handling (spec): sheet deleted or access revoked → the
                // whole integration flips to failed with a specific reason, so the
                // Integrations panel shows "sheet not accessible" + Reconnect
                // instead of rows silently retrying forever. Rows stay pending.
                if (err?.status === 403 || err?.status === 404) {
                    await integrationRepository.markFailed(orgId, WRITER_PROVIDER_ID,
                        'destination sheet not accessible').catch(() => {});
                }
                for (const b of batch) {
                    await sheetExportRepository.markRetry(orgId, b.queueRow.id, err?.message || 'append failed');
                    retried += 1;
                }
            }
        }
        await integrationRepository.setSyncTime(orgId, WRITER_PROVIDER_ID).catch(() => {});
        return { exported, noMatch, retried };
    },

    async drainAllOrgs() {
        // Enumerate orgs with a writer row — mirror google-sheets-sync.syncAllOrgs.
        const orgs = await sheetExportRepository.orgsWithWriter();
        const results = [];
        for (const orgId of orgs) {
            try {
                results.push({ orgId, ...(await this.drainOrg(orgId, { includeNoMatch: true })) });
            } catch (err) {
                console.error('[sheet-export] drain failed', { orgId, err: err?.message || String(err) });
                results.push({ orgId, error: err?.message || 'drain failed' });
            }
        }
        return results;
    },
};
```

Add the two repository methods this needs to Task 4's file while here (with tests): `recordMatch(orgId, id, matchedContactId, matchedLeadId)` (update the two audit columns) and `orgsWithWriter() → orgId[]` (`from('integrations').select('organisation_id').eq('provider', WRITER_PROVIDER_ID).neq('status','revoked')` — this one is the single cross-org read, worker-only, mirroring how other `syncAllOrgs` enumerate).

- [ ] **Step 4: Run tests → PASS** (and the full suite).
- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): drainer service — enqueue, match, idempotent append, retry/backoff"`.

---

### Task 8: Webhook kick + worker sweep

**Files:**
- Modify: `backend/src/services/webhook.service.js` (dentally handler, after the per-record loop)
- Modify: `backend/src/workers/index.js`
- Test: `backend/test/sheet-export-webhook-kick.test.mjs`

**Interfaces:**
- Consumes: `sheetExportService.kickDrain` (Task 7).

- [ ] **Step 1: Write the failing test.** Mirror an existing webhook test's setup (find one: `grep -l "webhookService" backend/test/*.mjs`). Mock `sheet-export.service.js`; deliver a signed Dentally `appointment` event; assert `kickDrain` was called with the org id. Deliver a `payment` event; assert it was NOT called. Assert the webhook response does not await the drain (kick is sync + fire-and-forget, so the handler resolves even when `drainOrg` hangs).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** In `webhookService.dentally`, immediately before the final `return { received: true, resourceType, action, count: results.length, results };`:

```js
        // Conversion export: a new/relinked appointment or patient may complete
        // a first-appointment condition — kick the (debounced, fire-and-forget)
        // sheet-export drain. Never awaited: Google must not slow this path.
        if (resourceType === 'appointment' || resourceType === 'patient') {
            try {
                const { sheetExportService } = await import('./sheet-export.service.js');
                sheetExportService.kickDrain(orgId);
            } catch { /* export is best-effort; the worker sweep is the backstop */ }
        }
```

In `workers/index.js`, next to the `google-sheets-sync` schedule:

```js
// Sheet-export drain — every 15 min: enqueue+match+append for every org with
// a google_sheets_writer connection. Catches sync-path appointments, retries
// transient Google failures (backoff lives in the claim RPC), and nightly-ish
// revisits young no_match rows. Real-time comes from the Dentally webhook kick.
scheduleMonitored('sheet-export-drain', '*/15 * * * *', async () => {
    try {
        const { sheetExportService } = await import('../services/sheet-export.service.js');
        const results = await sheetExportService.drainAllOrgs();
        const active = results.filter((r) => (r.exported ?? 0) + (r.retried ?? 0) + (r.noMatch ?? 0) > 0);
        if (active.length > 0) console.log(`[worker] Sheet export: ${JSON.stringify(active)}`);
    } catch (err) {
        console.error('[worker] Sheet export drain failed', err);
    }
}, { maxRuntime: 10 });
```

- [ ] **Step 4: Run tests → PASS** (full suite — webhook tests are sensitive).
- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): webhook drain kick + 15-min worker sweep"`.

---

### Task 9: Controller + routes

**Files:**
- Create: `backend/src/controllers/sheet-export.controller.js`
- Modify: `backend/src/routes/integrations.routes.js` (static block, BEFORE the `/:provider/callback` param routes — next to the existing `/google-sheets/*` block)
- Test: `backend/test/sheet-export-routes.test.mjs`

**Interfaces:**
- Consumes: `sheetExportService` (Task 7). Connect/OAuth reuse the EXISTING generic paths — `POST /api/integrations/connect` with `{ provider: 'google_sheets_writer' }` and the public `/oauth/:provider/callback` — because Task 3 registered the provider. No new OAuth routes.
- Produces endpoints (document in Task 11):
  - `GET  /api/integrations/google-sheets-writer/status` — owner + practice_manager
  - `POST /api/integrations/google-sheets-writer/destination` — owner; body `{ url }` (Zod: `z.object({ url: z.string().min(1) })` inline in the controller, matching how `sheets.controller.js` validates)
  - `POST /api/integrations/google-sheets-writer/drain` — owner ("Export now")
  - `DELETE /api/integrations/google-sheets-writer` — owner

- [ ] **Step 1: Write failing route tests.** Mirror the harness in the existing google-sheets route/permission tests (find with `grep -l "google-sheets" backend/test/*.mjs`). Cases: owner can hit all four; practice_manager gets status 200 but 403 on destination/drain/delete; reception 403 on all; destination with a junk URL → 400; response bodies never include a `secrets` field.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement controller** (thin — parse, call service, shape response):

```js
// backend/src/controllers/sheet-export.controller.js
import { z } from 'zod';
import { sheetExportService } from '../services/sheet-export.service.js';

const destinationSchema = z.object({ url: z.string().min(1) });

export const sheetExportController = {
    async status(req, res) {
        res.json(await sheetExportService.status(req.user.organisation_id));
    },
    async setDestination(req, res) {
        const { url } = destinationSchema.parse(req.body);
        res.json(await sheetExportService.setDestination(req.user.organisation_id, url));
    },
    async drain(req, res) {
        res.json(await sheetExportService.drainOrg(req.user.organisation_id, { includeNoMatch: true }));
    },
    async disconnect(req, res) {
        res.json(await sheetExportService.disconnect(req.user.organisation_id));
    },
};
```

Routes (inside the static section of `integrations.routes.js`, after the `/google-sheets/*` block, matching its exact `(0, auth_1.requireRole)` idiom):

```js
router.get('/google-sheets-writer/status', (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(sheetExportController.status));
router.post('/google-sheets-writer/destination', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetExportController.setDestination));
router.post('/google-sheets-writer/drain', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetExportController.drain));
router.delete('/google-sheets-writer', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetExportController.disconnect));
```

(Add the `import { sheetExportController } from "../controllers/sheet-export.controller.js";` at the top of the routes file.)

- [ ] **Step 4: Run tests → PASS**; `npm run lint`; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): owner routes — status/destination/drain/disconnect"`.

---

### Task 10: Frontend panel

**Files:**
- Create: `frontend/features/integrations/components/GoogleSheetsWriterPanel.tsx`
- Modify: `frontend/features/system/components/IntegrationsScreen.tsx` (render the new panel next to `GoogleSheetsPanel`)
- Modify: `frontend/features/integrations/api.ts` + `hooks.ts` (add the four calls/hooks following the file's existing fetch + React Query patterns — open both and mirror exactly)

**Interfaces:**
- Consumes backend endpoints from Task 9 via the `/api/backend/...` same-origin proxy (like every other integrations call in `api.ts`). Connect uses the EXISTING connect flow that `GoogleSheetsPanel` uses (`POST /api/backend/integrations/connect` body `{ provider: 'google_sheets_writer' }` → redirect to the returned `redirectUrl`) — open `GoogleSheetsPanel.tsx` and copy its connect handler.

- [ ] **Step 1: Read `GoogleSheetsPanel.tsx` end-to-end.** Reuse its card scaffold, button/badge primitives, and connect/disconnect handlers — this panel is a simpler sibling (no column mapping, no per-practice sources).

- [ ] **Step 2: Implement the panel.** States and copy (British English, no emojis):
  1. **Not connected:** title "Google Sheets — Conversion Export", one paragraph ("Automatically records each new patient's first appointment in a Google Sheet when they match a GoHighLevel pipeline lead — name, contact details, pipeline and dates. One tab per practice."), a "Connect Google account" button (connect flow above).
  2. **Connected, no destination:** input to paste the destination spreadsheet URL + "Save destination" (POST destination; surface the 400 message inline on error).
  3. **Active:** status card — destination link (`https://docs.google.com/spreadsheets/d/<id>`), export-since date, counts row (Pending / Exported / No match / Failed), "Export now" button (POST drain, then refetch status), "Disconnect" (DELETE, with a confirm) .
  4. **Failed:** amber banner with `lastError` and a "Reconnect" button (same connect flow).

- [ ] **Step 3: Wire into `IntegrationsScreen.tsx`** directly below `GoogleSheetsPanel`.

- [ ] **Step 4: Verify** — `cd frontend && npm run typecheck && npm run lint && npm run build`. All clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(sheet-export): Integrations panel — connect, destination, status, export-now"`.

---

### Task 11: Docs + final verification

**Files:**
- Modify: `docs/API.md` (the four new endpoints + a note that connect reuses the generic `/integrations/connect`), `CLAUDE.md` (work-log entry in "Current state"), `docs/superpowers/specs/2026-08-06-ghl-dentally-sheet-export-design.md` (status line → implemented)

- [ ] **Step 1: Document the endpoints in `docs/API.md`** following its existing per-endpoint format (method, path, roles, body, response).

- [ ] **Step 2: Add the CLAUDE.md work-log entry** covering: what shipped, migration `000121` NOT yet applied on hosted (+ the `NOTIFY pgrst` reminder), env/console prerequisite (add the `https://www.googleapis.com/auth/spreadsheets` scope to the Google Cloud OAuth consent screen before the owner can connect), and the go-forward-only `export_since` semantics.

- [ ] **Step 3: Full verification run**

```bash
cd backend && npm test && npm run lint && npm run typecheck
cd ../frontend && npm run typecheck && npm run lint && npm run build
```
All green — paste the summary counts into the commit body.

- [ ] **Step 4: Commit** — `git commit -m "docs(sheet-export): API docs + work log; spec marked implemented"`.

---

## Deploy checklist (after all tasks, not part of the code plan)

1. Apply `000121` on hosted project `mkfhpzjbijbachoonytt` (Supabase MCP), then `NOTIFY pgrst, 'reload schema';`.
2. Google Cloud Console: add the `https://www.googleapis.com/auth/spreadsheets` scope to the OAuth consent screen used by `GOOGLE_SHEETS_CLIENT_ID`.
3. Push `main` (backend + frontend ship together — additive change, no breaking API).
4. Owner: Integrations → Google Sheets — Conversion Export → Connect → paste destination sheet URL. `export_since` stamps at that moment.
