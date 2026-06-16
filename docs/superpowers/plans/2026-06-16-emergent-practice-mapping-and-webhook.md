# Emergent Practice Mapping + Real-Time Webhook — Implementation Plan

> **For agentic workers (Gemini):** Implement this plan task-by-task, top to bottom. Steps use checkbox (`- [ ]`) syntax. Each step is one small action. After each backend task, run the listed test command and confirm the expected output before moving on. **Do not skip the "run test, see it fail" steps** — that is how we know the test is real.

**Goal:** Let an owner explicitly map each Emergent "business" to a Dental-os practice from the Integrations page, and make the Emergent webhook ingest treatment-acceptance events in real time (create / update / delete), fully tenant-isolated.

**Architecture:** A new `emergent_practice_map` table (one row per `organisation_id` + Emergent `business_id`) holds the explicit mapping. The Emergent connector resolves `practice_id` from this table first, falling back to the existing fuzzy name match only when no explicit row exists. The webhook (mirroring the live Dentally webhook exactly: raw body + HMAC-SHA256 over `config.webhook_secret`) parses `{ event, data }`, upserts on `accepted`/`updated`, deletes on `deleted`, and auto-discovers new businesses into the map table so they appear in the UI.

**Tech Stack:** Node ESM (Express, Supabase JS `serviceClient`), Vitest, Next.js 14 + React Query, integer-pence money.

---

## MULTI-TENANCY RULES (MANDATORY — read before any task)

This is a multi-tenant SaaS. **Every** data path you write MUST be tenant-isolated:

1. The connector and repositories use `serviceClient` (bypasses RLS). Therefore **every single query** you write MUST carry an explicit `.eq('organisation_id', orgId)` (project rule 3). No exceptions.
2. The webhook has no JWT. The org is recovered **only** from the HMAC-signed URL token via `verifyWebhookToken(token)`. Never trust any org/business id in the body to choose a tenant — the body's `business_id` is used **only** to look up a mapping that is itself already scoped to the resolved `orgId`.
3. Practice resolution must never return a `practice_id` from another org: the map table is queried with `.eq('organisation_id', orgId)`, and `practices.id` it points to belongs to the same org by construction (FK + org-scoped writes).
4. The upsert key is `(organisation_id, source, external_id)` — already org-scoped, so two orgs with identical records never collide.
5. Owner-only writes (`requireRole('owner')`); reads allow `owner` + `practice_manager`.

A cross-org isolation test is included (Task 13). It must pass.

---

## Responsibilities split

- **Gemini (you):** write all code + tests in every task below; run backend tests; run `npm run typecheck` / `npm run lint` (frontend) and `npm test` (backend).
- **Claude (reviewer):** writes the migration SQL is in this plan, but **Claude applies the migration** (local `supabase db reset` + hosted via Supabase MCP + `NOTIFY pgrst`), and runs the final code review. Gemini: create the migration FILE (Task 1) but do **not** attempt to apply it to hosted.

---

## File structure

**Backend — create:**
- `backend/src/repositories/emergent-practice-map.repository.js` — map-table data access (Task 2)
- `supabase/migrations/20260101000100_emergent_practice_map.sql` — schema (Task 1)
- `backend/test/emergent-practice-map.test.mjs` — repo/mapRecord/resolution tests (Tasks 2, 4)
- `backend/test/emergent-webhook.test.mjs` — webhook ingest + isolation tests (Tasks 6, 13)

**Backend — modify:**
- `backend/src/repositories/treatment-accepted.repository.js` — `business_id` in SAFE_COLS, `deleteByExternalId`, `restampPractice` (Task 3)
- `backend/src/lib/integrations/emergent-sync.js` — export `externalId`, set `business_id`, `loadResolution`, `discover`, dual-shape `mapRecord` (Task 4)
- `backend/src/services/emergent.service.js` — `listPractices`, `setPracticeMapping`, `get()` adds `webhookSecretSet` (Task 5)
- `backend/src/services/integration.service.js` — add `'emergent'` to `WEBHOOK_PROVIDERS` (Task 5)
- `backend/src/services/webhook.service.js` — `async emergent(...)` ingest (Task 6)
- `backend/src/controllers/webhook.controller.js` — wire emergent raw body + headers (Task 7)
- `backend/src/app.js` — raw body mount for `/webhooks/emergent` (Task 8)
- `backend/src/models/integration.model.js` — `emergentPracticeMapSchema` (Task 9)
- `backend/src/controllers/integration.controller.js` — `emergentPractices`, `emergentSetPractice` (Task 9)
- `backend/src/routes/integrations.routes.js` — two emergent practice routes (Task 9)
- `backend/test/emergent-map-record.test.mjs` — keep legacy cases, add explicit-map cases (Task 4)

**Frontend — create:**
- `frontend/features/integrations/components/EmergentPracticeMapping.tsx` — mapping UI (Task 11)

**Frontend — modify:**
- `frontend/features/integrations/api.ts` — emergent-practices types + 2 fns (Task 10)
- `frontend/features/integrations/hooks.ts` — `useEmergentPractices`, `useSetEmergentPractice` (Task 10)
- `frontend/features/integrations/components/EmergentPanel.tsx` — webhook-secret field + status (Task 12)
- `frontend/features/system/components/IntegrationsScreen.tsx` — render the mapping card (Task 11)

---

## Task 1: Migration — `emergent_practice_map` + `business_id` column

**Files:**
- Create: `supabase/migrations/20260101000100_emergent_practice_map.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Emergent → practice mapping. Explicit owner-set mapping of each Emergent
-- "business" (business_id) to a Dental-os practice, replacing the fuzzy
-- name-match as the primary resolver for treatment_accepted.practice_id.
-- Also adds a real business_id column on treatment_accepted (extracted from raw)
-- so re-stamping on a mapping change and discovery queries are clean.
-- Idempotent. Additive only — safe to re-apply.
-- After applying on hosted run: NOTIFY pgrst, 'reload schema';

-- 1) Map table -------------------------------------------------------------
create table if not exists public.emergent_practice_map (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  business_id     text not null,
  business_name   text,
  practice_id     uuid references public.practices(id) on delete set null,  -- null = intentionally unmapped
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, business_id)
);
create index if not exists emergent_practice_map_org_idx
  on public.emergent_practice_map (organisation_id);
alter table public.emergent_practice_map enable row level security;
-- App path uses serviceClient + explicit .eq('organisation_id', orgId) (rule 3).

-- 2) business_id column on treatment_accepted ------------------------------
alter table public.treatment_accepted
  add column if not exists business_id text;
update public.treatment_accepted
  set business_id = raw->>'business_id'
  where business_id is null and raw ? 'business_id';
create index if not exists treatment_accepted_org_business_idx
  on public.treatment_accepted (organisation_id, business_id);

-- 3) Seed the map from data already synced (preserve current fuzzy links) ---
insert into public.emergent_practice_map (organisation_id, business_id, business_name, practice_id)
select distinct on (t.organisation_id, t.business_id)
       t.organisation_id, t.business_id,
       t.raw->>'business_name' as business_name,
       t.practice_id
from public.treatment_accepted t
where t.business_id is not null
order by t.organisation_id, t.business_id, (t.practice_id is null) asc  -- prefer a non-null practice_id
on conflict (organisation_id, business_id) do nothing;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Verify SQL parses locally (Gemini)**

Run: `grep -c "create table" supabase/migrations/20260101000100_emergent_practice_map.sql`
Expected: `1`. Do NOT run `supabase db reset` — Claude applies the migration.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000100_emergent_practice_map.sql
git commit -m "feat(db): emergent_practice_map table + treatment_accepted.business_id (000100)"
```

---

## Task 2: `emergent-practice-map.repository.js`

**Files:**
- Create: `backend/src/repositories/emergent-practice-map.repository.js`
- Test: `backend/test/emergent-practice-map.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// backend/test/emergent-practice-map.test.mjs
import { describe, it, expect } from 'vitest';

describe('emergentPracticeMapRepository shape', () => {
  it('exports the expected methods', async () => {
    const { emergentPracticeMapRepository: repo } =
      await import('../src/repositories/emergent-practice-map.repository.js');
    for (const m of ['list', 'discover', 'setMapping', 'practiceOptions']) {
      expect(typeof repo[m]).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Run it, see it fail**

Run: `cd backend && npx vitest run test/emergent-practice-map.test.mjs`
Expected: FAIL — cannot resolve module `emergent-practice-map.repository.js`.

- [ ] **Step 3: Write the repository**

```js
// ============================================================================
// Emergent practice-map repository — explicit Emergent business_id -> practice
// mapping. Tenant isolation: serviceClient path, so EVERY query carries an
// explicit .eq('organisation_id', orgId) (rule 3).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const emergentPracticeMapRepository = {
    // All mapped businesses for an org, with the practice name embedded for the
    // UI. practice_id may be null (discovered-but-unmapped, or intentionally
    // unmapped). Ordered by business_name for a stable list.
    async list(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .select('business_id, business_name, practice_id, practices(name)')
            .eq('organisation_id', orgId)
            .order('business_name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
            business_id: r.business_id,
            business_name: r.business_name,
            practice_id: r.practice_id,
            practice_name: r.practices?.name ?? null,
        }));
    },

    // Insert any businesses we have not seen before. NEVER clobbers an existing
    // row (ignoreDuplicates) so a discovered business keeps its owner-set
    // practice_id. `businesses` = [{ business_id, business_name }].
    async discover(orgId, businesses) {
        const seen = new Map();
        for (const b of businesses ?? []) {
            const id = b?.business_id;
            if (id == null || String(id).trim() === '') continue;
            if (!seen.has(id)) seen.set(id, b.business_name ?? null);
        }
        if (seen.size === 0) return;
        const rows = [...seen.entries()].map(([business_id, business_name]) => ({
            organisation_id: orgId, business_id: String(business_id), business_name,
        }));
        const { error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .upsert(rows, { onConflict: 'organisation_id,business_id', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
    },

    // Set (or clear) the practice for one business. Upserts the row so it works
    // even if discovery has not run yet. practiceId null = intentionally unmapped.
    async setMapping(orgId, businessId, businessName, practiceId) {
        const row = {
            organisation_id: orgId,
            business_id: String(businessId),
            practice_id: practiceId ?? null,
            updated_at: new Date().toISOString(),
        };
        if (businessName != null) row.business_name = businessName;
        const { error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .upsert(row, { onConflict: 'organisation_id,business_id' });
        if (error) throw new Error(error.message);
    },

    // The org's practices, as dropdown options for the mapping UI.
    async practiceOptions(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId)
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((p) => ({ id: p.id, name: p.name }));
    },

    // Resolution map for the connector: business_id -> practice_id (value may be
    // null = explicit unmapped). The KEY's presence means "explicit row exists".
    async resolutionMap(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .select('business_id, practice_id')
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        const m = new Map();
        for (const r of data ?? []) m.set(String(r.business_id), r.practice_id ?? null);
        return m;
    },
};
```

- [ ] **Step 4: Run the test, see it pass**

Run: `cd backend && npx vitest run test/emergent-practice-map.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/emergent-practice-map.repository.js backend/test/emergent-practice-map.test.mjs
git commit -m "feat(emergent): practice-map repository"
```

---

## Task 3: `treatment-accepted.repository.js` — business_id col, delete, restamp

**Files:**
- Modify: `backend/src/repositories/treatment-accepted.repository.js`

- [ ] **Step 1: Add `business_id` to SAFE_COLS**

Find the `SAFE_COLS` constant (currently ends `...value_pence, accepted_date, status, created_at, updated_at`). Replace it with:

```js
const SAFE_COLS =
  'id, organisation_id, source, external_id, business_id, patient_name, patient_external_id, ' +
  'contact_id, practice_id, practitioner_name, associate_id, treatment_name, ' +
  'value_pence, accepted_date, status, created_at, updated_at';
```

- [ ] **Step 2: Add `deleteByExternalId` and `restampPractice` methods**

Inside the `treatmentAcceptedRepository = { ... }` object, after the `aggregate` method (before the closing `};`), add:

```js
    // Hard-delete one record by its derived external_id (treatment.deleted
    // webhook). Org-scoped (rule 3). Returns the number of rows removed.
    async deleteByExternalId(orgId, source, externalId) {
        const { data, error } = await supabase_1.serviceClient
            .from('treatment_accepted')
            .delete()
            .eq('organisation_id', orgId)
            .eq('source', source)
            .eq('external_id', externalId)
            .select('id');
        if (error) throw new Error(error.message);
        return data?.length ?? 0;
    },

    // Re-stamp practice_id on every existing row for one Emergent business
    // (called when an owner changes the mapping). Org-scoped (rule 3). Returns
    // the number of rows updated.
    async restampPractice(orgId, businessId, practiceId) {
        const { data, error } = await supabase_1.serviceClient
            .from('treatment_accepted')
            .update({ practice_id: practiceId ?? null })
            .eq('organisation_id', orgId)
            .eq('business_id', String(businessId))
            .select('id');
        if (error) throw new Error(error.message);
        return data?.length ?? 0;
    },
```

- [ ] **Step 3: Syntax check**

Run: `cd backend && node --check src/repositories/treatment-accepted.repository.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add backend/src/repositories/treatment-accepted.repository.js
git commit -m "feat(emergent): treatment_accepted deleteByExternalId + restampPractice + business_id col"
```

---

## Task 4: `emergent-sync.js` — explicit resolution + discovery

**Files:**
- Modify: `backend/src/lib/integrations/emergent-sync.js`
- Modify: `backend/test/emergent-map-record.test.mjs`
- Test: `backend/test/emergent-practice-map.test.mjs` (add resolution cases)

- [ ] **Step 1: Write the failing tests (mapRecord dual-shape resolution)**

Append to `backend/test/emergent-map-record.test.mjs` (keep all existing tests as-is):

```js
describe('emergent mapRecord explicit resolution', () => {
  const REC2 = {
    business_id: 'biz-1', business_name: 'Ashford', date: '2026-06-10',
    patient_name: 'P', treatment_accepted: 'X', amount: 100, dentist: 'D',
  };

  it('sets business_id on the row', () => {
    expect(mapRecord(REC2, ORG).business_id).toBe('biz-1');
  });

  it('explicit map wins over fuzzy and resolves by business_id', () => {
    const maps = {
      explicit: new Map([['biz-1', 'prac-explicit']]),
      fuzzy: new Map([['ashford', 'prac-fuzzy']]),
    };
    expect(mapRecord(REC2, ORG, maps).practice_id).toBe('prac-explicit');
  });

  it('explicit null forces unmapped (does NOT fall back to fuzzy)', () => {
    const maps = {
      explicit: new Map([['biz-1', null]]),
      fuzzy: new Map([['ashford', 'prac-fuzzy']]),
    };
    expect(mapRecord(REC2, ORG, maps).practice_id).toBeNull();
  });

  it('falls back to fuzzy when no explicit row exists for the business', () => {
    const maps = {
      explicit: new Map(),
      fuzzy: new Map([['ashford', 'prac-fuzzy']]),
    };
    expect(mapRecord(REC2, ORG, maps).practice_id).toBe('prac-fuzzy');
  });

  it('still accepts a legacy plain Map as the fuzzy map (back-compat)', () => {
    const legacy = new Map([['ashford', 'prac-legacy']]);
    expect(mapRecord(REC2, ORG, legacy).practice_id).toBe('prac-legacy');
  });
});
```

- [ ] **Step 2: Run, see the new cases fail**

Run: `cd backend && npx vitest run test/emergent-map-record.test.mjs`
Expected: the 5 new tests FAIL (`business_id` undefined; explicit map ignored). Existing 8 still PASS.

- [ ] **Step 3: Update `emergent-sync.js`**

3a. Change the `externalId` declaration from `function externalId(rec) {` to **exported**:
```js
export function externalId(rec) {
```

3b. Replace the whole `mapRecord` function with this dual-shape version (accepts a `{explicit,fuzzy}` object OR a legacy plain `Map`):

```js
// Map one Emergent record to a treatment_accepted row. Money: amount (float GBP)
// -> integer pence. status is forced to 'accepted'. practice_id resolution:
//   - `maps` may be a { explicit: Map<business_id, practice_id|null>, fuzzy: Map }
//     object (new) OR a legacy plain Map (fuzzy only, back-compat).
//   - An explicit row ALWAYS wins, even when its practice_id is null (the owner
//     intentionally left it unmapped) — we then do NOT fall back to fuzzy.
//   - Otherwise fall back to the fuzzy business_name match.
export function mapRecord(rec, orgId, maps = null) {
    const empty = (s) => (s == null || String(s).trim() === '' ? null : String(s));
    const explicit = maps && maps.explicit instanceof Map ? maps.explicit : null;
    const fuzzy = maps instanceof Map ? maps : (maps && maps.fuzzy instanceof Map ? maps.fuzzy : null);
    let practiceId = null;
    if (explicit && explicit.has(String(rec.business_id))) {
        practiceId = explicit.get(String(rec.business_id)); // may be null = intentional
    } else if (fuzzy) {
        practiceId = resolvePractice(rec.business_name, fuzzy);
    }
    return {
        organisation_id: orgId,
        source: PROVIDER,
        external_id: externalId(rec),
        business_id: rec.business_id == null ? null : String(rec.business_id),
        patient_name: empty(rec.patient_name),
        patient_external_id: null,
        practice_id: practiceId,
        practitioner_name: empty(rec.dentist),
        treatment_name: empty(rec.treatment_accepted),
        value_pence: Math.round(Number(rec.amount || 0) * 100),
        accepted_date: rec.date ?? null,
        status: 'accepted',
        raw: rec,
    };
}
```

3c. Add an import at the top (after the existing `treatmentAcceptedRepository` import):
```js
import { emergentPracticeMapRepository } from "../../repositories/emergent-practice-map.repository.js";
```

3d. Add a `loadResolution` helper (place it right after the existing `loadPracticeMap` function):
```js
// Build the full resolution input for mapRecord: the explicit map-table entries
// plus the legacy fuzzy practices-by-name map (fallback). Both org-scoped.
async function loadResolution(orgId) {
    const [explicit, fuzzy] = await Promise.all([
        emergentPracticeMapRepository.resolutionMap(orgId),
        loadPracticeMap(orgId),
    ]);
    return { explicit, fuzzy };
}
```

3e. In `syncOrg`, replace the line `loadPracticeMap(orgId),` (inside the `Promise.all`) with `loadResolution(orgId),`, rename the destructured `practiceMap` to `maps`, and discover businesses before the upsert loop. The relevant block becomes:

```js
        const [records, maps] = await Promise.all([
            fetchRecords(baseUrl, apiKey, startDate),
            loadResolution(orgId),
        ]);
        await emergentPracticeMapRepository.discover(
            orgId,
            records.map((r) => ({ business_id: r.business_id, business_name: r.business_name })),
        );
        let synced = 0;
        for (const rec of records) {
            await treatmentAcceptedRepository.upsert(mapRecord(rec, orgId, maps));
            synced += 1;
        }
```

- [ ] **Step 4: Run, all pass**

Run: `cd backend && npx vitest run test/emergent-map-record.test.mjs`
Expected: PASS (13 tests).

- [ ] **Step 5: Syntax check + commit**

```bash
cd backend && node --check src/lib/integrations/emergent-sync.js
git add backend/src/lib/integrations/emergent-sync.js backend/test/emergent-map-record.test.mjs
git commit -m "feat(emergent): explicit business->practice resolution + discovery in sync"
```

---

## Task 5: `emergent.service.js` — listPractices, setPracticeMapping, webhook secret

**Files:**
- Modify: `backend/src/services/emergent.service.js`
- Modify: `backend/src/services/integration.service.js`

- [ ] **Step 1: Allow the generic webhook-secret endpoint for emergent**

In `backend/src/services/integration.service.js`, find:
```js
const WEBHOOK_PROVIDERS = new Set(['dentally']);
```
Replace with:
```js
const WEBHOOK_PROVIDERS = new Set(['dentally', 'emergent']);
```

- [ ] **Step 2: Extend `emergent.service.js`**

2a. Add imports at the top of `backend/src/services/emergent.service.js` (after the existing imports):
```js
import { emergentPracticeMapRepository } from "../repositories/emergent-practice-map.repository.js";
import { treatmentAcceptedRepository } from "../repositories/treatment-accepted.repository.js";
```

2b. In the `get(orgId)` method, add `webhookSecretSet` to the returned object (so the panel can show whether real-time is armed). The return becomes:
```js
        return {
            connected,
            status: row?.status ?? null,
            baseUrl: row?.config?.base_url ?? null,
            keyHint: row?.config?.key_hint ?? null,
            webhookUrl: webhookUrl(orgId),
            webhookSecretSet: !!row?.config?.webhook_secret,
            lastSyncAt: row?.last_sync_at ?? null,
        };
```

2c. Add two methods to the `emergentService` object (before the closing `};`):
```js
    // Businesses Emergent has sent + their current practice mapping + the org's
    // practice options for the dropdown. Owner/practice_manager read.
    async listPractices(orgId) {
        const row = await integrationRepository.getByProvider(orgId, PROVIDER);
        const [businesses, practices] = await Promise.all([
            emergentPracticeMapRepository.list(orgId),
            emergentPracticeMapRepository.practiceOptions(orgId),
        ]);
        return { connected: row?.status === 'active', businesses, practices };
    },

    // Set (or clear) one business -> practice mapping, then re-stamp existing
    // treatment_accepted rows so the change is reflected instantly (no re-sync).
    // practiceId null = intentionally unmapped. Owner-only.
    async setPracticeMapping(orgId, { businessId, practiceId }) {
        if (!businessId || String(businessId).trim() === '') {
            throw new AppError('business_id is required', 400);
        }
        // Look up the cached name so the map row keeps a label even if discovery
        // has not stamped it yet (best-effort; null is fine).
        const existing = (await emergentPracticeMapRepository.list(orgId))
            .find((b) => b.business_id === String(businessId));
        await emergentPracticeMapRepository.setMapping(
            orgId, businessId, existing?.business_name ?? null, practiceId ?? null,
        );
        const updated = await treatmentAcceptedRepository.restampPractice(orgId, businessId, practiceId ?? null);
        const result = await this.listPractices(orgId);
        return { ...result, restamped: updated };
    },
```

- [ ] **Step 3: Syntax check + commit**

```bash
cd backend && node --check src/services/emergent.service.js && node --check src/services/integration.service.js
git add backend/src/services/emergent.service.js backend/src/services/integration.service.js
git commit -m "feat(emergent): service listPractices + setPracticeMapping + webhookSecretSet; allow emergent webhook-secret"
```

---

## Task 6: `webhook.service.js` — `emergent` ingest

**Files:**
- Modify: `backend/src/services/webhook.service.js`
- Test: `backend/test/emergent-webhook.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// backend/test/emergent-webhook.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Mock the data layer so the test is pure (no DB). We assert the service's
// control flow: signature gate, event routing, org isolation via the token.
const upsert = vi.fn(async (row) => row);
const deleteByExternalId = vi.fn(async () => 1);
const discover = vi.fn(async () => {});
const resolutionMap = vi.fn(async () => new Map());
const getByProvider = vi.fn();
const setSyncTime = vi.fn(async () => {});

vi.mock('../src/repositories/treatment-accepted.repository.js', () => ({
  treatmentAcceptedRepository: { upsert, deleteByExternalId },
}));
vi.mock('../src/repositories/emergent-practice-map.repository.js', () => ({
  emergentPracticeMapRepository: { discover, resolutionMap },
}));
vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: { getByProvider, setSyncTime },
}));

const SECRET = 'whsec_test_123';
const ORG = '00000000-0000-0000-0000-000000000001';

function sign(rawBuf) {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBuf).digest('hex');
}

let token;
let webhookService;
beforeEach(async () => {
  vi.clearAllMocks();
  process.env.OAUTH_STATE_SECRET ||= 'test-oauth-state-secret';
  const { signWebhookToken } = await import('../src/lib/webhook-token.js');
  token = signWebhookToken(ORG);
  getByProvider.mockResolvedValue({ status: 'active', config: { webhook_secret: SECRET } });
  ({ webhookService } = await import('../src/services/webhook.service.js'));
});

const DATA = {
  business_id: 'biz-1', business_name: 'Ashford', date: '2026-06-15',
  patient_name: 'Emma Wilson', treatment_accepted: 'Dental Implant', amount: 15108.0,
  dentist: 'Dr. Sarah Johnson', source: 'google', campaign: 'Implant', comments: '',
};

it('accepts a valid treatment.accepted and upserts', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(res.received).toBe(true);
  expect(upsert).toHaveBeenCalledTimes(1);
  expect(upsert.mock.calls[0][0].organisation_id).toBe(ORG);
  expect(upsert.mock.calls[0][0].value_pence).toBe(1510800);
});

it('routes treatment.deleted to a delete', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.deleted', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.deleted');
  expect(deleteByExternalId).toHaveBeenCalledTimes(1);
  expect(res.deleted).toBe(1);
});

it('rejects a bad signature with 401', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent(token, raw, 'sha256=deadbeef', 'treatment.accepted'))
    .rejects.toMatchObject({ statusCode: 401 });
  expect(upsert).not.toHaveBeenCalled();
});

it('rejects when no webhook secret is configured (401)', async () => {
  getByProvider.mockResolvedValue({ status: 'active', config: {} });
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent(token, raw, sign(raw), 'treatment.accepted'))
    .rejects.toMatchObject({ statusCode: 401 });
});

it('rejects a tampered token with 401', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await expect(webhookService.emergent('not.a.valid.token', raw, sign(raw), 'treatment.accepted'))
    .rejects.toMatchObject({ statusCode: 401 });
});

it('ignores an unknown event', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.something', data: DATA }));
  const res = await webhookService.emergent(token, raw, sign(raw), 'treatment.something');
  expect(res.ignored).toBe(true);
  expect(upsert).not.toHaveBeenCalled();
  expect(deleteByExternalId).not.toHaveBeenCalled();
});

it('discovers the business and stamps last_sync_at on a valid event', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'treatment.accepted', data: DATA }));
  await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  expect(discover).toHaveBeenCalledWith(ORG, [{ business_id: 'biz-1', business_name: 'Ashford' }]);
  expect(setSyncTime).toHaveBeenCalledWith(ORG, 'emergent');
});
```

> Note: the test mocks `integration.repository.js`. `webhook.service.js` already imports `integrationRepository` from there, so the mock applies. The DB is never touched.

- [ ] **Step 2: Run, see it fail**

Run: `cd backend && npx vitest run test/emergent-webhook.test.mjs`
Expected: FAIL — `webhookService.emergent is not a function`.

- [ ] **Step 3: Implement the service method**

3a. Add imports near the other repository imports at the top of `backend/src/services/webhook.service.js`:
```js
import { treatmentAcceptedRepository } from "../repositories/treatment-accepted.repository.js";
import { emergentPracticeMapRepository } from "../repositories/emergent-practice-map.repository.js";
import { mapRecord as mapEmergentRecord, externalId as emergentExternalId } from "../lib/integrations/emergent-sync.js";
```

3b. Add the `emergent` method to the `webhookService` object (place it right after the `dentally` method). Note: `timingSafeHexEqual` and `crypto` already exist in this file — reuse them.

```js
    // Emergent (Treatments Accepted) real-time webhook. Mirrors `dentally`:
    // org from the signed URL token, HMAC-SHA256 of the raw body vs the per-org
    // config.webhook_secret, then route by event. Tenant isolation: the resolved
    // orgId scopes every downstream write; the body never chooses a tenant.
    async emergent(token, body, signature, eventHeader) {
        let orgId;
        try {
            orgId = verifyWebhookToken(token);
        } catch {
            throw new errors_1.AppError('invalid webhook token', 401);
        }
        const integration = await integrationRepository.getByProvider(orgId, 'emergent');
        if (!integration || integration.status === 'revoked') {
            throw new errors_1.AppError('emergent not connected', 404);
        }
        const secret = integration.config?.webhook_secret;
        if (!secret) {
            throw new errors_1.AppError('webhook secret not configured', 401);
        }
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
        const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        const got = String(signature ?? '').replace(/^sha256=/i, '');
        if (!timingSafeHexEqual(got, expected)) {
            console.warn('[emergent-webhook] signature rejected', {
                orgId,
                sigPresent: !!signature,
                gotPrefix: got ? got.slice(0, 8) : null,
                expectedPrefix: expected.slice(0, 8),
                lenMatch: got.length === expected.length,
                rawLen: raw.length,
            });
            throw new errors_1.AppError('invalid signature', 401);
        }
        let parsed;
        try {
            parsed = JSON.parse(raw.toString('utf8'));
        } catch {
            throw new errors_1.AppError('invalid JSON', 400);
        }
        const data = parsed?.data;
        // The event suffix may arrive in the body or the X-Webhook-Event header.
        const event = String(parsed?.event || eventHeader || '');
        const action = event.replace(/^treatment\./, '');
        if (!data || typeof data !== 'object' || data.business_id == null) {
            return { received: true, ignored: true, reason: 'no_data' };
        }

        // Discover the business so it appears in the mapping UI immediately.
        await emergentPracticeMapRepository.discover(orgId, [
            { business_id: data.business_id, business_name: data.business_name },
        ]);

        if (action === 'deleted') {
            const deleted = await treatmentAcceptedRepository.deleteByExternalId(
                orgId, 'emergent', emergentExternalId(data),
            );
            await integrationRepository.setSyncTime(orgId, 'emergent');
            return { received: true, action, deleted };
        }
        if (action === 'accepted' || action === 'updated') {
            const explicit = await emergentPracticeMapRepository.resolutionMap(orgId);
            await treatmentAcceptedRepository.upsert(mapEmergentRecord(data, orgId, { explicit, fuzzy: null }));
            await integrationRepository.setSyncTime(orgId, 'emergent');
            return { received: true, action, processed: true };
        }
        return { received: true, ignored: true, event };
    },
```

- [ ] **Step 4: Run, see it pass**

Run: `cd backend && npx vitest run test/emergent-webhook.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/webhook.service.js backend/test/emergent-webhook.test.mjs
git commit -m "feat(emergent): real-time webhook ingest (accepted/updated/deleted) with HMAC verify"
```

---

## Task 7: `webhook.controller.js` — wire emergent

**Files:**
- Modify: `backend/src/controllers/webhook.controller.js`

- [ ] **Step 1: Replace the stub `emergent` method**

Replace the entire existing `async emergent(req, res) { ... }` method with:

```js
    // Emergent (Treatments Accepted). app.js mounts express.raw on
    // /webhooks/emergent, so req.body is a Buffer (needed for HMAC). The signed
    // URL token resolves the org; the secret verifies the payload.
    async emergent(req, res) {
        const sig = req.headers['x-webhook-signature'];
        const event = req.headers['x-webhook-event'];
        res.json(await webhook_service_1.webhookService.emergent(req.params.token, req.body, sig, event));
    },
```

- [ ] **Step 2: Syntax check + commit**

```bash
cd backend && node --check src/controllers/webhook.controller.js
git add backend/src/controllers/webhook.controller.js
git commit -m "feat(emergent): wire webhook controller to ingest service"
```

---

## Task 8: `app.js` — raw body mount for `/webhooks/emergent`

**Files:**
- Modify: `backend/src/app.js`

- [ ] **Step 1: Add the raw mount**

Find the line:
```js
    app.use('/webhooks/ses-events', express_1.default.raw({ type: '*/*', limit: '1mb' }));
```
Add immediately AFTER it:
```js
    // Emergent webhook needs the raw body for HMAC signature verification.
    app.use('/webhooks/emergent', express_1.default.raw({ type: '*/*', limit: '1mb' }));
```

- [ ] **Step 2: Syntax check + commit**

```bash
cd backend && node --check src/app.js
git add backend/src/app.js
git commit -m "feat(emergent): raw body parser on /webhooks/emergent for HMAC"
```

---

## Task 9: Practice-mapping API — model, controller, routes

**Files:**
- Modify: `backend/src/models/integration.model.js`
- Modify: `backend/src/controllers/integration.controller.js`
- Modify: `backend/src/routes/integrations.routes.js`

- [ ] **Step 1: Add the Zod schema**

In `backend/src/models/integration.model.js`, add (near the other exported schemas):
```js
export const emergentPracticeMapSchema = z.object({
    business_id: z.string().min(1),
    practice_id: z.string().uuid().nullable(),
});
```
(If the file imports zod as a namespace, e.g. `import * as z_1 from "zod"`, use `z_1.z.object(...)` to match the file's existing style — check the top of the file and mirror it.)

- [ ] **Step 2: Add controller methods**

In `backend/src/controllers/integration.controller.js`, add an import for the schema (extend the existing `import { ... } from "../models/integration.model.js"` line to include `emergentPracticeMapSchema`), then add these two methods to the `integrationController` object (next to the other `emergent*` methods near the top):

```js
    async emergentPractices(req, res) {
        res.json(await emergentService.listPractices(req.user.organisation_id));
    },
    async emergentSetPractice(req, res) {
        const { business_id, practice_id } = emergentPracticeMapSchema.parse(req.body);
        res.json(await emergentService.setPracticeMapping(req.user.organisation_id, {
            businessId: business_id, practiceId: practice_id,
        }));
    },
```

- [ ] **Step 3: Add the routes**

In `backend/src/routes/integrations.routes.js`, add these two lines immediately AFTER the existing `router.delete('/emergent', ...)` line (line 24) — they must come BEFORE the `/:provider/*` param routes:

```js
router.get('/emergent/practices', (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentPractices));
router.put('/emergent/practices', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentSetPractice));
```

- [ ] **Step 4: Syntax check + commit**

```bash
cd backend && node --check src/models/integration.model.js && node --check src/controllers/integration.controller.js && node --check src/routes/integrations.routes.js
git add backend/src/models/integration.model.js backend/src/controllers/integration.controller.js backend/src/routes/integrations.routes.js
git commit -m "feat(emergent): practice-mapping routes (list + set)"
```

- [ ] **Step 5: Run the full backend suite (no regressions)**

Run: `cd backend && npm test`
Expected: all tests PASS (existing suite + the new emergent tests). If any pre-existing unrelated test fails, note it but do not fix it here.

---

## Task 10: Frontend API + hooks

**Files:**
- Modify: `frontend/features/integrations/api.ts`
- Modify: `frontend/features/integrations/hooks.ts`

- [ ] **Step 1: Add API types + functions**

In `frontend/features/integrations/api.ts`, add (near the other emergent/practice exports):
```ts
export interface EmergentBusiness {
  business_id: string;
  business_name: string | null;
  practice_id: string | null;
  practice_name: string | null;
}
export interface EmergentPracticeOption {
  id: string;
  name: string;
}
export interface EmergentPracticesResponse {
  connected: boolean;
  businesses: EmergentBusiness[];
  practices: EmergentPracticeOption[];
}

export function listEmergentPractices() {
  return api<EmergentPracticesResponse>('/api/integrations/emergent/practices');
}

export function setEmergentPractice(business_id: string, practice_id: string | null) {
  return api<EmergentPracticesResponse & { restamped: number }>(
    '/api/integrations/emergent/practices',
    { method: 'PUT', body: JSON.stringify({ business_id, practice_id }) },
  );
}
```

- [ ] **Step 2: Add hooks**

In `frontend/features/integrations/hooks.ts`, add the import for the two new fns (extend the existing `from '../api'` import line), then add:
```ts
export function useEmergentPractices() {
  return useQuery({ queryKey: ['emergent-practices'], queryFn: listEmergentPractices });
}

export function useSetEmergentPractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ business_id, practice_id }: { business_id: string; practice_id: string | null }) =>
      setEmergentPractice(business_id, practice_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emergent-practices'] }),
  });
}
```
(Ensure `listEmergentPractices` and `setEmergentPractice` are added to the existing `import { ... } from '../api';` statement.)

- [ ] **Step 3: Typecheck + commit**

```bash
cd frontend && npm run typecheck
git add frontend/features/integrations/api.ts frontend/features/integrations/hooks.ts
git commit -m "feat(emergent): frontend api + hooks for practice mapping"
```

---

## Task 11: `EmergentPracticeMapping.tsx` + render it

**Files:**
- Create: `frontend/features/integrations/components/EmergentPracticeMapping.tsx`
- Modify: `frontend/features/system/components/IntegrationsScreen.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';
// Emergent business -> practice mapping. Shown on the Integrations screen once
// Emergent is connected. Mirrors DentallyPracticeMapping: each Emergent
// "business" (e.g. "Ashford") is mapped to a Dental-os practice via a dropdown.
// Saving re-stamps existing treatment_accepted rows server-side (no re-sync).

import { useEmergentPractices, useSetEmergentPractice } from '../hooks';
import type { EmergentBusiness, EmergentPracticeOption } from '../api';
import CollapsibleCard from './CollapsibleCard';

function Row({
  business,
  practices,
}: {
  business: EmergentBusiness;
  practices: EmergentPracticeOption[];
}) {
  const save = useSetEmergentPractice();
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 4px', fontSize: 13 }}>
        {business.business_name || business.business_id}
      </td>
      <td style={{ padding: '8px 4px' }}>
        <select
          value={business.practice_id ?? ''}
          disabled={save.isPending}
          onChange={(e) =>
            save.mutate({
              business_id: business.business_id,
              practice_id: e.target.value || null,
            })
          }
          style={{
            width: '100%', padding: '6px 8px', fontSize: 12,
            border: '1px solid var(--border)', borderRadius: 6, background: 'white',
          }}
        >
          <option value="">Unmapped</option>
          {practices.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '8px 4px', width: 90, fontSize: 11, color: 'var(--ink-muted, #6B7280)' }}>
        {save.isPending ? 'Saving…' : business.practice_id ? 'Mapped' : ''}
      </td>
    </tr>
  );
}

export default function EmergentPracticeMapping() {
  const { data, isLoading } = useEmergentPractices();

  if (isLoading) return null;
  if (!data?.connected) return null;

  const businesses = data.businesses ?? [];
  const practices = data.practices ?? [];
  const unmapped = businesses.filter((b) => !b.practice_id).length;

  return (
    <CollapsibleCard
      title="Emergent practice mapping"
      badge={unmapped > 0 ? (
        <span style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>{unmapped} unmapped</span>
      ) : undefined}
      style={{ marginBottom: 12 }}
    >
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Map each Emergent business to one of your practices. Businesses appear here
        once Emergent has sent data (via sync or webhook). Saving re-attributes that
        business&apos;s accepted-treatment records to the chosen practice immediately —
        no re-sync needed. Leave as &quot;Unmapped&quot; to keep a business out of
        per-practice totals.
        {unmapped > 0 && (
          <span style={{ color: 'var(--danger)' }}> {unmapped} unmapped.</span>
        )}
      </p>

      {businesses.length === 0 ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>
          No Emergent businesses seen yet. Run a sync or wait for the first webhook.
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
              <th style={{ padding: '4px' }}>Emergent business</th>
              <th style={{ padding: '4px' }}>Practice</th>
              <th style={{ padding: '4px' }} />
            </tr>
          </thead>
          <tbody>
            {businesses.map((b) => (
              <Row key={b.business_id} business={b} practices={practices} />
            ))}
          </tbody>
        </table>
      )}
    </CollapsibleCard>
  );
}
```

> If `CollapsibleCard` does not accept a `badge` prop (check `frontend/features/integrations/components/CollapsibleCard.tsx`), use the same prop the file actually exposes (DentallyPracticeMapping uses `badge`; EmergentPanel uses `actions`). Match whichever the component supports — prefer `badge`, fall back to `actions`.

- [ ] **Step 2: Render it on the Integrations screen**

In `frontend/features/system/components/IntegrationsScreen.tsx`:

2a. Add the import next to the EmergentPanel import (line ~30):
```tsx
import EmergentPracticeMapping from '@/features/integrations/components/EmergentPracticeMapping';
```

2b. Find the line `<EmergentPanel />` (line ~198) and add the mapping card right after it:
```tsx
      <EmergentPanel />
      <EmergentPracticeMapping />
```
(The component self-hides until Emergent is connected, so no extra connected-flag wiring is needed here.)

- [ ] **Step 3: Typecheck + lint + commit**

```bash
cd frontend && npm run typecheck && npm run lint
git add frontend/features/integrations/components/EmergentPracticeMapping.tsx frontend/features/system/components/IntegrationsScreen.tsx
git commit -m "feat(emergent): practice-mapping card on Integrations screen"
```

---

## Task 12: `EmergentPanel.tsx` — webhook signing secret field

**Files:**
- Modify: `frontend/features/integrations/components/EmergentPanel.tsx`

- [ ] **Step 1: Extend the status type + state**

1a. In the `EmergentStatus` interface, add:
```tsx
  webhookSecretSet: boolean;
```

1b. Add state near the other `useState` hooks:
```tsx
  const [secret, setSecret] = useState('');
  const [secretBusy, setSecretBusy] = useState(false);
  const [secretMsg, setSecretMsg] = useState<string | null>(null);
```

1c. Add the import for the existing API helper at the top:
```tsx
import { setWebhookSecret } from '@/features/integrations/api';
```

- [ ] **Step 2: Add a save-secret handler**

Add this function next to the other handlers (e.g. after `copyWebhook`):
```tsx
  async function saveSecret() {
    if (secret.trim().length < 8) return;
    setSecretBusy(true);
    setSecretMsg(null);
    setErr(null);
    try {
      await setWebhookSecret('emergent', secret.trim());
      setSecret('');
      setSecretMsg('Signing secret saved — real-time webhook is armed.');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSecretBusy(false);
    }
  }
```

- [ ] **Step 3: Add the secret UI inside the connected block**

Inside the connected branch, immediately AFTER the `{data?.webhookUrl && ( ... )}` block, add:
```tsx
          <div style={{ marginTop: 4 }}>
            <div className="text-ink-muted" style={{ fontSize: 11, marginBottom: 4 }}>
              Webhook signing secret —{' '}
              {data?.webhookSecretSet ? (
                <span style={{ color: '#047857' }}>set (real-time enabled)</span>
              ) : (
                <span style={{ color: '#b45309' }}>
                  not set — real-time deliveries are rejected until you add it
                </span>
              )}
              . Set the same secret in Emergent; we verify every delivery&apos;s
              HMAC-SHA256 signature against it.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={data?.webhookSecretSet ? 'Replace signing secret' : 'Signing secret (whsec_…)'}
                style={{
                  flex: 1, maxWidth: 320, padding: '6px 8px', fontSize: 12,
                  border: '1px solid var(--border)', borderRadius: 6,
                }}
              />
              <button
                onClick={saveSecret}
                disabled={secretBusy || secret.trim().length < 8}
                style={{
                  padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                  border: 'none', background: 'var(--brand)', color: 'white',
                  cursor: secretBusy || secret.trim().length < 8 ? 'default' : 'pointer',
                  opacity: secretBusy || secret.trim().length < 8 ? 0.6 : 1,
                }}
              >
                {secretBusy ? 'Saving…' : 'Save secret'}
              </button>
            </div>
            {secretMsg && <div style={{ fontSize: 11, color: '#047857', marginTop: 4 }}>{secretMsg}</div>}
          </div>
```

- [ ] **Step 4: Typecheck + lint + commit**

```bash
cd frontend && npm run typecheck && npm run lint
git add frontend/features/integrations/components/EmergentPanel.tsx
git commit -m "feat(emergent): webhook signing-secret field in panel"
```

---

## Task 13: Cross-org isolation test (multi-tenancy guard)

**Files:**
- Modify: `backend/test/emergent-webhook.test.mjs` (append)

- [ ] **Step 1: Add the isolation test**

Append to `backend/test/emergent-webhook.test.mjs`:
```js
it('uses ONLY the org from the signed token (body cannot cross tenants)', async () => {
  // Token is for ORG. Even though the body could carry anything, every write
  // must be scoped to ORG (the token-resolved tenant), never to a body value.
  const raw = Buffer.from(JSON.stringify({
    event: 'treatment.accepted',
    data: { ...DATA, organisation_id: 'attacker-org', business_id: 'biz-1' },
  }));
  await webhookService.emergent(token, raw, sign(raw), 'treatment.accepted');
  // resolutionMap + discover + upsert all keyed to ORG, not the body value.
  expect(resolutionMap).toHaveBeenCalledWith(ORG);
  expect(discover).toHaveBeenCalledWith(ORG, [{ business_id: 'biz-1', business_name: 'Ashford' }]);
  expect(upsert.mock.calls[0][0].organisation_id).toBe(ORG);
});
```

- [ ] **Step 2: Run, see it pass**

Run: `cd backend && npx vitest run test/emergent-webhook.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 3: Commit**

```bash
git add backend/test/emergent-webhook.test.mjs
git commit -m "test(emergent): cross-org isolation guard for webhook"
```

---

## Task 14: Final verification (Gemini) → hand back to Claude

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: all PASS.

- [ ] **Step 2: Backend lint + syntax**

Run: `cd backend && npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Frontend gates**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all succeed.

- [ ] **Step 4: Report completion**

Summarise which files changed and paste the final `npm test` summary line. STOP here — Claude applies the migration (local `supabase db reset` + hosted via Supabase MCP + `NOTIFY pgrst, 'reload schema';`) and runs the code review. Do not apply the migration to hosted yourself.

---

## Edge cases covered (reference)

- **Unknown / non-`treatment.*` event** → ignored (200, no write).
- **Missing/empty `data` or `business_id`** → ignored (`reason: no_data`).
- **Bad signature / missing secret / tampered token** → 401, nothing persisted.
- **`treatment.updated` that changes a hashed field** (business/date/patient/treatment/amount) → hashes to a new `external_id`, so it inserts a new row and the old one is orphaned. **Known limitation** (no stable Emergent id) — same as the pull path; documented, not solved here.
- **`treatment.deleted` after a field changed** → only removes a row whose hashed fields are unchanged since creation (same root cause).
- **Explicit mapping set to "Unmapped" (null)** → resolver honours it and does NOT fall back to fuzzy.
- **Business not yet discovered when owner opens the panel** → list is empty with a clear hint; first sync/webhook populates it.
- **Already-connected orgs (pre-feature)** → migration backfills `business_id` + seeds the map from existing fuzzy links, so nothing regresses.
- **Two orgs, identical Emergent record** → org-scoped upsert key prevents collision.
- **Mapping change** → `restampPractice` updates all existing rows for that business in one statement; aggregate/by-practice RPCs reflect it instantly.
```
