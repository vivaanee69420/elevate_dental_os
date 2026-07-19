# Ad Channel Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex-guessed ad-channel attribution with an explicit operator-controlled pipeline→channel map, add the three missing mapping UIs, and build a new `/ad-performance` page reporting Google vs Facebook spend, leads, cost per lead and conversions.

**Architecture:** One new table (`ad_channel_pipelines`) holds pipeline→channel. Subaccount→practice and ad-account→practice reuse existing unpopulated columns. A new backend slice (`ad-attribution.*`) computes performance by joining GHL leads (channel from the map, practice from the subaccount) to Emergent `treatment_accepted` rows using the existing phone→email→name matcher, which is extracted to a shared lib. The Daily Cockpit is untouched apart from that pure extraction.

**Tech Stack:** Express (native ESM), Supabase Postgres, Zod, vitest; Next.js 14 App Router, React Query, Tailwind, recharts.

## Global Constraints

- Money is **integer pence** everywhere. Never floats. Display via `formatPence` / `(pence/100).toLocaleString('en-GB')`.
- **Tenant isolation:** repositories use `serviceClient`, which bypasses RLS. Every query MUST chain an explicit `.eq('organisation_id', orgId)`. There is no automatic isolation.
- **No dark mode.** Light/white only.
- **British English** in all UI copy (organisation, colour, optimise, centre).
- **No emojis** in code or UI.
- Backend is **native ESM**: `import`/`export`, relative imports carry `.js` extensions. Never `require`/`module.exports`.
- Any unbounded Supabase read MUST paginate (PostgREST silently caps at 1000 rows). Use the `fetchAllPages` pattern.
- Channel vocabulary is `'google_ads' | 'meta_ads'`, matching `ad_metrics.provider`. The third bucket is `'unassigned'` and is **never persisted** — it is the absence of a row.
- A derived ratio with a zero denominator is **`null`**, never `0` and never `Infinity`.
- After any hosted DDL: `NOTIFY pgrst, 'reload schema';`
- Every mutation route is audited automatically by the `audit` middleware; do not add manual audit calls.
- Do **not** modify `frontend/features/cockpit/components/CockpitScreen.tsx` or `backend/src/services/cockpit.service.js`.

## File Structure

**Created:**
- `supabase/migrations/20260101000114_ad_channel_pipelines.sql` — the one new table.
- `backend/src/lib/lead-emergent-match.js` — pure matcher, extracted from `lead-attribution.service.js`. Zero imports.
- `backend/src/repositories/ad-channel-pipeline.repository.js` — CRUD on the new table.
- `backend/src/repositories/ad-attribution.repository.js` — reads for config + performance.
- `backend/src/services/ad-attribution.service.js` — config assembly and performance computation.
- `backend/src/models/ad-attribution.model.js` — Zod schemas.
- `backend/src/controllers/ad-attribution.controller.js`
- `backend/src/routes/ad-attribution.routes.js`
- `backend/test/lead-emergent-match.test.mjs`, `ad-channel-pipeline.repository.test.mjs`, `ad-attribution.service.test.mjs`, `ad-attribution.isolation.test.mjs`
- `frontend/features/ad-attribution/` — `api.ts`, `hooks.ts`, `components/AdAttributionSettings.tsx`, `components/SubaccountPracticeStep.tsx`, `components/PipelineChannelStep.tsx`, `components/AdAccountPracticeStep.tsx`
- `frontend/features/ad-performance/` — `api.ts`, `hooks.ts`, `components/AdPerformanceScreen.tsx`, `components/ChannelScorecard.tsx`, `components/ByPracticeTable.tsx`, `components/ChannelTrend.tsx`, `components/AdLeadsDrilldown.tsx`
- `frontend/app/(dashboard)/ad-performance/page.tsx`, `frontend/app/(dashboard)/settings/ad-attribution/page.tsx`

**Modified:**
- `backend/src/services/lead-attribution.service.js` — re-export from the new lib instead of defining the matcher.
- `backend/src/app.js` — import + mount the new router.
- `frontend/lib/nav.ts` — add the `ad-performance` nav item.
- `docs/API.md`, `docs/FORMULAS.md`

---

### Task 1: Migration — `ad_channel_pipelines`

**Files:**
- Create: `supabase/migrations/20260101000114_ad_channel_pipelines.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.ad_channel_pipelines` with columns `(id, organisation_id, integration_account_id, ghl_pipeline_id, pipeline_name, channel, created_at, updated_at)`, unique on `(organisation_id, integration_account_id, ghl_pipeline_id)`, `channel` constrained to `'google_ads' | 'meta_ads'`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- ad_channel_pipelines — the explicit GoHighLevel pipeline -> ad channel map
-- behind the /ad-performance page.
--
-- WHY THIS EXISTS: channel was previously inferred by a regular expression on
-- the pipeline name (lead-attribution.service.js classifyChannel). On live data
-- that misfires badly — the three highest-volume pipelines are named
-- "Open Day Archive - IMPLANTS" (1122 leads), "dental implants open days
-- archive" (990) and "Implants Open Days Archive" (873), none of which match
-- /google|facebook/, while the pipelines that DO match hold 33 and 112 leads.
-- The regex therefore classifies the volume as 'other' and the rounding error
-- as the answer. The operator sets this map by hand instead.
--
-- ABSENCE OF A ROW MEANS UNASSIGNED. There is deliberately no 'unassigned'
-- channel value: representing it would require writing a row for every pipeline
-- merely to say nothing about it, and would make a newly created GHL pipeline
-- indistinguishable from a deliberately excluded one.
--
-- channel uses the same vocabulary as ad_metrics.provider ('google_ads',
-- 'meta_ads') so spend and leads join without a translation layer.
--
-- Every row carries organisation_id (rule 3); repositories filter on it
-- explicitly — the serviceClient path they use has NO automatic isolation.
--
-- RLS is enabled with no policies, matching the other Emergent-era tables: the
-- repositories read via serviceClient (which bypasses RLS), and nothing reaches
-- this table over the tenantClient path.
--
-- Idempotent + additive; re-applies cleanly on a local `supabase db reset`.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
create table if not exists public.ad_channel_pipelines (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations(id) on delete cascade,
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  ghl_pipeline_id        text not null,
  pipeline_name          text,
  channel                text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organisation_id, integration_account_id, ghl_pipeline_id),
  constraint ad_channel_pipelines_channel_chk
    check (channel in ('google_ads', 'meta_ads'))
);

-- The hot read: the whole map for one org, on every performance request.
create index if not exists ad_channel_pipelines_org_idx
  on public.ad_channel_pipelines (organisation_id);

drop trigger if exists ad_channel_pipelines_updated_at on public.ad_channel_pipelines;
create trigger ad_channel_pipelines_updated_at
  before update on public.ad_channel_pipelines
  for each row execute function set_updated_at();

alter table public.ad_channel_pipelines enable row level security;

-- Reload PostgREST cache after applying:
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify it applies cleanly**

Run: `supabase db reset` from the repo root.
Expected: all migrations `000001`→`000114` apply with no error.

If a local Supabase stack is not running, verify syntax only and note that the hosted apply is a separate manual step (see Task 14).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000114_ad_channel_pipelines.sql
git commit -m "feat(ads): ad_channel_pipelines table for explicit pipeline->channel mapping"
```

---

### Task 2: Extract the Emergent matcher into a shared lib

The matcher currently lives in `lead-attribution.service.js`. The new page needs it verbatim. Copying it would let the two surfaces silently drift, which is the exact class of bug that produced earlier lead-count discrepancies. This is a **pure move**: the six functions have zero dependencies (the file's only import, `cockpitRepository`, is used solely by `channelBreakdown`).

**Files:**
- Create: `backend/src/lib/lead-emergent-match.js`
- Modify: `backend/src/services/lead-attribution.service.js`
- Test: `backend/test/lead-emergent-match.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normPhone(s) -> string|null` — digits only, last 10.
  - `normEmail(s) -> string|null` — trimmed lowercase.
  - `normName(a, b?) -> string|null` — lowercase, collapsed whitespace.
  - `buildAcceptedByKey(accepted) -> { acceptedByKey: Map<string, AcceptedValue>, nameByPractice: Map<practiceId|null, Map<string, AcceptedValue>> }`
  - `matchAcceptedValue(lead, acceptedByKey, nameByPractice) -> AcceptedValue|null` where `lead` is `{ contacts: {phone,email,first_name,last_name}, practiceId }`.
  - `AcceptedValue` is `{ valuePence: number, treatmentName: string|null, patientName: string|null, acceptedDate: string|null }`.
  - `classifyChannel(pipelineName) -> 'facebook'|'google'|'instagram'|'website'|'other'` (moved for cohesion; used only by the Cockpit).

- [ ] **Step 1: Write the failing test**

Create `backend/test/lead-emergent-match.test.mjs`:

```js
// The Emergent matcher is shared by the Daily Cockpit and the /ad-performance
// page. These tests pin its behaviour so the extraction from
// lead-attribution.service.js cannot change it.
import { describe, it, expect } from 'vitest';
import {
  normPhone, normEmail, normName, buildAcceptedByKey, matchAcceptedValue,
} from '../src/lib/lead-emergent-match.js';

describe('normalisers', () => {
  it('normPhone keeps the last 10 digits and drops punctuation', () => {
    expect(normPhone('+44 7700 900123')).toBe('7700900123');
    expect(normPhone('07700900123')).toBe('7700900123');
  });

  it('normPhone returns null for empty input rather than an empty string', () => {
    // An empty-string key would match every blank-phone record at once.
    expect(normPhone('')).toBeNull();
    expect(normPhone(null)).toBeNull();
    expect(normPhone('---')).toBeNull();
  });

  it('normEmail trims and lowercases', () => {
    expect(normEmail('  Jo@Example.COM ')).toBe('jo@example.com');
    expect(normEmail('')).toBeNull();
  });

  it('normName collapses whitespace and accepts one or two arguments', () => {
    expect(normName('Jo', 'Bloggs')).toBe('jo bloggs');
    expect(normName('  Jo   Bloggs ')).toBe('jo bloggs');
    expect(normName('', '')).toBeNull();
  });
});

describe('buildAcceptedByKey', () => {
  it('indexes by phone and email, first row winning per key', () => {
    const { acceptedByKey } = buildAcceptedByKey([
      { phone: '07700900123', email: 'a@x.com', value_pence: 500000, treatment_name: 'Implant', patient_name: 'Jo Bloggs', accepted_date: '2026-07-01' },
      { phone: '07700900123', email: 'a@x.com', value_pence: 999999, treatment_name: 'Later', patient_name: 'Jo Bloggs', accepted_date: '2026-07-02' },
    ]);
    expect(acceptedByKey.get('7700900123').valuePence).toBe(500000);
    expect(acceptedByKey.get('a@x.com').treatmentName).toBe('Implant');
  });

  it('reads phone and email from raw when the top-level columns are absent', () => {
    const { acceptedByKey } = buildAcceptedByKey([
      { raw: { phone: '07700900999', email: 'B@X.com' }, value_pence: 100 },
    ]);
    expect(acceptedByKey.has('7700900999')).toBe(true);
    expect(acceptedByKey.has('b@x.com')).toBe(true);
  });

  it('scopes the name index by practice', () => {
    const { nameByPractice } = buildAcceptedByKey([
      { patient_name: 'Jo Bloggs', practice_id: 'p1', value_pence: 111 },
      { patient_name: 'Jo Bloggs', practice_id: 'p2', value_pence: 222 },
    ]);
    expect(nameByPractice.get('p1').get('jo bloggs').valuePence).toBe(111);
    expect(nameByPractice.get('p2').get('jo bloggs').valuePence).toBe(222);
  });
});

describe('matchAcceptedValue precedence', () => {
  const accepted = [
    { phone: '07700900123', email: 'phone-row@x.com', value_pence: 100, patient_name: 'Phone Row', practice_id: 'p1' },
    { email: 'email-row@x.com', value_pence: 200, patient_name: 'Email Row', practice_id: 'p1' },
    { patient_name: 'Name Row', practice_id: 'p1', value_pence: 300 },
  ];
  const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

  it('prefers phone over email', () => {
    const lead = { contacts: { phone: '07700900123', email: 'email-row@x.com' }, practiceId: 'p1' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice).valuePence).toBe(100);
  });

  it('falls back to email when phone does not match', () => {
    const lead = { contacts: { phone: '07999999999', email: 'email-row@x.com' }, practiceId: 'p1' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice).valuePence).toBe(200);
  });

  it('falls back to a practice-scoped name last', () => {
    const lead = { contacts: { first_name: 'Name', last_name: 'Row' }, practiceId: 'p1' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice).valuePence).toBe(300);
  });

  it('does NOT match a name from a different practice', () => {
    // Name matching is the weakest tier; scoping it to the practice is what
    // stops common names colliding across sites.
    const lead = { contacts: { first_name: 'Name', last_name: 'Row' }, practiceId: 'p2' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    const lead = { contacts: { phone: '07000000000' }, practiceId: 'p1' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/lead-emergent-match.test.mjs`
Expected: FAIL — `Cannot find module '../src/lib/lead-emergent-match.js'`.

- [ ] **Step 3: Create the lib by moving the code verbatim**

Create `backend/src/lib/lead-emergent-match.js` containing exactly the functions currently in `lead-attribution.service.js`, with their comments preserved and a new file header. **Do not alter any function body.**

```js
// ============================================================================
// Lead -> Emergent match. Shared by the Daily Cockpit (lead-attribution
// service) and the /ad-performance page, so the two surfaces can never
// disagree about whether a given person converted.
//
// Pure: no imports, no I/O. Callers pass rows in and get plain values out.
// ============================================================================

export const normPhone = (s) => (String(s || '').replace(/\D/g, '').slice(-10) || null);
export const normEmail = (s) => (String(s || '').trim().toLowerCase() || null);

// Normalises a name for matching: lowercase, trimmed, internal whitespace
// collapsed to a single space. Two forms: normName(first, last) or
// normName(fullName) (single arg). Returns null for an empty/blank result —
// callers must never index a Map with '' or a matched-everything key.
export function normName(a, b) {
    const full = arguments.length >= 2 ? `${a || ''} ${b || ''}` : String(a || '');
    const collapsed = full.trim().toLowerCase().replace(/\s+/g, ' ');
    return collapsed || null;
}

// Shared phone -> email -> (practice-scoped) name matcher. `lead` is a small
// shape { contacts: {phone,email,first_name,last_name}, practiceId } — call
// sites build this from whatever row shape they have (leads table row or the
// matchBreakdown per-lead loop). Phone/email match cross-practice (a patient
// might convert at a different practice); name match is scoped to the lead's
// practice via nameByPractice to cut false positives on common names.
// Returns the matched rich accepted value { valuePence, treatmentName,
// patientName, acceptedDate } or null.
export function matchAcceptedValue(lead, acceptedByKey, nameByPractice) {
    const contact = lead?.contacts || {};
    const phone = normPhone(contact.phone);
    const email = normEmail(contact.email);
    if (phone && acceptedByKey.has(phone)) return acceptedByKey.get(phone);
    if (email && acceptedByKey.has(email)) return acceptedByKey.get(email);
    const nm = normName(contact.first_name, contact.last_name);
    if (nm) {
        const nameMap = nameByPractice?.get(lead?.practiceId ?? null);
        if (nameMap && nameMap.has(nm)) return nameMap.get(nm);
    }
    return null;
}

// Builds the accepted-key (normalised phone/email) -> rich value map from raw
// treatment_accepted rows (first match wins per key), PLUS a practice-scoped
// name index (nameByPractice: Map<practiceId, Map<normName, value>>) used as
// the last-resort match. Value shape: { valuePence, treatmentName,
// patientName, acceptedDate }.
export function buildAcceptedByKey(accepted) {
    const acceptedByKey = new Map();
    const nameByPractice = new Map();
    for (const row of accepted || []) {
        const phone = normPhone(row.phone ?? row.raw?.phone);
        const email = normEmail(row.email ?? row.raw?.email);
        const value = {
            valuePence: row.value_pence || 0,
            treatmentName: row.treatment_name ?? null,
            patientName: row.patient_name ?? null,
            acceptedDate: row.accepted_date ?? null,
        };
        if (phone && !acceptedByKey.has(phone)) acceptedByKey.set(phone, value);
        if (email && !acceptedByKey.has(email)) acceptedByKey.set(email, value);

        const nm = normName(row.patient_name);
        if (nm) {
            const practiceKey = row.practice_id ?? null;
            if (!nameByPractice.has(practiceKey)) nameByPractice.set(practiceKey, new Map());
            const nameMap = nameByPractice.get(practiceKey);
            if (!nameMap.has(nm)) nameMap.set(nm, value);
        }
    }
    return { acceptedByKey, nameByPractice };
}

// Pipeline name -> channel, by regular expression. LEGACY: used only by the
// Daily Cockpit. The /ad-performance page uses the explicit
// ad_channel_pipelines map instead, because on live data this misclassifies
// the highest-volume pipelines as 'other'. Do not use in new code.
export function classifyChannel(pipelineName) {
    const name = String(pipelineName || '');
    if (/facebook|\bfb\b/i.test(name)) return 'facebook';
    if (/google/i.test(name)) return 'google';
    if (/instagram|\big\b/i.test(name)) return 'instagram';
    if (/website|web|organic/i.test(name)) return 'website';
    return 'other';
}
```

- [ ] **Step 4: Re-export from the service so every existing caller still works**

In `backend/src/services/lead-attribution.service.js`, delete the six moved function definitions and replace them with a re-export directly below the existing `cockpitRepository` import:

```js
// The matcher moved to lib/lead-emergent-match.js so the /ad-performance page
// can share it. Re-exported here because existing call sites (cockpit.service,
// tests) import these names from this module.
export {
    normPhone, normEmail, normName,
    matchAcceptedValue, buildAcceptedByKey, classifyChannel,
} from "../lib/lead-emergent-match.js";
```

Then add a plain import for the names used internally by `matchBreakdown`:

```js
import {
    matchAcceptedValue, buildAcceptedByKey, classifyChannel,
} from "../lib/lead-emergent-match.js";
```

Leave `personKey`, `AD_CHANNELS`, `emptyStats`, `matchBreakdown`, `sumChannels`, `withCplRoi` and `leadAttributionService` exactly as they are.

- [ ] **Step 5: Run the new test and the whole backend suite**

Run: `cd backend && npx vitest run test/lead-emergent-match.test.mjs`
Expected: PASS, all cases.

Run: `cd backend && npm test`
Expected: PASS. **Every pre-existing test must still pass unchanged** — that is the acceptance criterion for this being a pure move. If any cockpit or lead-attribution test fails, the extraction altered behaviour; revert and redo it verbatim rather than editing the test.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/lead-emergent-match.js backend/src/services/lead-attribution.service.js backend/test/lead-emergent-match.test.mjs
git commit -m "refactor(ads): extract Emergent lead matcher to shared lib, no behaviour change"
```

---

### Task 3: `ad-channel-pipeline.repository.js`

**Files:**
- Create: `backend/src/repositories/ad-channel-pipeline.repository.js`
- Test: `backend/test/ad-channel-pipeline.repository.test.mjs`

**Interfaces:**
- Consumes: `serviceClient` from `../lib/supabase.js`.
- Produces: `adChannelPipelineRepository` with
  - `list(orgId) -> Promise<Array<{integration_account_id, ghl_pipeline_id, pipeline_name, channel}>>`
  - `channelMap(orgId) -> Promise<Map<string, 'google_ads'|'meta_ads'>>` keyed `` `${accountId}|${pipelineId}` ``
  - `setChannel(orgId, accountId, pipelineId, pipelineName, channel) -> Promise<void>` — `channel === null` deletes the row.

- [ ] **Step 1: Write the failing test**

Create `backend/test/ad-channel-pipeline.repository.test.mjs`:

```js
// Repository tests run the REAL repository against the fake Supabase client in
// test/setup.js, which records { table, op, eqs, upsertVals } on supaRec.last.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { adChannelPipelineRepository } from '../src/repositories/ad-channel-pipeline.repository.js';

const ORG = 'org-aaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('list', () => {
  it('reads ad_channel_pipelines scoped to the org', async () => {
    await adChannelPipelineRepository.list(ORG);
    expect(supaRec.last.table).toBe('ad_channel_pipelines');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
  });
});

describe('channelMap', () => {
  it('keys by accountId|pipelineId', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { integration_account_id: 'acc1', ghl_pipeline_id: 'p1', channel: 'google_ads' },
        { integration_account_id: 'acc2', ghl_pipeline_id: 'p1', channel: 'meta_ads' },
      ],
      error: null,
    });
    const map = await adChannelPipelineRepository.channelMap(ORG);
    // The same pipeline id in two subaccounts must stay independent — pipeline
    // ids are only unique within a GHL Location.
    expect(map.get('acc1|p1')).toBe('google_ads');
    expect(map.get('acc2|p1')).toBe('meta_ads');
  });

  it('returns an empty map when nothing is mapped', async () => {
    const map = await adChannelPipelineRepository.channelMap(ORG);
    expect(map.size).toBe(0);
  });
});

describe('setChannel', () => {
  it('upserts the row with the org stamped on it', async () => {
    await adChannelPipelineRepository.setChannel(ORG, 'acc1', 'p1', 'Open Day', 'google_ads');
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG);
    expect(supaRec.last.upsertVals.channel).toBe('google_ads');
    expect(supaRec.last.upsertVals.pipeline_name).toBe('Open Day');
  });

  it('deletes the row when channel is null, scoped by org', async () => {
    // Unassigned is the ABSENCE of a row, so clearing must delete rather than
    // write a sentinel value.
    await adChannelPipelineRepository.setChannel(ORG, 'acc1', 'p1', 'Open Day', null);
    expect(supaRec.last.op).toBe('delete');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'integration_account_id', val: 'acc1' });
    expect(supaRec.last.eqs).toContainEqual({ col: 'ghl_pipeline_id', val: 'p1' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run test/ad-channel-pipeline.repository.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the repository**

```js
// ============================================================================
// Ad channel pipeline repository — the explicit GHL pipeline -> ad channel map.
// Tenant isolation: serviceClient path, so EVERY query carries an explicit
// .eq('organisation_id', orgId) (rule 3).
//
// A pipeline with no row here is UNASSIGNED. Clearing a channel deletes the
// row; there is no 'unassigned' value to write.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// Pipeline ids are only unique within a GHL Location, so the map key must
// include the subaccount.
const key = (accountId, pipelineId) => `${accountId}|${pipelineId}`;

export const adChannelPipelineRepository = {
    async list(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_channel_pipelines')
            .select('integration_account_id, ghl_pipeline_id, pipeline_name, channel')
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // accountId|pipelineId -> channel. Absence of a key means unassigned.
    async channelMap(orgId) {
        const rows = await this.list(orgId);
        const m = new Map();
        for (const r of rows) m.set(key(r.integration_account_id, r.ghl_pipeline_id), r.channel);
        return m;
    },

    // channel null clears the mapping (deletes the row).
    async setChannel(orgId, accountId, pipelineId, pipelineName, channel) {
        if (channel === null || channel === undefined) {
            const { error } = await supabase_1.serviceClient
                .from('ad_channel_pipelines')
                .delete()
                .eq('organisation_id', orgId)
                .eq('integration_account_id', accountId)
                .eq('ghl_pipeline_id', String(pipelineId));
            if (error) throw new Error(error.message);
            return;
        }
        const { error } = await supabase_1.serviceClient
            .from('ad_channel_pipelines')
            .upsert({
                organisation_id: orgId,
                integration_account_id: accountId,
                ghl_pipeline_id: String(pipelineId),
                pipeline_name: pipelineName ?? null,
                channel,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id,integration_account_id,ghl_pipeline_id' });
        if (error) throw new Error(error.message);
    },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run test/ad-channel-pipeline.repository.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/ad-channel-pipeline.repository.js backend/test/ad-channel-pipeline.repository.test.mjs
git commit -m "feat(ads): ad_channel_pipelines repository"
```

---

### Task 4: `ad-attribution.repository.js` — reads

**Files:**
- Create: `backend/src/repositories/ad-attribution.repository.js`
- Test: extend `backend/test/ad-channel-pipeline.repository.test.mjs`? No — create `backend/test/ad-attribution.repository.test.mjs`.

**Interfaces:**
- Consumes: `serviceClient`.
- Produces: `adAttributionRepository` with
  - `ghlAccounts(orgId) -> Promise<Array<{id, label, external_account_id, practice_id, status, pipelines: Array<{id, name}>}>>`
  - `practiceOptions(orgId) -> Promise<Array<{id, name}>>`
  - `adAccounts(orgId) -> Promise<Array<{id, provider, customer_id, name, practice_id}>>`
  - `setAdAccountPractice(orgId, adAccountId, practiceId) -> Promise<void>`
  - `leadsInWindow(orgId, since, until) -> Promise<Array<lead row>>` — paginated.
  - `leadCountsByPipeline(orgId) -> Promise<Map<string, number>>` keyed `` `${accountId}|${pipelineId}` ``.
  - `acceptedForMatching(orgId, since, until) -> Promise<Array<treatment_accepted row>>` — paginated.
  - `adSpend(orgId, since, until) -> Promise<Array<{provider, practice_id, spend_pence, metric_date}>>` — paginated.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { adAttributionRepository } from '../src/repositories/ad-attribution.repository.js';

const ORG = 'org-aaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('ghlAccounts', () => {
  it('scopes by org and provider, and flattens config.pipelines', async () => {
    supaRec.resultProvider = () => ({
      data: [{
        id: 'acc1', label: 'Ashford', external_account_id: 'LOC1',
        practice_id: 'p1', status: 'active',
        config: { pipelines: [{ id: 'pl1', name: 'Open Day' }] },
      }],
      error: null,
    });
    const rows = await adAttributionRepository.ghlAccounts(ORG);
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'provider', val: 'gohighlevel' });
    expect(rows[0].pipelines).toEqual([{ id: 'pl1', name: 'Open Day' }]);
  });

  it('yields an empty pipeline list when config has none', async () => {
    supaRec.resultProvider = () => ({
      data: [{ id: 'acc1', label: 'X', config: null }], error: null,
    });
    const rows = await adAttributionRepository.ghlAccounts(ORG);
    expect(rows[0].pipelines).toEqual([]);
  });
});

describe('setAdAccountPractice', () => {
  it('updates ad_accounts scoped by org AND id', async () => {
    await adAttributionRepository.setAdAccountPractice(ORG, 'ad1', 'p1');
    expect(supaRec.last.table).toBe('ad_accounts');
    expect(supaRec.last.op).toBe('update');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: 'ad1' });
  });
});

describe('adSpend', () => {
  it('scopes by org and the date window', async () => {
    await adAttributionRepository.adSpend(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.table).toBe('ad_metrics');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run test/ad-attribution.repository.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the repository**

```js
// ============================================================================
// Ad attribution repository — the reads behind /settings/ad-attribution and
// /ad-performance. Tenant isolation: serviceClient path, so EVERY query
// carries an explicit .eq('organisation_id', orgId) (rule 3).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// PostgREST caps a single response at db-max-rows (1000) and does it SILENTLY.
// A 12-month window of leads would come back truncated and every total
// downstream would quietly undercount. See the monthly_financials truncation
// incident.
const PAGE = 1000;
async function fetchAllPages(buildQuery) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await buildQuery().range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = data || [];
        out.push(...rows);
        if (rows.length < PAGE) return out;
    }
}

export const adAttributionRepository = {
    // GHL subaccounts with their pipelines flattened out of config JSON.
    // practice_id null is legitimate: the Plan4Growth academy and accounting
    // Locations live here too and must NOT be folded into practice numbers.
    async ghlAccounts(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('integration_accounts')
            .select('id, label, external_account_id, practice_id, status, config')
            .eq('organisation_id', orgId)
            .eq('provider', 'gohighlevel')
            .order('label', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
            id: r.id,
            label: r.label,
            external_account_id: r.external_account_id,
            practice_id: r.practice_id ?? null,
            status: r.status ?? null,
            pipelines: (r.config?.pipelines ?? []).map((p) => ({ id: p.id, name: p.name })),
        }));
    },

    async practiceOptions(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId)
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((p) => ({ id: p.id, name: p.name }));
    },

    async adAccounts(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_accounts')
            .select('id, provider, customer_id, name, practice_id')
            .eq('organisation_id', orgId)
            .order('provider', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async setAdAccountPractice(orgId, adAccountId, practiceId) {
        const { error } = await supabase_1.serviceClient
            .from('ad_accounts')
            .update({ practice_id: practiceId ?? null })
            .eq('organisation_id', orgId)
            .eq('id', adAccountId);
        if (error) throw new Error(error.message);
    },

    // Leads created in [since, until), with the contact fields the matcher needs.
    async leadsInWindow(orgId, since, until) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('leads')
            .select('id, contact_id, practice_id, integration_account_id, ghl_pipeline_id, created_at, estimated_value_pence, contacts(first_name, last_name, email, phone)')
            .eq('organisation_id', orgId)
            .gte('created_at', since)
            .lt('created_at', until)
            .order('id', { ascending: true }));
    },

    // Lead volume per pipeline, for the settings screen. Counted over all time
    // so the operator can tell a busy pipeline from a dormant one regardless of
    // the window they happen to be looking at.
    async leadCountsByPipeline(orgId) {
        const rows = await fetchAllPages(() => supabase_1.serviceClient
            .from('leads')
            .select('id, integration_account_id, ghl_pipeline_id')
            .eq('organisation_id', orgId)
            .order('id', { ascending: true }));
        const counts = new Map();
        for (const r of rows) {
            if (!r.integration_account_id || !r.ghl_pipeline_id) continue;
            const k = `${r.integration_account_id}|${r.ghl_pipeline_id}`;
            counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return counts;
    },

    async acceptedForMatching(orgId, since, until) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('treatment_accepted')
            .select('id, practice_id, patient_name, value_pence, treatment_name, accepted_date, raw')
            .eq('organisation_id', orgId)
            .gte('accepted_date', since)
            .lt('accepted_date', until)
            .order('id', { ascending: true }));
    },

    async adSpend(orgId, since, until) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('ad_metrics')
            .select('id, provider, practice_id, spend_pence, metric_date')
            .eq('organisation_id', orgId)
            .gte('metric_date', since)
            .lt('metric_date', until)
            .order('id', { ascending: true }));
    },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run test/ad-attribution.repository.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/ad-attribution.repository.js backend/test/ad-attribution.repository.test.mjs
git commit -m "feat(ads): ad attribution repository reads"
```

---

### Task 5: `ad-attribution.service.js` — pure computation helpers

Split from the I/O so the arithmetic is testable without a database.

**Files:**
- Create: `backend/src/services/ad-attribution.service.js`
- Test: `backend/test/ad-attribution.service.test.mjs`

**Interfaces:**
- Consumes: `adChannelPipelineRepository`, `adAttributionRepository`, `buildAcceptedByKey`/`matchAcceptedValue` from `../lib/lead-emergent-match.js`.
- Produces (all exported for test):
  - `CHANNELS = ['google_ads', 'meta_ads', 'unassigned']`
  - `resolveChannel(channelMap, accountId, pipelineId) -> 'google_ads'|'meta_ads'|'unassigned'`
  - `personKey(lead) -> string`
  - `ratio(numerator, denominator) -> number|null`
  - `computePerformance({ leads, accepted, spend, channelMap, accountPractice }) -> { channels, byPractice }`
  - `adAttributionService.getConfig(orgId)`, `.setPipelineChannel(...)`, `.setSubaccountPractice(...)`, `.setAdAccountPractice(...)`, `.getPerformance(orgId, {since, until, practiceId})`, `.getLeads(orgId, {since, until, channel, practiceId})`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import {
  resolveChannel, ratio, computePerformance,
} from '../src/services/ad-attribution.service.js';

describe('resolveChannel', () => {
  const map = new Map([['acc1|pl1', 'google_ads']]);

  it('returns the mapped channel', () => {
    expect(resolveChannel(map, 'acc1', 'pl1')).toBe('google_ads');
  });

  it('returns unassigned when no row exists — it never guesses from the name', () => {
    expect(resolveChannel(map, 'acc1', 'pl2')).toBe('unassigned');
  });

  it('does not leak a mapping across subaccounts', () => {
    expect(resolveChannel(map, 'acc2', 'pl1')).toBe('unassigned');
  });
});

describe('ratio', () => {
  it('divides normally', () => {
    expect(ratio(1000, 4)).toBe(250);
  });

  it('returns null on a zero denominator rather than 0 or Infinity', () => {
    // A cost per lead of 0 reads as "free leads"; Infinity crashes formatting.
    expect(ratio(1000, 0)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
  });
});

describe('computePerformance', () => {
  const accountPractice = new Map([['acc1', 'p1'], ['acc2', null]]);
  const channelMap = new Map([
    ['acc1|g', 'google_ads'],
    ['acc1|f', 'meta_ads'],
  ]);

  it('counts one lead per PERSON, not per opportunity row', () => {
    // Counting rows is what produced the earlier inflated lead count: one
    // person sitting in two pipelines is one lead, not two.
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
      { id: 'l2', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-03', contacts: {} },
    ];
    const out = computePerformance({ leads, accepted: [], spend: [], channelMap, accountPractice });
    expect(out.channels.find((c) => c.channel === 'google_ads').leads).toBe(1);
  });

  it('buckets an unmapped pipeline into unassigned with null spend', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'other', created_at: '2026-07-02', contacts: {} },
    ];
    const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 50000, metric_date: '2026-07-02' }];
    const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });
    const un = out.channels.find((c) => c.channel === 'unassigned');
    expect(un.leads).toBe(1);
    // There is no spend to attribute to unassigned; zero would read as free leads.
    expect(un.spendPence).toBeNull();
    expect(un.costPerLeadPence).toBeNull();
  });

  it('computes cost per lead and cost per acquisition from matched conversions', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: { phone: '07700900123' } },
      { id: 'l2', contact_id: 'c2', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: { phone: '07700900999' } },
    ];
    const accepted = [
      { phone: '07700900123', value_pence: 400000, patient_name: 'Jo Bloggs', practice_id: 'p1' },
    ];
    const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 100000, metric_date: '2026-07-02' }];
    const out = computePerformance({ leads, accepted, spend, channelMap, accountPractice });
    const g = out.channels.find((c) => c.channel === 'google_ads');
    expect(g.leads).toBe(2);
    expect(g.conversions).toBe(1);
    expect(g.acceptedValuePence).toBe(400000);
    expect(g.spendPence).toBe(100000);
    expect(g.costPerLeadPence).toBe(50000);
    expect(g.costPerAcquisitionPence).toBe(100000);
    expect(g.conversionRate).toBeCloseTo(0.5);
  });

  it('excludes leads from a subaccount with no practice mapping', () => {
    // The Plan4Growth academy Location holds pipelines literally named
    // "Facebook Leads" that are business leads, not patient leads. Leaving a
    // subaccount unmapped must exclude it, not silently fold it in.
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc2', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
    ];
    const out = computePerformance({ leads, accepted: [], spend: [], channelMap, accountPractice });
    const total = out.channels.reduce((n, c) => n + c.leads, 0);
    expect(total).toBe(0);
    expect(out.excludedUnmappedLeads).toBe(1);
  });

  it('reports null spend for a practice with no mapped ad account', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
    ];
    // Spend rows exist but carry no practice_id, so no practice can claim them.
    const spend = [{ provider: 'google_ads', practice_id: null, spend_pence: 100000, metric_date: '2026-07-02' }];
    const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });
    const row = out.byPractice.find((p) => p.practiceId === 'p1');
    const g = row.channels.find((c) => c.channel === 'google_ads');
    // "Not reporting", never a fabricated £0.
    expect(g.spendPence).toBeNull();
    // Group level still sees the spend.
    expect(out.channels.find((c) => c.channel === 'google_ads').spendPence).toBe(100000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run test/ad-attribution.service.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```js
// ============================================================================
// Ad attribution service — Google vs Facebook performance from an EXPLICIT
// pipeline -> channel map, joined to Emergent accepted treatments.
//
// Channel comes only from ad_channel_pipelines. There is no name-based
// inference here; a pipeline with no mapping is 'unassigned' and is reported
// as its own bucket rather than guessed at or hidden.
//
// Practice comes from the GHL subaccount. A subaccount with practice_id null
// is not a dental practice feed (the academy and accounting Locations live
// there too) and its leads are excluded, counted only as excludedUnmappedLeads.
//
// Money is integer pence.
// ============================================================================
import { adChannelPipelineRepository } from "../repositories/ad-channel-pipeline.repository.js";
import { adAttributionRepository } from "../repositories/ad-attribution.repository.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { buildAcceptedByKey, matchAcceptedValue } from "../lib/lead-emergent-match.js";

export const CHANNELS = ['google_ads', 'meta_ads', 'unassigned'];
const AD_CHANNELS = ['google_ads', 'meta_ads'];

// Pipeline ids are unique only within a GHL Location.
const pipeKey = (accountId, pipelineId) => `${accountId}|${pipelineId}`;

export function resolveChannel(channelMap, accountId, pipelineId) {
    return channelMap.get(pipeKey(accountId, pipelineId)) ?? 'unassigned';
}

// One row per PERSON. Counting opportunity rows inflates the lead count when
// somebody sits in two pipelines.
export const personKey = (lead) => lead.contact_id ?? `lead:${lead.id}`;

// Null, never 0 and never Infinity: a zero-denominator cost per lead is
// unknown, and rendering it as 0 reads as "free leads".
export function ratio(numerator, denominator) {
    if (!denominator) return null;
    return numerator / denominator;
}

const emptyStats = (channel) => ({
    channel, leads: 0, conversions: 0, acceptedValuePence: 0, spendPence: 0, _hasSpend: false,
});

function finalise(stats, { allowSpend }) {
    // 'unassigned' has no spend feed at all; its spend and derived costs are
    // unknown rather than zero.
    const spendPence = allowSpend && stats._hasSpend ? stats.spendPence : null;
    return {
        channel: stats.channel,
        leads: stats.leads,
        conversions: stats.conversions,
        acceptedValuePence: stats.acceptedValuePence,
        spendPence,
        costPerLeadPence: spendPence === null ? null : ratio(spendPence, stats.leads),
        costPerAcquisitionPence: spendPence === null ? null : ratio(spendPence, stats.conversions),
        conversionRate: ratio(stats.conversions, stats.leads),
    };
}

export function computePerformance({ leads, accepted, spend, channelMap, accountPractice }) {
    const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

    const group = new Map(CHANNELS.map((c) => [c, emptyStats(c)]));
    const byPractice = new Map();      // practiceId -> Map<channel, stats>
    const seenGroup = new Map(CHANNELS.map((c) => [c, new Set()]));
    const seenPractice = new Map();    // `${practiceId}|${channel}` -> Set(personKey)
    let excludedUnmappedLeads = 0;

    const practiceStats = (practiceId, channel) => {
        if (!byPractice.has(practiceId)) {
            byPractice.set(practiceId, new Map(CHANNELS.map((c) => [c, emptyStats(c)])));
        }
        return byPractice.get(practiceId).get(channel);
    };

    for (const lead of leads || []) {
        const accountId = lead.integration_account_id;
        const practiceId = accountPractice.get(accountId) ?? null;
        if (practiceId === null) { excludedUnmappedLeads += 1; continue; }

        const channel = resolveChannel(channelMap, accountId, lead.ghl_pipeline_id);
        const person = personKey(lead);

        const groupSeen = seenGroup.get(channel);
        const pKey = `${practiceId}|${channel}`;
        if (!seenPractice.has(pKey)) seenPractice.set(pKey, new Set());
        const practiceSeen = seenPractice.get(pKey);

        const isNewToGroup = !groupSeen.has(person);
        const isNewToPractice = !practiceSeen.has(person);
        if (!isNewToGroup && !isNewToPractice) continue;
        groupSeen.add(person);
        practiceSeen.add(person);

        const matched = matchAcceptedValue(
            { contacts: lead.contacts, practiceId }, acceptedByKey, nameByPractice,
        );

        if (isNewToGroup) {
            const g = group.get(channel);
            g.leads += 1;
            if (matched) { g.conversions += 1; g.acceptedValuePence += matched.valuePence; }
        }
        if (isNewToPractice) {
            const p = practiceStats(practiceId, channel);
            p.leads += 1;
            if (matched) { p.conversions += 1; p.acceptedValuePence += matched.valuePence; }
        }
    }

    for (const row of spend || []) {
        if (!AD_CHANNELS.includes(row.provider)) continue;
        const g = group.get(row.provider);
        g.spendPence += row.spend_pence || 0;
        g._hasSpend = true;
        // Only spend on an ad account that has been mapped to a practice can be
        // attributed below group level.
        if (row.practice_id) {
            const p = practiceStats(row.practice_id, row.provider);
            p.spendPence += row.spend_pence || 0;
            p._hasSpend = true;
        }
    }

    return {
        channels: CHANNELS.map((c) => finalise(group.get(c), { allowSpend: c !== 'unassigned' })),
        byPractice: [...byPractice.entries()].map(([practiceId, chans]) => ({
            practiceId,
            channels: CHANNELS.map((c) => finalise(chans.get(c), { allowSpend: c !== 'unassigned' })),
        })),
        excludedUnmappedLeads,
    };
}

export const adAttributionService = {
    // Everything the settings screen needs, in one round trip.
    async getConfig(orgId) {
        const [accounts, practices, adAccounts, channelMap, leadCounts] = await Promise.all([
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.practiceOptions(orgId),
            adAttributionRepository.adAccounts(orgId),
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.leadCountsByPipeline(orgId),
        ]);
        const practiceName = new Map(practices.map((p) => [p.id, p.name]));
        return {
            practices,
            subaccounts: accounts.map((a) => ({
                id: a.id,
                label: a.label,
                locationId: a.external_account_id,
                status: a.status,
                practiceId: a.practice_id,
                practiceName: a.practice_id ? practiceName.get(a.practice_id) ?? null : null,
                pipelineCount: a.pipelines.length,
                leadCount: a.pipelines.reduce(
                    (n, p) => n + (leadCounts.get(pipeKey(a.id, p.id)) ?? 0), 0),
            })),
            pipelines: accounts.flatMap((a) => a.pipelines.map((p) => ({
                accountId: a.id,
                accountLabel: a.label,
                practiceId: a.practice_id,
                practiceName: a.practice_id ? practiceName.get(a.practice_id) ?? null : null,
                pipelineId: p.id,
                pipelineName: p.name,
                channel: channelMap.get(pipeKey(a.id, p.id)) ?? null,
                leadCount: leadCounts.get(pipeKey(a.id, p.id)) ?? 0,
            }))),
            adAccounts: adAccounts.map((a) => ({
                id: a.id,
                provider: a.provider,
                customerId: a.customer_id,
                name: a.name,
                practiceId: a.practice_id ?? null,
                practiceName: a.practice_id ? practiceName.get(a.practice_id) ?? null : null,
            })),
        };
    },

    async setPipelineChannel(orgId, accountId, pipelineId, channel) {
        const accounts = await adAttributionRepository.ghlAccounts(orgId);
        const account = accounts.find((a) => a.id === accountId);
        // Rejecting an unknown account is the tenant guard on this write: the
        // account list is already org-scoped.
        if (!account) throw new Error('Unknown subaccount');
        const pipeline = account.pipelines.find((p) => String(p.id) === String(pipelineId));
        await adChannelPipelineRepository.setChannel(
            orgId, accountId, pipelineId, pipeline?.name ?? null, channel,
        );
        return { ok: true };
    },

    async setSubaccountPractice(orgId, accountId, practiceId) {
        // Delegates to the existing GHL account update path rather than writing
        // integration_accounts directly, so the one-subaccount-per-practice
        // unique index and any provider-side validation stay in one place.
        await integrationAccountRepository.update(orgId, accountId, { practice_id: practiceId ?? null });
        return { ok: true };
    },

    async setAdAccountPractice(orgId, adAccountId, practiceId) {
        await adAttributionRepository.setAdAccountPractice(orgId, adAccountId, practiceId);
        return { ok: true };
    },

    async getPerformance(orgId, { since, until, practiceId }) {
        const [channelMap, accounts, leads, accepted, spend] = await Promise.all([
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.leadsInWindow(orgId, since, until),
            adAttributionRepository.acceptedForMatching(orgId, since, until),
            adAttributionRepository.adSpend(orgId, since, until),
        ]);
        const accountPractice = new Map(accounts.map((a) => [a.id, a.practice_id]));
        const practiceName = new Map(
            (await adAttributionRepository.practiceOptions(orgId)).map((p) => [p.id, p.name]),
        );
        const result = computePerformance({ leads, accepted, spend, channelMap, accountPractice });
        const byPractice = result.byPractice
            .filter((p) => !practiceId || p.practiceId === practiceId)
            .map((p) => ({ ...p, practiceName: practiceName.get(p.practiceId) ?? null }));
        return {
            channels: practiceId
                ? (byPractice[0]?.channels ?? CHANNELS.map((c) => finalise(emptyStats(c), { allowSpend: c !== 'unassigned' })))
                : result.channels,
            byPractice,
            excludedUnmappedLeads: result.excludedUnmappedLeads,
            unmappedPipelineCount: [...channelMap.keys()].length === 0
                ? accounts.reduce((n, a) => n + a.pipelines.length, 0)
                : accounts.reduce((n, a) => n + a.pipelines.filter(
                    (p) => !channelMap.has(pipeKey(a.id, p.id))).length, 0),
        };
    },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run test/ad-attribution.service.test.mjs`
Expected: PASS, all seven cases.

- [ ] **Step 5: Verify `integrationAccountRepository.update` exists with that signature**

Run: `cd backend && grep -n "async update" src/repositories/integration-account.repository.js`
Expected: a method taking `(orgId, id, patch)`. If the signature differs, adapt the call in `setSubaccountPractice` to match the real one — do not change the repository.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ad-attribution.service.js backend/test/ad-attribution.service.test.mjs
git commit -m "feat(ads): ad attribution service — explicit channel map, person-level dedupe"
```

---

### Task 6: Model, controller, routes, mount

**Files:**
- Create: `backend/src/models/ad-attribution.model.js`, `backend/src/controllers/ad-attribution.controller.js`, `backend/src/routes/ad-attribution.routes.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Consumes: `adAttributionService` from Task 5.
- Produces: routes under `/api/ad-attribution` — `GET /config`, `PUT /pipelines/:accountId/:pipelineId`, `PATCH /subaccounts/:id`, `PATCH /ad-accounts/:id`, `GET /performance`, `GET /leads`.

- [ ] **Step 1: Write the model**

```js
// ============================================================================
// Ad attribution model — Zod schemas. No ORM; Supabase is the store, so
// "model" = the validated shape of data entering/leaving this domain.
// ============================================================================
import * as zod_1 from "zod";

export const AD_CHANNELS = ['google_ads', 'meta_ads'];

// null clears the mapping — the pipeline returns to the Unassigned bucket.
export const setPipelineChannelSchema = zod_1.z.object({
    channel: zod_1.z.enum(AD_CHANNELS).nullable(),
});

export const setPracticeSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().nullable(),
});

export const performanceQuerySchema = zod_1.z.object({
    since: zod_1.z.string(),
    until: zod_1.z.string(),
    // The shared ScopePeriod bar sends scope='all' for the group.
    practice_id: zod_1.z.string().uuid().optional(),
});

export const adLeadsQuerySchema = zod_1.z.object({
    since: zod_1.z.string(),
    until: zod_1.z.string(),
    channel: zod_1.z.enum(['google_ads', 'meta_ads', 'unassigned']).optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    limit: zod_1.z.coerce.number().default(500),
});
```

- [ ] **Step 2: Write the controller**

```js
import { adAttributionService } from "../services/ad-attribution.service.js";
import {
    setPipelineChannelSchema, setPracticeSchema,
    performanceQuerySchema, adLeadsQuerySchema,
} from "../models/ad-attribution.model.js";

export const adAttributionController = {
    async config(req, res) {
        res.json(await adAttributionService.getConfig(req.user.organisation_id));
    },
    async setPipelineChannel(req, res) {
        const { channel } = setPipelineChannelSchema.parse(req.body);
        res.json(await adAttributionService.setPipelineChannel(
            req.user.organisation_id, req.params.accountId, req.params.pipelineId, channel,
        ));
    },
    async setSubaccountPractice(req, res) {
        const { practice_id } = setPracticeSchema.parse(req.body);
        res.json(await adAttributionService.setSubaccountPractice(
            req.user.organisation_id, req.params.id, practice_id,
        ));
    },
    async setAdAccountPractice(req, res) {
        const { practice_id } = setPracticeSchema.parse(req.body);
        res.json(await adAttributionService.setAdAccountPractice(
            req.user.organisation_id, req.params.id, practice_id,
        ));
    },
    async performance(req, res) {
        const q = performanceQuerySchema.parse(req.query);
        res.json(await adAttributionService.getPerformance(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: q.practice_id,
        }));
    },
    async leads(req, res) {
        const q = adLeadsQuerySchema.parse(req.query);
        res.json(await adAttributionService.getLeads(req.user.organisation_id, {
            since: q.since, until: q.until, channel: q.channel,
            practiceId: q.practice_id, limit: q.limit,
        }));
    },
};
```

- [ ] **Step 3: Add `getLeads` to the service**

Append to `adAttributionService` in `backend/src/services/ad-attribution.service.js`:

```js
    // The drill-in list: one row per person, in the same shape the shared
    // LeadsTable already renders for the cockpit.
    async getLeads(orgId, { since, until, channel, practiceId, limit }) {
        const [channelMap, accounts, leads, accepted] = await Promise.all([
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.leadsInWindow(orgId, since, until),
            adAttributionRepository.acceptedForMatching(orgId, since, until),
        ]);
        const accountPractice = new Map(accounts.map((a) => [a.id, a.practice_id]));
        const pipelineName = new Map();
        for (const a of accounts) {
            for (const p of a.pipelines) pipelineName.set(pipeKey(a.id, p.id), p.name);
        }
        const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

        const rows = [];
        const seen = new Set();
        for (const lead of leads) {
            const practice = accountPractice.get(lead.integration_account_id) ?? null;
            if (practice === null) continue;
            if (practiceId && practice !== practiceId) continue;
            const ch = resolveChannel(channelMap, lead.integration_account_id, lead.ghl_pipeline_id);
            if (channel && ch !== channel) continue;
            const person = `${ch}|${personKey(lead)}`;
            if (seen.has(person)) continue;
            seen.add(person);

            const c = lead.contacts || {};
            const matched = matchAcceptedValue({ contacts: c, practiceId: practice }, acceptedByKey, nameByPractice);
            rows.push({
                id: lead.id,
                contactId: lead.contact_id ?? null,
                name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
                email: c.email ?? null,
                phone: c.phone ?? null,
                channel: ch,
                pipelineName: pipelineName.get(pipeKey(lead.integration_account_id, lead.ghl_pipeline_id)) ?? null,
                createdAt: lead.created_at,
                converted: matched !== null,
                matchedTreatmentName: matched?.treatmentName ?? null,
                matchedValuePence: matched?.valuePence ?? 0,
            });
            if (rows.length >= limit) break;
        }
        return { leads: rows };
    },
```

- [ ] **Step 4: Write the routes**

```js
// ============================================================================
// Ad attribution routes — Express Router. Mounted at /api/ad-attribution
// (auth applied upstream). Static paths registered before any param route.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { adAttributionController } from "../controllers/ad-attribution.controller.js";
const router = (0, express_1.Router)();

const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/config', gate, (0, async_handler_1.asyncHandler)(adAttributionController.config));
router.get('/performance', gate, (0, async_handler_1.asyncHandler)(adAttributionController.performance));
router.get('/leads', gate, (0, async_handler_1.asyncHandler)(adAttributionController.leads));
router.put('/pipelines/:accountId/:pipelineId', gate, (0, async_handler_1.asyncHandler)(adAttributionController.setPipelineChannel));
router.patch('/subaccounts/:id', gate, (0, async_handler_1.asyncHandler)(adAttributionController.setSubaccountPractice));
router.patch('/ad-accounts/:id', gate, (0, async_handler_1.asyncHandler)(adAttributionController.setAdAccountPractice));

export default router;
```

- [ ] **Step 5: Mount in `app.js`**

Add the import beside the other route-module imports:

```js
import * as ad_attribution_routes_1 from "./routes/ad-attribution.routes.js";
```

Add the mount beside the other `api.use` lines:

```js
    api.use('/ad-attribution', ad_attribution_routes_1.default);
```

- [ ] **Step 6: Syntax-check and run the suite**

Run: `cd backend && npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/ad-attribution.model.js backend/src/controllers/ad-attribution.controller.js backend/src/routes/ad-attribution.routes.js backend/src/services/ad-attribution.service.js backend/src/app.js
git commit -m "feat(ads): /api/ad-attribution routes"
```

---

### Task 7: Cross-org isolation test

**Files:**
- Test: `backend/test/ad-attribution.isolation.test.mjs`

**Interfaces:**
- Consumes: `adChannelPipelineRepository`, `adAttributionRepository`.
- Produces: nothing.

- [ ] **Step 1: Write the test**

```js
// ============================================================================
// CROSS-ORG ISOLATION for the ad-attribution tables.
//
// These repositories run on serviceClient, which BYPASSES RLS. The ONLY
// app-layer tenant guard is the explicit .eq('organisation_id', orgId) chained
// on every query (see CLAUDE.md rule 3). These tests prove that filter.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { adChannelPipelineRepository } from '../src/repositories/ad-channel-pipeline.repository.js';
import { adAttributionRepository } from '../src/repositories/ad-attribution.repository.js';

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('every ad-attribution read pins organisation_id', () => {
  const reads = [
    ['list', () => adChannelPipelineRepository.list(ORG_A)],
    ['ghlAccounts', () => adAttributionRepository.ghlAccounts(ORG_A)],
    ['practiceOptions', () => adAttributionRepository.practiceOptions(ORG_A)],
    ['adAccounts', () => adAttributionRepository.adAccounts(ORG_A)],
    ['adSpend', () => adAttributionRepository.adSpend(ORG_A, '2026-07-01', '2026-08-01')],
    ['acceptedForMatching', () => adAttributionRepository.acceptedForMatching(ORG_A, '2026-07-01', '2026-08-01')],
    ['leadsInWindow', () => adAttributionRepository.leadsInWindow(ORG_A, '2026-07-01', '2026-08-01')],
  ];

  for (const [name, run] of reads) {
    it(`${name} filters on the caller org and never another`, async () => {
      await run();
      expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG_A });
      expect(supaRec.last.eqs.some((e) => e.col === 'organisation_id' && e.val === ORG_B)).toBe(false);
    });
  }
});

describe('every ad-attribution write pins organisation_id', () => {
  it('setChannel stamps the caller org on the upserted row', async () => {
    await adChannelPipelineRepository.setChannel(ORG_A, 'acc1', 'p1', 'Open Day', 'google_ads');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG_A);
    expect(supaRec.last.upsertVals.organisation_id).not.toBe(ORG_B);
  });

  it('setChannel(null) deletes scoped by org, so it cannot clear a foreign row', async () => {
    await adChannelPipelineRepository.setChannel(ORG_A, 'acc1', 'p1', null, null);
    expect(supaRec.last.op).toBe('delete');
    expect(orgFilter(supaRec.last).val).toBe(ORG_A);
  });

  it('setAdAccountPractice constrains by org AND id', async () => {
    // Both must constrain: an org-A request can never remap an org-B ad account
    // even if it knows that account's id.
    await adAttributionRepository.setAdAccountPractice(ORG_A, 'ad-in-B', 'p1');
    expect(orgFilter(supaRec.last).val).toBe(ORG_A);
    expect(supaRec.last.eqs.map((e) => e.col).sort()).toEqual(['id', 'organisation_id']);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && npx vitest run test/ad-attribution.isolation.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/test/ad-attribution.isolation.test.mjs
git commit -m "test(ads): cross-org isolation for ad attribution repositories"
```

---

### Task 8: Frontend — settings API and hooks

**Files:**
- Create: `frontend/features/ad-attribution/api.ts`, `frontend/features/ad-attribution/hooks.ts`

**Interfaces:**
- Consumes: `api` from `@/lib/api`.
- Produces: types `AdChannel`, `SubaccountRow`, `PipelineRow`, `AdAccountRow`, `AdAttributionConfig`; hooks `useAdAttributionConfig`, `useSetPipelineChannel`, `useSetSubaccountPractice`, `useSetAdAccountPractice`.

- [ ] **Step 1: Write `api.ts`**

```ts
import { api } from '@/lib/api';

// Matches ad_metrics.provider so spend and leads join without translation.
export type AdChannel = 'google_ads' | 'meta_ads';

export interface SubaccountRow {
  id: string;
  label: string;
  locationId: string;
  status: string | null;
  practiceId: string | null;
  practiceName: string | null;
  pipelineCount: number;
  leadCount: number;
}

export interface PipelineRow {
  accountId: string;
  accountLabel: string;
  practiceId: string | null;
  practiceName: string | null;
  pipelineId: string;
  pipelineName: string;
  /** null = unassigned. Never inferred from the pipeline name. */
  channel: AdChannel | null;
  leadCount: number;
}

export interface AdAccountRow {
  id: string;
  provider: string;
  customerId: string;
  name: string | null;
  practiceId: string | null;
  practiceName: string | null;
}

export interface AdAttributionConfig {
  practices: Array<{ id: string; name: string }>;
  subaccounts: SubaccountRow[];
  pipelines: PipelineRow[];
  adAccounts: AdAccountRow[];
}

export function fetchAdAttributionConfig() {
  return api<AdAttributionConfig>('/api/ad-attribution/config');
}

export function setPipelineChannel(accountId: string, pipelineId: string, channel: AdChannel | null) {
  return api<{ ok: true }>(
    `/api/ad-attribution/pipelines/${accountId}/${encodeURIComponent(pipelineId)}`,
    { method: 'PUT', body: JSON.stringify({ channel }) },
  );
}

export function setSubaccountPractice(id: string, practiceId: string | null) {
  return api<{ ok: true }>(`/api/ad-attribution/subaccounts/${id}`, {
    method: 'PATCH', body: JSON.stringify({ practice_id: practiceId }),
  });
}

export function setAdAccountPractice(id: string, practiceId: string | null) {
  return api<{ ok: true }>(`/api/ad-attribution/ad-accounts/${id}`, {
    method: 'PATCH', body: JSON.stringify({ practice_id: practiceId }),
  });
}
```

- [ ] **Step 2: Verify the `api` helper's mutation signature**

Run: `cd frontend && sed -n '1,60p' lib/api.ts`
Expected: confirm it accepts `(path, init?)` and sets the JSON content-type. If it uses a different shape (e.g. a separate `apiPost`), adapt the four functions above to match — do not change `lib/api.ts`.

- [ ] **Step 3: Write `hooks.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdAttributionConfig, setPipelineChannel, setSubaccountPractice, setAdAccountPractice,
  type AdChannel,
} from './api';

export function useAdAttributionConfig() {
  return useQuery({
    queryKey: ['ad-attribution-config'],
    queryFn: fetchAdAttributionConfig,
    staleTime: 30_000,
  });
}

// Every mapping mutation invalidates BOTH the config and the performance query:
// changing a mapping changes what the /ad-performance page reports, and a stale
// page after a remap is exactly the kind of contradiction that erodes trust in
// the numbers.
function useMappingMutation<T extends unknown[]>(fn: (...args: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: T) => fn(...args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ad-attribution-config'] });
      qc.invalidateQueries({ queryKey: ['ad-performance'] });
    },
  });
}

export function useSetPipelineChannel() {
  return useMappingMutation((accountId: string, pipelineId: string, channel: AdChannel | null) =>
    setPipelineChannel(accountId, pipelineId, channel));
}

export function useSetSubaccountPractice() {
  return useMappingMutation((id: string, practiceId: string | null) =>
    setSubaccountPractice(id, practiceId));
}

export function useSetAdAccountPractice() {
  return useMappingMutation((id: string, practiceId: string | null) =>
    setAdAccountPractice(id, practiceId));
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/ad-attribution/api.ts frontend/features/ad-attribution/hooks.ts
git commit -m "feat(ads): ad attribution settings api + hooks"
```

---

### Task 9: Frontend — Step 1, subaccount to practice

**Files:**
- Create: `frontend/features/ad-attribution/components/SubaccountPracticeStep.tsx`

**Interfaces:**
- Consumes: `useAdAttributionConfig`, `useSetSubaccountPractice`, types from `../api`.
- Produces: default-exported `SubaccountPracticeStep({ config }: { config: AdAttributionConfig })`.

- [ ] **Step 1: Write the component**

```tsx
'use client';
// Step 1 of ad attribution: connect each GoHighLevel subaccount to a practice.
//
// "No practice" is a legitimate, deliberate choice, not an error: the
// Plan4Growth academy and accounting Locations are connected here too, and
// their leads must be excluded from practice numbers rather than folded in.
// So an unmapped row is stated plainly, never flagged as a problem.
//
// One subaccount per practice is enforced by a unique index in the database, so
// a practice already taken is disabled in the dropdown with the reason shown
// rather than offered and then failing on save.
import { useState } from 'react';
import { Card } from '@/components/ui';
import { useSetSubaccountPractice } from '../hooks';
import type { AdAttributionConfig } from '../api';

export default function SubaccountPracticeStep({ config }: { config: AdAttributionConfig }) {
  const setPractice = useSetSubaccountPractice();
  const [saving, setSaving] = useState<string | null>(null);

  const takenBy = new Map<string, string>();
  for (const s of config.subaccounts) {
    if (s.practiceId) takenBy.set(s.practiceId, s.label);
  }

  async function handle(id: string, practiceId: string) {
    setSaving(id);
    try {
      await setPractice.mutateAsync([id, practiceId || null]);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card title="Step 1 — Connect subaccounts to practices">
      <p className="mb-3 text-[13px] text-slate-600">
        Each GoHighLevel subaccount belongs to one practice. Leave a subaccount unconnected
        if it is not a practice — its leads are then excluded from ad performance.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3 font-medium">Subaccount</th>
              <th className="py-2 pr-3 text-right font-medium">Pipelines</th>
              <th className="py-2 pr-3 text-right font-medium">Leads</th>
              <th className="py-2 pr-3 font-medium" style={{ width: '32%' }}>Practice</th>
            </tr>
          </thead>
          <tbody>
            {config.subaccounts.map((s) => (
              <tr key={s.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  <div className="font-medium text-slate-900">{s.label}</div>
                  <div className="text-[11px] text-slate-400">{s.locationId}</div>
                </td>
                <td className="py-2 pr-3 text-right text-slate-600">{s.pipelineCount}</td>
                <td className="py-2 pr-3 text-right text-slate-600">{s.leadCount.toLocaleString('en-GB')}</td>
                <td className="py-2 pr-3">
                  <select
                    className="w-full rounded border border-slate-300 px-2 py-1 text-[13px]"
                    disabled={saving === s.id}
                    value={s.practiceId ?? ''}
                    onChange={(e) => handle(s.id, e.target.value)}
                  >
                    <option value="">Not a practice — exclude</option>
                    {config.practices.map((p) => {
                      const owner = takenBy.get(p.id);
                      const taken = owner !== undefined && p.id !== s.practiceId;
                      return (
                        <option key={p.id} value={p.id} disabled={taken}>
                          {p.name}{taken ? ` (already ${owner})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {config.subaccounts.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">
          No GoHighLevel subaccounts connected yet. Connect one on the Integrations page first.
        </p>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Verify the `Card` prop name**

Run: `cd frontend && sed -n '1,40p' components/ui/Card.tsx`
Expected: confirm it takes a `title` prop. If it takes `heading` or children-only, adjust the usage above to match the real signature.

- [ ] **Step 3: Typecheck and commit**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

```bash
git add frontend/features/ad-attribution/components/SubaccountPracticeStep.tsx
git commit -m "feat(ads): settings step 1 — subaccount to practice mapping"
```

---

### Task 10: Frontend — Step 2, pipeline to channel

The org has **113 pipelines across 7 subaccounts**, roughly half with no leads. A flat three-column board is unusable at that size, so this step groups by subaccount, sorts by lead count descending, and offers a search box and a zero-lead filter.

**Files:**
- Create: `frontend/features/ad-attribution/components/PipelineChannelStep.tsx`

**Interfaces:**
- Consumes: `useSetPipelineChannel`, types from `../api`.
- Produces: default-exported `PipelineChannelStep({ config }: { config: AdAttributionConfig })`.

- [ ] **Step 1: Write the component**

```tsx
'use client';
// Step 2 of ad attribution: put each pipeline in a channel.
//
// SCALE: this org has ~113 pipelines across 7 subaccounts and about half have
// no leads at all, so the list is grouped by subaccount, sorted by lead volume
// and filterable. A flat board would bury the pipelines that matter.
//
// NO INFERENCE: a pipeline with no channel is Unassigned and stays that way
// until somebody sets it. The old name-matching heuristic classified the three
// largest pipelines ("Open Day Archive - IMPLANTS" and friends, 1122/990/873
// leads) as 'other' while catching only the 33-lead pipeline that happened to
// have "Google" in its name.
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui';
import { useSetPipelineChannel } from '../hooks';
import type { AdAttributionConfig, AdChannel, PipelineRow } from '../api';

const CHANNEL_LABEL: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
  unassigned: 'Unassigned',
};

function ChannelButtons({ row, onSet, busy }: {
  row: PipelineRow;
  onSet: (channel: AdChannel | null) => void;
  busy: boolean;
}) {
  const options: Array<{ value: AdChannel | null; label: string }> = [
    { value: 'google_ads', label: 'Google' },
    { value: 'meta_ads', label: 'Facebook' },
    { value: null, label: 'Unassigned' },
  ];
  return (
    <span className="inline-flex overflow-hidden rounded border border-slate-300">
      {options.map((o) => {
        const active = (row.channel ?? null) === o.value;
        return (
          <button
            key={o.label}
            type="button"
            disabled={busy}
            onClick={() => onSet(o.value)}
            className={`px-2 py-1 text-[12px] ${
              active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

export default function PipelineChannelStep({ config }: { config: AdAttributionConfig }) {
  const setChannel = useSetPipelineChannel();
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byAccount = new Map<string, { label: string; practiceName: string | null; rows: PipelineRow[] }>();
    for (const p of config.pipelines) {
      if (hideEmpty && p.leadCount === 0 && p.channel === null) continue;
      if (q && !p.pipelineName.toLowerCase().includes(q)) continue;
      if (!byAccount.has(p.accountId)) {
        byAccount.set(p.accountId, { label: p.accountLabel, practiceName: p.practiceName, rows: [] });
      }
      byAccount.get(p.accountId)!.rows.push(p);
    }
    for (const g of byAccount.values()) g.rows.sort((a, b) => b.leadCount - a.leadCount);
    return [...byAccount.values()].sort(
      (a, b) => b.rows.reduce((n, r) => n + r.leadCount, 0) - a.rows.reduce((n, r) => n + r.leadCount, 0),
    );
  }, [config.pipelines, search, hideEmpty]);

  const counts = useMemo(() => {
    const c = { google_ads: 0, meta_ads: 0, unassigned: 0 };
    for (const p of config.pipelines) c[p.channel ?? 'unassigned'] += 1;
    return c;
  }, [config.pipelines]);

  async function handle(row: PipelineRow, channel: AdChannel | null) {
    const key = `${row.accountId}|${row.pipelineId}`;
    setBusy(key);
    try {
      await setChannel.mutateAsync([row.accountId, row.pipelineId, channel]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Step 2 — Sort pipelines into channels">
      <p className="mb-3 text-[13px] text-slate-600">
        Leads are counted as Google or Facebook based only on the pipeline they arrive in.
        Anything you leave unassigned is reported separately, never guessed at.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {(['google_ads', 'meta_ads', 'unassigned'] as const).map((c) => (
          <span key={c} className="text-[12px] text-slate-600">
            {CHANNEL_LABEL[c]}: <strong className="text-slate-900">{counts[c]}</strong>
          </span>
        ))}
        <input
          className="ml-auto rounded border border-slate-300 px-2 py-1 text-[13px]"
          placeholder="Search pipelines"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-1 text-[12px] text-slate-600">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide pipelines with no leads
        </label>
      </div>

      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <div className="mb-1 flex items-baseline gap-2">
            <h3 className="text-[13px] font-semibold text-slate-900">{g.label}</h3>
            <span className="text-[12px] text-slate-500">
              {g.practiceName ?? 'Not connected to a practice — excluded from ad performance'}
            </span>
          </div>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {g.rows.map((p) => (
                <tr key={`${p.accountId}|${p.pipelineId}`} className="border-b border-slate-100">
                  <td className="py-2 pr-3 text-slate-800">{p.pipelineName}</td>
                  <td className="py-2 pr-3 text-right text-slate-500">
                    {p.leadCount.toLocaleString('en-GB')} leads
                  </td>
                  <td className="py-2 text-right">
                    <ChannelButtons
                      row={p}
                      busy={busy === `${p.accountId}|${p.pipelineId}`}
                      onSet={(c) => handle(p, c)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {groups.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">No pipelines match that filter.</p>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add frontend/features/ad-attribution/components/PipelineChannelStep.tsx
git commit -m "feat(ads): settings step 2 — pipeline to channel, grouped and filterable"
```

---

### Task 11: Frontend — Step 3 and the settings page

**Files:**
- Create: `frontend/features/ad-attribution/components/AdAccountPracticeStep.tsx`, `frontend/features/ad-attribution/components/AdAttributionSettings.tsx`, `frontend/app/(dashboard)/settings/ad-attribution/page.tsx`

**Interfaces:**
- Consumes: `useAdAttributionConfig`, `useSetAdAccountPractice`, the two step components.
- Produces: default-exported `AdAttributionSettings()`; the route re-exports it.

- [ ] **Step 1: Write `AdAccountPracticeStep.tsx`**

```tsx
'use client';
// Step 3 of ad attribution: connect each ad account to a practice, so spend —
// and therefore cost per lead — can be reported below group level. Until this
// is done, per-practice cost per lead is reported as unknown rather than zero.
import { useState } from 'react';
import { Card } from '@/components/ui';
import { useSetAdAccountPractice } from '../hooks';
import type { AdAttributionConfig } from '../api';

const PROVIDER_LABEL: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
};

export default function AdAccountPracticeStep({ config }: { config: AdAttributionConfig }) {
  const setPractice = useSetAdAccountPractice();
  const [saving, setSaving] = useState<string | null>(null);

  async function handle(id: string, practiceId: string) {
    setSaving(id);
    try {
      await setPractice.mutateAsync([id, practiceId || null]);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card title="Step 3 — Connect ad accounts to practices">
      <p className="mb-3 text-[13px] text-slate-600">
        Spend from an unconnected ad account is still counted for the group, but it cannot be
        split by practice — those practices show cost per lead as unknown.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3 font-medium">Ad account</th>
              <th className="py-2 pr-3 font-medium">Channel</th>
              <th className="py-2 pr-3 font-medium" style={{ width: '32%' }}>Practice</th>
            </tr>
          </thead>
          <tbody>
            {config.adAccounts.map((a) => (
              <tr key={a.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  <div className="font-medium text-slate-900">{a.name ?? a.customerId}</div>
                  <div className="text-[11px] text-slate-400">{a.customerId}</div>
                </td>
                <td className="py-2 pr-3 text-slate-600">{PROVIDER_LABEL[a.provider] ?? a.provider}</td>
                <td className="py-2 pr-3">
                  <select
                    className="w-full rounded border border-slate-300 px-2 py-1 text-[13px]"
                    disabled={saving === a.id}
                    value={a.practiceId ?? ''}
                    onChange={(e) => handle(a.id, e.target.value)}
                  >
                    <option value="">Group only — do not split by practice</option>
                    {config.practices.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {config.adAccounts.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">
          No ad accounts connected yet. Connect Google Ads or Facebook Ads on the Integrations page first.
        </p>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Write `AdAttributionSettings.tsx`**

```tsx
'use client';
// Ad attribution settings — three ordered steps. The order matters: pipelines
// inherit their practice from the subaccount, and spend can only be split by
// practice once ad accounts are connected. Steps 2 and 3 are dimmed until at
// least one subaccount is connected so the operator is guided rather than
// confronted with three equal panels.
import { PageHeader } from '@/components/ui';
import { useAdAttributionConfig } from '../hooks';
import SubaccountPracticeStep from './SubaccountPracticeStep';
import PipelineChannelStep from './PipelineChannelStep';
import AdAccountPracticeStep from './AdAccountPracticeStep';

export default function AdAttributionSettings() {
  const { data, isLoading, error } = useAdAttributionConfig();

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (error || !data) {
    return <p className="p-6 text-sm text-slate-500">Could not load ad attribution settings.</p>;
  }

  const anyMapped = data.subaccounts.some((s) => s.practiceId !== null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ad attribution"
        subtitle="Tell Elevate which pipelines count as Google and Facebook leads, so cost per lead and conversions are measured against the right spend."
      />
      <SubaccountPracticeStep config={data} />
      <div className={anyMapped ? '' : 'pointer-events-none opacity-50'}>
        <PipelineChannelStep config={data} />
        <AdAccountPracticeStep config={data} />
      </div>
      {!anyMapped ? (
        <p className="text-[13px] text-slate-500">
          Connect at least one subaccount to a practice to continue.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Verify the `PageHeader` prop names**

Run: `cd frontend && sed -n '1,40p' components/ui/PageHeader.tsx`
Expected: confirm `title` and `subtitle`. Adjust if the real props differ.

- [ ] **Step 4: Write the route**

`frontend/app/(dashboard)/settings/ad-attribution/page.tsx`:

```tsx
export { default } from '@/features/ad-attribution/components/AdAttributionSettings';
```

- [ ] **Step 5: Typecheck, lint, build**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/features/ad-attribution/components frontend/app/\(dashboard\)/settings/ad-attribution
git commit -m "feat(ads): ad attribution settings page — three guided steps"
```

---

### Task 12: Frontend — performance API, hooks, and scorecard

**Files:**
- Create: `frontend/features/ad-performance/api.ts`, `frontend/features/ad-performance/hooks.ts`, `frontend/features/ad-performance/components/ChannelScorecard.tsx`

**Interfaces:**
- Consumes: `api`, `useScopePeriod` from `@/features/_shared/scope-context`.
- Produces: types `ChannelStats`, `PracticeChannels`, `AdPerformance`, `AdLeadLine`; hooks `useAdPerformance`, `useAdLeads`; component `ChannelScorecard`.

- [ ] **Step 1: Write `api.ts`**

```ts
import { api } from '@/lib/api';

export type PerfChannel = 'google_ads' | 'meta_ads' | 'unassigned';

export interface ChannelStats {
  channel: PerfChannel;
  leads: number;
  conversions: number;
  acceptedValuePence: number;
  /** null means unknown — no spend feed maps here. Never rendered as zero. */
  spendPence: number | null;
  costPerLeadPence: number | null;
  costPerAcquisitionPence: number | null;
  conversionRate: number | null;
}

export interface PracticeChannels {
  practiceId: string;
  practiceName: string | null;
  channels: ChannelStats[];
}

export interface AdPerformance {
  channels: ChannelStats[];
  byPractice: PracticeChannels[];
  /** Leads on a subaccount with no practice — deliberately excluded. */
  excludedUnmappedLeads: number;
  unmappedPipelineCount: number;
}

export interface AdLeadLine {
  id: string;
  contactId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  channel: PerfChannel;
  pipelineName: string | null;
  createdAt: string;
  converted: boolean;
  matchedTreatmentName: string | null;
  matchedValuePence: number;
}

export interface AdPerfParams {
  since: string;
  until: string;
  practiceId?: string;
}

export function fetchAdPerformance(p: AdPerfParams) {
  const sp = new URLSearchParams({ since: p.since, until: p.until });
  if (p.practiceId) sp.set('practice_id', p.practiceId);
  return api<AdPerformance>(`/api/ad-attribution/performance?${sp.toString()}`);
}

export function fetchAdLeads(p: AdPerfParams & { channel?: PerfChannel; limit?: number }) {
  const sp = new URLSearchParams({ since: p.since, until: p.until });
  if (p.practiceId) sp.set('practice_id', p.practiceId);
  if (p.channel) sp.set('channel', p.channel);
  sp.set('limit', String(p.limit ?? 500));
  return api<{ leads: AdLeadLine[] }>(`/api/ad-attribution/leads?${sp.toString()}`);
}
```

- [ ] **Step 2: Write `hooks.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchAdPerformance, fetchAdLeads, type AdPerfParams, type PerfChannel } from './api';

// Key includes the window and practice so it refetches when the shared
// ScopePeriod bar changes. The 'ad-performance' prefix is what the settings
// mutations invalidate, so a remap is reflected here immediately.
export function useAdPerformance(p: AdPerfParams) {
  return useQuery({
    queryKey: ['ad-performance', p.since, p.until, p.practiceId ?? ''],
    queryFn: () => fetchAdPerformance(p),
    staleTime: 30_000,
  });
}

export function useAdLeads(open: boolean, p: AdPerfParams & { channel?: PerfChannel }) {
  return useQuery({
    queryKey: ['ad-performance-leads', p.since, p.until, p.practiceId ?? '', p.channel ?? ''],
    queryFn: () => fetchAdLeads(p),
    enabled: open,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 3: Write `ChannelScorecard.tsx`**

```tsx
'use client';
// Google vs Facebook vs Unassigned, side by side.
//
// A null metric renders as "Not reporting", never as £0 or 0%. Zero would read
// as a real measurement — free leads, or a channel that converts nothing — when
// the truth is that no spend feed maps to it.
import { formatPence } from '@/lib/format';
import { Card } from '@/components/ui';
import type { ChannelStats, PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
  unassigned: 'Unassigned',
};

const money = (p: number | null) => (p === null ? 'Not reporting' : formatPence(p));
const pct = (r: number | null) => (r === null ? 'Not reporting' : `${(r * 100).toFixed(1)}%`);

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="py-1">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-[15px] font-semibold text-slate-900">{value}</div>
      {hint ? <div className="text-[11px] text-slate-400">{hint}</div> : null}
    </div>
  );
}

export function ChannelScorecard({
  channels, onDrill,
}: {
  channels: ChannelStats[];
  onDrill: (channel: PerfChannel) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {channels.map((c) => (
        <Card key={c.channel} title={LABEL[c.channel]}>
          <button
            type="button"
            onClick={() => onDrill(c.channel)}
            className="mb-2 text-left text-[24px] font-semibold text-slate-900 hover:underline"
          >
            {c.leads.toLocaleString('en-GB')}
            <span className="ml-1 text-[13px] font-normal text-slate-500">leads</span>
          </button>
          <Metric label="Spend" value={money(c.spendPence)} />
          <Metric label="Cost per lead" value={money(c.costPerLeadPence)} />
          <Metric
            label="Conversions"
            value={c.conversions.toLocaleString('en-GB')}
            hint="Matched to an accepted treatment in Emergent"
          />
          <Metric label="Conversion rate" value={pct(c.conversionRate)} />
          <Metric label="Cost per acquisition" value={money(c.costPerAcquisitionPence)} />
          <Metric label="Accepted value" value={formatPence(c.acceptedValuePence)} />
          {c.channel === 'unassigned' ? (
            <p className="mt-2 text-[11px] text-slate-400">
              These pipelines have no channel set, so no spend can be attributed to them.
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

```bash
git add frontend/features/ad-performance
git commit -m "feat(ads): ad performance api, hooks, channel scorecard"
```

---

### Task 13: Frontend — by-practice table, trend, drill-in, page

**Files:**
- Create: `frontend/features/ad-performance/components/ByPracticeTable.tsx`, `ChannelTrend.tsx`, `AdLeadsDrilldown.tsx`, `AdPerformanceScreen.tsx`
- Create: `frontend/app/(dashboard)/ad-performance/page.tsx`
- Modify: `frontend/lib/nav.ts`

**Interfaces:**
- Consumes: `useAdPerformance`, `useAdLeads`, `ChannelScorecard`, `useScopePeriod`, and `LeadsTable` + `dedupeByPerson` from `@/features/cockpit/components/LeadsTable`.
- Produces: default-exported `AdPerformanceScreen()`.

- [ ] **Step 1: Write `ByPracticeTable.tsx`**

```tsx
'use client';
// Same metrics as the scorecard, per practice. A practice with no mapped ad
// account shows spend and cost per lead as "Not reporting" rather than £0 —
// the same rule the rest of the product follows for a practice with no feed.
import { formatPence } from '@/lib/format';
import { Card } from '@/components/ui';
import type { PracticeChannels, PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google',
  meta_ads: 'Facebook',
  unassigned: 'Unassigned',
};
const money = (p: number | null) => (p === null ? 'Not reporting' : formatPence(p));

export function ByPracticeTable({ rows }: { rows: PracticeChannels[] }) {
  return (
    <Card title="By practice">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3 font-medium">Practice</th>
              <th className="py-2 pr-3 font-medium">Channel</th>
              <th className="py-2 pr-3 text-right font-medium">Leads</th>
              <th className="py-2 pr-3 text-right font-medium">Spend</th>
              <th className="py-2 pr-3 text-right font-medium">Cost per lead</th>
              <th className="py-2 pr-3 text-right font-medium">Conversions</th>
              <th className="py-2 pr-3 text-right font-medium">Accepted value</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((p) =>
              p.channels.map((c, i) => (
                <tr key={`${p.practiceId}|${c.channel}`} className="border-b border-slate-100">
                  <td className="py-2 pr-3 text-slate-900">{i === 0 ? (p.practiceName ?? '—') : ''}</td>
                  <td className="py-2 pr-3 text-slate-600">{LABEL[c.channel]}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{c.leads.toLocaleString('en-GB')}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{money(c.spendPence)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{money(c.costPerLeadPence)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{c.conversions.toLocaleString('en-GB')}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatPence(c.acceptedValuePence)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="py-3 text-sm text-slate-500">No practice data in this period.</p> : null}
    </Card>
  );
}
```

- [ ] **Step 2a: Add monthly trend to the backend service**

Trend is computed on the server, in the same pass as the scorecard, so it can never disagree with the totals above it. Firing one HTTP request per month from the browser would be both slower and free to drift.

In `backend/src/services/ad-attribution.service.js`, add a month helper beside `pipeKey`:

```js
// 'YYYY-MM' from an ISO timestamp or a YYYY-MM-DD date string.
const monthKey = (value) => String(value ?? '').slice(0, 7);
```

Add trend accumulation inside `computePerformance`. Declare it beside the other accumulators:

```js
    const trend = new Map();   // 'YYYY-MM' -> { google_ads: {...}, meta_ads: {...} }
    const trendSeen = new Map(); // `${month}|${channel}` -> Set(personKey)
    const trendStats = (month, channel) => {
        if (!trend.has(month)) {
            trend.set(month, new Map(AD_CHANNELS.map((c) => [c, emptyStats(c)])));
        }
        return trend.get(month).get(channel);
    };
```

Inside the lead loop, after `const matched = ...`, add:

```js
        // Trend covers the two paid channels only — an unassigned pipeline has
        // no spend, so a cost-per-lead line for it would be meaningless.
        if (AD_CHANNELS.includes(channel)) {
            const m = monthKey(lead.created_at);
            const tKey = `${m}|${channel}`;
            if (!trendSeen.has(tKey)) trendSeen.set(tKey, new Set());
            const tSeen = trendSeen.get(tKey);
            if (!tSeen.has(person)) {
                tSeen.add(person);
                const t = trendStats(m, channel);
                t.leads += 1;
                if (matched) { t.conversions += 1; t.acceptedValuePence += matched.valuePence; }
            }
        }
```

Inside the spend loop, after the group accumulation, add:

```js
        const m = monthKey(row.metric_date);
        const t = trendStats(m, row.provider);
        t.spendPence += row.spend_pence || 0;
        t._hasSpend = true;
```

And add `trend` to the returned object:

```js
        trend: [...trend.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([month, chans]) => ({
                month,
                channels: AD_CHANNELS.map((c) => finalise(chans.get(c), { allowSpend: true })),
            })),
```

Thread it through `getPerformance`'s return value as `trend: result.trend`.

- [ ] **Step 2b: Add a test for the trend buckets**

Append to `backend/test/ad-attribution.service.test.mjs`:

```js
describe('computePerformance trend', () => {
  const accountPractice = new Map([['acc1', 'p1']]);
  const channelMap = new Map([['acc1|g', 'google_ads']]);

  it('buckets leads and spend by month and dedupes per person within a month', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-06-10T09:00:00Z', contacts: {} },
      { id: 'l2', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-06-20T09:00:00Z', contacts: {} },
      { id: 'l3', contact_id: 'c2', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-05T09:00:00Z', contacts: {} },
    ];
    const spend = [
      { provider: 'google_ads', practice_id: 'p1', spend_pence: 60000, metric_date: '2026-06-15' },
      { provider: 'google_ads', practice_id: 'p1', spend_pence: 20000, metric_date: '2026-07-02' },
    ];
    const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });
    expect(out.trend.map((t) => t.month)).toEqual(['2026-06', '2026-07']);
    const june = out.trend[0].channels.find((c) => c.channel === 'google_ads');
    // c1 appears twice in June — one person, one lead.
    expect(june.leads).toBe(1);
    expect(june.costPerLeadPence).toBe(60000);
  });

  it('reports a month with spend but no leads as an unknown cost per lead', () => {
    const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 50000, metric_date: '2026-06-15' }];
    const out = computePerformance({ leads: [], accepted: [], spend, channelMap, accountPractice });
    const june = out.trend[0].channels.find((c) => c.channel === 'google_ads');
    expect(june.leads).toBe(0);
    // Spending with nothing to show for it must not render as a £0 cost per lead.
    expect(june.costPerLeadPence).toBeNull();
  });
});
```

Run: `cd backend && npx vitest run test/ad-attribution.service.test.mjs`
Expected: PASS.

- [ ] **Step 2c: Add the trend type to `frontend/features/ad-performance/api.ts`**

```ts
export interface TrendMonth {
  month: string;            // 'YYYY-MM'
  channels: ChannelStats[]; // google_ads and meta_ads only
}
```

Add `trend: TrendMonth[];` to `AdPerformance`.

- [ ] **Step 2d: Write `ChannelTrend.tsx`**

```tsx
'use client';
// Cost per lead and lead volume by month, per channel. The points come from the
// same server-side computation as the scorecard, so the trend can never
// disagree with the totals above it.
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import { Card } from '@/components/ui';

import type { TrendMonth } from '../api';

interface Point {
  month: string;
  googleLeads: number;
  facebookLeads: number;
  googleCpl: number | null;
  facebookCpl: number | null;
}

// Pence -> pounds for the axis; a null cost per lead becomes a gap in the line
// rather than a plotted zero, which would read as "leads became free".
function toPoints(trend: TrendMonth[]): Point[] {
  return trend.map((t) => {
    const g = t.channels.find((c) => c.channel === 'google_ads');
    const f = t.channels.find((c) => c.channel === 'meta_ads');
    const [y, m] = t.month.split('-');
    const label = new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return {
      month: label,
      googleLeads: g?.leads ?? 0,
      facebookLeads: f?.leads ?? 0,
      googleCpl: g?.costPerLeadPence == null ? null : g.costPerLeadPence / 100,
      facebookCpl: f?.costPerLeadPence == null ? null : f.costPerLeadPence / 100,
    };
  });
}

export function ChannelTrend({ trend }: { trend: TrendMonth[] }) {
  const points = toPoints(trend);
  return (
    <Card title="Trend">
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="leads" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="cpl" orientation="right" tick={{ fontSize: 12 }}
                   tickFormatter={(v) => `£${v}`} />
            <Tooltip formatter={(v, name) => (String(name).includes('cost') ? `£${v}` : v)} />
            <Legend />
            <Line yAxisId="leads" type="monotone" dataKey="googleLeads" name="Google leads" stroke="#0f766e" dot={false} />
            <Line yAxisId="leads" type="monotone" dataKey="facebookLeads" name="Facebook leads" stroke="#1d4ed8" dot={false} />
            <Line yAxisId="cpl" type="monotone" dataKey="googleCpl" name="Google cost per lead"
                  stroke="#0f766e" strokeDasharray="4 3" dot={false} connectNulls={false} />
            <Line yAxisId="cpl" type="monotone" dataKey="facebookCpl" name="Facebook cost per lead"
                  stroke="#1d4ed8" strokeDasharray="4 3" dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {points.length === 0 ? <p className="py-3 text-sm text-slate-500">Not enough history to plot a trend.</p> : null}
    </Card>
  );
}
```

- [ ] **Step 3: Write `AdLeadsDrilldown.tsx`**

```tsx
'use client';
// The people behind a number. Reuses the cockpit's LeadsTable so a lead is
// presented identically wherever it appears — the shared leads-table standard.
// The table's channel type is the cockpit's display vocabulary, so the ad
// channel is adapted to it here rather than forking the component.
import { LeadsTable, type LeadRow } from '@/features/cockpit/components/LeadsTable';
import type { LeadChannel } from '@/features/cockpit/api';
import type { AdLeadLine, PerfChannel } from '../api';

const TO_DISPLAY: Record<PerfChannel, LeadChannel> = {
  google_ads: 'google',
  meta_ads: 'facebook',
  unassigned: 'other',
};

export function AdLeadsDrilldown({ lines }: { lines: AdLeadLine[] }) {
  const rows: LeadRow[] = lines.map((l) => ({
    id: l.id,
    contactId: l.contactId,
    name: l.name,
    email: l.email,
    phone: l.phone,
    channel: TO_DISPLAY[l.channel],
    pipelineName: l.pipelineName,
    createdAt: l.createdAt,
    converted: l.converted,
    matchedTreatmentName: l.matchedTreatmentName,
    matchedValuePence: l.matchedValuePence,
    alsoIn: [],
  })) as LeadRow[];
  return <LeadsTable rows={rows} />;
}
```

If `LeadRow` requires fields not listed above, add them with the same values the backend supplies; do not modify `LeadsTable.tsx`.

- [ ] **Step 4: Write `AdPerformanceScreen.tsx`**

```tsx
'use client';
// Ad performance — Google vs Facebook, measured against explicitly mapped
// pipelines. Uses the shared ScopePeriod window and practice scope so it
// agrees with every other analytics screen.
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useAdPerformance, useAdLeads } from '../hooks';
import { ChannelScorecard } from './ChannelScorecard';
import { ByPracticeTable } from './ByPracticeTable';
import { ChannelTrend } from './ChannelTrend';
import { AdLeadsDrilldown } from './AdLeadsDrilldown';
import type { PerfChannel } from '../api';

export default function AdPerformanceScreen() {
  const sp = useScopePeriod();
  const practiceId = sp.scope === 'all' ? undefined : sp.scope;
  const params = useMemo(
    () => ({ since: sp.win.since, until: sp.win.until, practiceId }),
    [sp.win.since, sp.win.until, practiceId],
  );

  const { data, isLoading, error } = useAdPerformance(params);
  const [drill, setDrill] = useState<PerfChannel | null>(null);
  const leads = useAdLeads(drill !== null, { ...params, channel: drill ?? undefined });

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (error || !data) return <p className="p-6 text-sm text-slate-500">Could not load ad performance.</p>;

  const nothingMapped = data.channels.every((c) => c.channel === 'unassigned' || c.leads === 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ad performance"
        subtitle="Google and Facebook leads, cost per lead and conversions, from the pipelines you have mapped to each channel."
      />

      {nothingMapped ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          No pipelines are assigned to a channel yet, so there is nothing to report.{' '}
          <a className="underline" href="/settings/ad-attribution">Set up ad attribution</a>.
        </div>
      ) : null}

      <ChannelScorecard channels={data.channels} onDrill={(c) => setDrill(c === drill ? null : c)} />

      {drill !== null ? (
        <div className="rounded border border-slate-200 p-3">
          {leads.isLoading ? (
            <p className="text-sm text-slate-500">Loading leads…</p>
          ) : (
            <AdLeadsDrilldown lines={leads.data?.leads ?? []} />
          )}
        </div>
      ) : null}

      <ByPracticeTable rows={data.byPractice} />

      <ChannelTrend trend={data.trend} />

      {data.unmappedPipelineCount > 0 || data.excludedUnmappedLeads > 0 ? (
        <p className="text-[12px] text-slate-500">
          {data.unmappedPipelineCount} pipeline(s) have no channel set.{' '}
          {data.excludedUnmappedLeads.toLocaleString('en-GB')} lead(s) are on subaccounts not
          connected to a practice and are excluded.{' '}
          <a className="underline" href="/settings/ad-attribution">Review ad attribution</a>.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Write the route and add nav**

`frontend/app/(dashboard)/ad-performance/page.tsx`:

```tsx
export { default } from '@/features/ad-performance/components/AdPerformanceScreen';
```

In `frontend/lib/nav.ts`, add to the `Growth` section's `items`, after `marketing`:

```ts
    { id: 'ad-performance', label: 'Ad Performance', isNew: true },
```

- [ ] **Step 6: Typecheck, lint, build**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/features/ad-performance frontend/app/\(dashboard\)/ad-performance frontend/lib/nav.ts
git commit -m "feat(ads): /ad-performance page — scorecard, by-practice, trend, lead drill-in"
```

---

### Task 14: Docs, hosted migration, and verification

**Files:**
- Modify: `docs/API.md`, `docs/FORMULAS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Document the endpoints in `docs/API.md`**

Add a section matching the file's existing format:

```markdown
### Ad attribution

All routes require role `owner` or `practice_manager`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/ad-attribution/config` | Subaccounts, pipelines, ad accounts and practices for the settings screen |
| PUT | `/api/ad-attribution/pipelines/:accountId/:pipelineId` | Set a pipeline's channel. Body `{ channel: 'google_ads' \| 'meta_ads' \| null }`; null clears it |
| PATCH | `/api/ad-attribution/subaccounts/:id` | Connect a GHL subaccount to a practice. Body `{ practice_id }` |
| PATCH | `/api/ad-attribution/ad-accounts/:id` | Connect an ad account to a practice. Body `{ practice_id }` |
| GET | `/api/ad-attribution/performance` | `?since&until&practice_id` — channel scorecard and per-practice breakdown |
| GET | `/api/ad-attribution/leads` | `?since&until&channel&practice_id&limit` — the people behind a number |
```

- [ ] **Step 2: Document the formulas in `docs/FORMULAS.md`**

```markdown
### Ad channel attribution

A lead's channel is taken from the explicit pipeline mapping in
`ad_channel_pipelines`. It is never inferred from the pipeline's name. A
pipeline with no mapping is reported in a separate "Unassigned" bucket.

A lead's practice is taken from the GoHighLevel subaccount it arrived on. Leads
on a subaccount with no practice are excluded entirely.

Leads are counted **per person** (`contact_id`, falling back to the lead id),
not per opportunity row, so one person in two pipelines is one lead.

A lead is a **conversion** when it matches a row in `treatment_accepted` by
phone, then email, then practice-scoped name (`lib/lead-emergent-match.js`).

- `cost per lead = spend_pence / leads`
- `cost per acquisition = spend_pence / conversions`
- `conversion rate = conversions / leads`

Each is **null** when its denominator is zero — never zero and never infinity.
Spend is null for the Unassigned bucket and for any practice with no mapped ad
account; the UI renders null as "Not reporting", never as £0.
```

- [ ] **Step 3: Run the full verification sweep**

Run: `cd backend && npm run typecheck && npm run lint && npm test`
Expected: all pass, including every pre-existing test.

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 4: Apply the migration on hosted**

Apply `20260101000114_ad_channel_pipelines.sql` to Supabase project `mkfhpzjbijbachoonytt` via the Supabase MCP `apply_migration`, then run:

```sql
NOTIFY pgrst, 'reload schema';
```

Verify with:

```sql
select column_name, data_type from information_schema.columns
where table_name = 'ad_channel_pipelines' order by ordinal_position;
```

Expected: the eight columns from Task 1.

- [ ] **Step 5: Commit**

```bash
git add docs/API.md docs/FORMULAS.md
git commit -m "docs(ads): ad attribution endpoints and formulas"
```

---

## Post-implementation notes

Carry these forward; they are known and intentional, not defects.

- **The Cockpit and this page will report different lead counts.** The Cockpit's `newLeads` sums `emergent_daily_cashup.num_new_leads`, a manager-entered daily count with no underlying records. This page counts matched GHL lead rows. Neither is wrong; they measure different things.
- **The Cockpit still uses the `classifyChannel` regex.** Merging the two surfaces onto the explicit map is a deliberate follow-up, not part of this work.
- **Name matching is the weakest tier** and can produce false positives on common names. Inherited from existing behaviour, scoped to a practice to limit it.
- **Five of seven live GHL subaccounts report `status: 'failed'`.** That is a connection problem independent of this feature, but it will limit how fresh the pipeline list is.
- **Live ad spend for some accounts lands in the developer organisation**, so the Plan4growth ad feed may read empty until the owner reconnects those accounts under the correct organisation.
