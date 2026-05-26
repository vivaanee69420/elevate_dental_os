# Associates from Dentally Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock `ASSOCIATES` roster with real data — extend the Dentally sync to pull `/practitioners`, create/map `associates` rows, link `practitioner_id` onto synced appointments, and serve per-associate appointment volume / treatments / completion / no-show via `GET /api/associates`. Production / UDA / conversion are not in the Dentally feed and render `—`.

**Architecture:** A new `pms_external_id` column on `associates` keys the practitioner↔associate map (built like the existing site/contact maps). `appointmentRow()` gains a `practitionerMap` arg to set `associate_id`. A new `associate_appointment_stats` RPC (with a JS fallback, mirroring `auth_bootstrap`) groups appointment counts; the associate service merges roster + stats and bands a status. Frontend `AssociatesScreen.tsx` fetches the merged data.

**Tech Stack:** Express (native ESM), Zod, Supabase (`serviceClient` + manual `organisation_id` filter, RPC), vitest, Next.js 14 + React Query.

**Reference:** spec `docs/superpowers/specs/2026-05-26-chair-utilisation-dentally-design.md` (Track B). Sync internals: `backend/src/lib/integrations/dentally-sync.js`.

> **Sequencing note:** the appointment→associate link only populates on appointments synced AFTER the sync change ships. There is no historical practitioner id stored on already-synced rows, so a full re-sync (existing "full history" button) is needed to backfill `associate_id`. No fake historical data is created.

---

### Task 1: Migration — associate Dentally link + stats RPC

**Files:**
- Create: `supabase/migrations/20260101000024_associate_dentally.sql`
- Modify: `db/01_schema.sql` (add the column + index to the `associates` table block)

- [ ] **Step 1: Write the migration**

```sql
-- 20260101000024_associate_dentally.sql
-- Link Dentally practitioners to associates + per-associate appointment stats.
-- Idempotent.

ALTER TABLE associates ADD COLUMN IF NOT EXISTS pms_external_id TEXT;

-- Non-partial unique index: Postgres treats NULLs as distinct, so existing
-- manually-created associates (null pms id) remain valid and many can coexist.
-- Also serves as the ON CONFLICT arbiter for the sync upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_associates_org_pms
  ON associates(organisation_id, pms_external_id);

-- Per-associate appointment rollup over a rolling window. Mirrors
-- appointments_rollup_by_practice. serviceClient (service_role) calls it; grant
-- to authenticated too for parity with the other analytics RPCs.
CREATE OR REPLACE FUNCTION associate_appointment_stats(p_org uuid, p_since timestamptz)
RETURNS TABLE(associate_id uuid, total bigint, completed bigint, no_shows bigint)
LANGUAGE sql STABLE AS $$
  SELECT a.associate_id,
         count(*)                                          AS total,
         count(*) FILTER (WHERE a.status = 'completed')    AS completed,
         count(*) FILTER (WHERE a.status = 'no_show')      AS no_shows
  FROM appointments a
  WHERE a.organisation_id = p_org
    AND a.associate_id IS NOT NULL
    AND a.starts_at >= p_since
  GROUP BY a.associate_id;
$$;

GRANT EXECUTE ON FUNCTION associate_appointment_stats(uuid, timestamptz) TO authenticated, service_role;
```

- [ ] **Step 2: Mirror into `db/01_schema.sql`** — add `pms_external_id TEXT` to the `CREATE TABLE associates (...)` block and add the `uq_associates_org_pms` unique index next to the existing associate indexes.

- [ ] **Step 3: Apply locally**

Run: `cd /Users/ruhithpasha/code/work/Dental-os && supabase db reset`
Expected: migrations `000001`→`000024` apply with no error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000024_associate_dentally.sql db/01_schema.sql
git commit -m "feat(db): associate pms_external_id link + associate_appointment_stats RPC"
```

> After hosted apply: `NOTIFY pgrst, 'reload schema';`.

---

### Task 2: Dentally sync — practitioner row mapper + appointment link (TDD)

**Files:**
- Modify: `backend/src/lib/integrations/dentally-sync.js`
- Test: `backend/test/dentally-associates.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// Dentally sync — practitioner mapper + appointment->associate linkage.
import { describe, it, expect } from 'vitest';
import './setup.js';
import { practitionerRow, appointmentRow } from '../src/lib/integrations/dentally-sync.js';

const ORG = 'org-aaaaaaaa';
const siteMap = new Map([['7', 'prac-7']]);

describe('practitionerRow', () => {
    it('maps a Dentally practitioner to an associate upsert row', () => {
        const row = practitionerRow(ORG, { id: 55, first_name: 'Sarah', last_name: 'Mitchell', email_address: 's@x.co', site_id: 7 }, siteMap);
        expect(row).toMatchObject({
            organisation_id: ORG,
            pms_external_id: '55',
            full_name: 'Sarah Mitchell',
            email: 's@x.co',
            primary_practice_id: 'prac-7',
            active: true,
        });
    });
    it('falls back to a name when only an id is present, and null practice for unmapped site', () => {
        const row = practitionerRow(ORG, { id: 9, site_id: 999 }, siteMap);
        expect(row.full_name).toBe('Practitioner 9');
        expect(row.primary_practice_id).toBeNull();
    });
});

describe('appointmentRow practitioner linkage', () => {
    const contactMap = new Map();
    const base = { id: 1, practitioner_site_id: 7, start_time: '2026-05-01T09:00:00Z', finish_time: '2026-05-01T09:30:00Z', state: 'confirmed' };
    it('sets associate_id from the practitioner map', () => {
        const pmap = new Map([['55', 'assoc-55']]);
        const row = appointmentRow(ORG, { ...base, practitioner_id: 55 }, siteMap, contactMap, pmap);
        expect(row.associate_id).toBe('assoc-55');
    });
    it('null associate_id when practitioner is unmapped or absent', () => {
        const pmap = new Map([['55', 'assoc-55']]);
        expect(appointmentRow(ORG, { ...base, practitioner_id: 999 }, siteMap, contactMap, pmap).associate_id).toBeNull();
        expect(appointmentRow(ORG, base, siteMap, contactMap, pmap).associate_id).toBeNull();
    });
    it('still works with no practitionerMap arg (webhook/back-compat)', () => {
        const row = appointmentRow(ORG, { ...base, practitioner_id: 55 }, siteMap, contactMap);
        expect(row.associate_id).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/dentally-associates.test.mjs`
Expected: FAIL — `practitionerRow` is not exported; `appointmentRow` has no `associate_id`.

- [ ] **Step 3: Add `practitionerRow` and a practitioner-map loader** to `dentally-sync.js`. Place `practitionerRow` next to `patientRow` (after line ~327):

```js
export function practitionerRow(orgId, p, siteMap) {
    const name = p.name
        || [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
        || `Practitioner ${p.id}`;
    return {
        organisation_id: orgId,
        pms_external_id: String(p.id),
        full_name: name,
        email: p.email_address ?? p.email ?? null,
        primary_practice_id: siteMap.get(String(p.site_id)) ?? null,
        active: p.active !== false,
    };
}
```

Add a map loader next to `loadSiteMap` (after line ~284):

```js
// Build { dentally practitioner id -> associates.id } for an org so appointments
// resolve an associate_id. Populated by pullPractitioners before the appointment pull.
async function loadPractitionerMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('associates')
        .select('id, pms_external_id')
        .eq('organisation_id', orgId)
        .not('pms_external_id', 'is', null);
    const map = new Map();
    for (const a of data ?? []) map.set(String(a.pms_external_id), a.id);
    return map;
}
```

- [ ] **Step 4: Add the `associate_id` link to `appointmentRow`** — change its signature and add the field (modify lines ~329-355):

```js
export function appointmentRow(orgId, a, siteMap, contactMap, practitionerMap = new Map()) {
    const practiceId = siteMap.get(String(a.practitioner_site_id ?? a.site_id));
    if (!practiceId) return null;
    const startsAt = a.start_time ?? a.start ?? null;
    if (!startsAt) return null;
    return {
        organisation_id: orgId,
        source: 'dentally',
        pms_external_id: String(a.id),
        pms_patient_id: a.patient_id != null ? String(a.patient_id) : null,
        practice_id: practiceId,
        contact_id: contactMap.get(String(a.patient_id)) ?? null,
        // Dentally appointments carry a practitioner_id; resolve it to an
        // associate (null if the practitioner hasn't been pulled/mapped yet).
        // Verify the field name against the sandbox during UAT.
        associate_id: practitionerMap.get(String(a.practitioner_id)) ?? null,
        starts_at: startsAt,
        ends_at: a.finish_time ?? a.finish ?? a.end_time ?? startsAt,
        status: mapAppointmentStatus(a.state ?? a.status),
    };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run test/dentally-associates.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the existing Dentally tests (no regressions)**

Run: `cd backend && npx vitest run test/dentally-sync.test.mjs test/dentally-webhook.test.mjs`
Expected: PASS (the new `associate_id` field and optional 5th arg don't break existing assertions).

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/integrations/dentally-sync.js backend/test/dentally-associates.test.mjs
git commit -m "feat(dentally): practitionerRow + link appointment.associate_id via practitioner map"
```

---

### Task 3: Dentally sync — pull practitioners + wire into orchestration

**Files:**
- Modify: `backend/src/lib/integrations/dentally-sync.js`

- [ ] **Step 1: Add `pullPractitioners`** next to `pullPatients` (after line ~381):

```js
async function pullPractitioners(orgId, base, auth, params, siteMap, maxPages) {
    const remote = await fetchAllPages(base, '/practitioners', auth, params, null, maxPages);
    const rows = remote
        .filter((p) => p && p.id != null)
        .map((p) => practitionerRow(orgId, p, siteMap));
    // Upsert on the new (organisation_id, pms_external_id) arbiter. pay_pct /
    // lab_split_pct are NOT in the payload, so owner-set values are preserved.
    const synced = await upsertChunked('associates', rows, 'organisation_id,pms_external_id');
    return { synced };
}
```

- [ ] **Step 2: Wire it into `syncOneOrg`** — after `const siteMap = await loadSiteMap(orgId);` (line ~517) and before `pullPatients`, pull practitioners and build the map; thread the map into the appointment pull:

```js
        const siteMap = await loadSiteMap(orgId);
        // Practitioners first (cheap, no separate progress phase) so the
        // appointment pull can resolve associate_id. /practitioners has no date
        // filter requirement; pull the full list.
        let practitioners = { synced: 0 };
        try {
            practitioners = await pullPractitioners(orgId, base, auth, {}, siteMap, maxPages);
        } catch (err) {
            console.warn(`[dentally] practitioners pull skipped: ${err?.message || err}`);
        }
        const practitionerMap = await loadPractitionerMap(orgId);
        // Patients first so appointment/payment contact resolution sees fresh ids.
        const patients = await pullPatients(orgId, base, auth, patientParams, siteMap, reporter(0), maxPages);
        const contactMap = await loadContactMap(orgId);
        const appts = await pullAppointments(orgId, base, auth, apptParams, siteMap, contactMap, reporter(1), maxPages, { openOnly: openAppointments, practitionerMap });
```

(The remaining `pullPayments` + relink + bookkeeping lines stay unchanged.) Add `practitioners: practitioners.synced` to the returned result object.

- [ ] **Step 3: Update `pullAppointments` to accept + pass `practitionerMap`** (modify lines ~391-405):

```js
async function pullAppointments(orgId, base, auth, params, siteMap, contactMap, onPage, maxPages, { openOnly = false, practitionerMap = new Map() } = {}) {
    const remote = await fetchAllPages(base, '/appointments', auth, params, onPage, maxPages);
    const now = Date.now();
    const rows = [];
    let skipped = 0;
    let skippedClosed = 0;
    for (const a of remote) {
        const row = appointmentRow(orgId, a, siteMap, contactMap, practitionerMap);
        if (!row) { skipped++; continue; }
        if (openOnly && !isOpenAppointment(row, now)) { skippedClosed++; continue; }
        rows.push(row);
    }
    const synced = await upsertChunked('appointments', rows, 'organisation_id,source,pms_external_id');
    return { synced, skipped, skippedClosed };
}
```

- [ ] **Step 4: Update the webhook path** — in `applyWebhookEvent`, the `appointment` branch must build the practitioner map so a webhook-delivered appointment also links its associate (modify lines ~432-438):

```js
    const contactMap = await loadContactMap(orgId);
    if (resourceType === 'appointment') {
        const practitionerMap = await loadPractitionerMap(orgId);
        const row = appointmentRow(orgId, record, siteMap, contactMap, practitionerMap);
        if (!row) return { skipped: 'unmatched_practice' };
        await upsertChunked('appointments', [row], 'organisation_id,source,pms_external_id');
        return { table: 'appointments', applied: 1 };
    }
```

- [ ] **Step 5: Syntax check + run Dentally tests**

Run: `cd backend && node --check src/lib/integrations/dentally-sync.js && npx vitest run test/dentally-sync.test.mjs test/dentally-associates.test.mjs test/dentally-webhook.test.mjs`
Expected: no syntax errors; all listed tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/integrations/dentally-sync.js
git commit -m "feat(dentally): pull /practitioners + link associates in poll and webhook"
```

---

### Task 4: Associate status banding (pure) + test

**Files:**
- Create: `backend/src/lib/associate-status.js`
- Test: `backend/test/associate-status.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { associateStatus } from '../src/lib/associate-status.js';

describe('associateStatus', () => {
    it('no recent activity -> review', () => {
        expect(associateStatus({ completionPct: null, total: 0 })).toBe('review');
    });
    it('high completion + high volume -> top', () => {
        expect(associateStatus({ completionPct: 90, total: 60 })).toBe('top');
    });
    it('low completion or low volume -> review', () => {
        expect(associateStatus({ completionPct: 60, total: 50 })).toBe('review');
        expect(associateStatus({ completionPct: 95, total: 10 })).toBe('review');
    });
    it('middle -> good', () => {
        expect(associateStatus({ completionPct: 80, total: 30 })).toBe('good');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/associate-status.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// ============================================================================
// Associate status banding — derives a top/good/review band from recent
// appointment completion rate and volume. Pure; unit-tested.
// ============================================================================
export function associateStatus({ completionPct, total }) {
    if (!total) return 'review';                              // no recent activity
    if (completionPct != null && completionPct >= 85 && total >= 40) return 'top';
    if ((completionPct != null && completionPct < 70) || total < 20) return 'review';
    return 'good';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/associate-status.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/associate-status.js backend/test/associate-status.test.mjs
git commit -m "feat(associates): pure status banding + tests"
```

---

### Task 5: Associate model

**Files:**
- Create: `backend/src/models/associate.model.js`

- [ ] **Step 1: Write the model**

```js
// ============================================================================
// Associate model — Zod query schema for the associates roster endpoint.
// ============================================================================
import * as zod_1 from "zod";

export const associateListQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
    // TTM window for the appointment stats; default 52 weeks, cap 104.
    weeks: zod_1.z.coerce.number().int().min(1).max(104).optional().default(52),
});
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/models/associate.model.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/associate.model.js
git commit -m "feat(associates): Zod list-query model"
```

---

### Task 6: Associate repository (roster + stats with RPC fallback)

**Files:**
- Create: `backend/src/repositories/associate.repository.js`

- [ ] **Step 1: Write the repository**

```js
// ============================================================================
// Associate repository — roster rows + per-associate appointment stats.
// serviceClient bypasses RLS, so every query carries the org filter. The stats
// method prefers the associate_appointment_stats RPC and falls back to a
// JS-side grouping if the RPC is absent (mirrors the auth_bootstrap pattern).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const associateRepository = {
    async list(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('associates')
            .select('id, full_name, pay_pct, joined_date, active, primary_practice_id, practice:practices!associates_primary_practice_id_fkey(name)')
            .eq('organisation_id', orgId)
            .order('full_name', { ascending: true });
        if (practiceId) query = query.eq('primary_practice_id', practiceId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async appointmentStatsByAssociate(orgId, since) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('associate_appointment_stats', { p_org: orgId, p_since: since });
        if (!error && Array.isArray(data)) {
            const map = new Map();
            for (const r of data) {
                map.set(r.associate_id, { total: Number(r.total), completed: Number(r.completed), no_shows: Number(r.no_shows) });
            }
            return map;
        }
        return this._statsFallback(orgId, since);
    },

    // Fallback: page through appointments and group in JS (RPC not present).
    async _statsFallback(orgId, since) {
        const map = new Map();
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase_1.serviceClient
                .from('appointments')
                .select('associate_id, status')
                .eq('organisation_id', orgId)
                .not('associate_id', 'is', null)
                .gte('starts_at', since)
                .range(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            const rows = data ?? [];
            for (const r of rows) {
                const cur = map.get(r.associate_id) ?? { total: 0, completed: 0, no_shows: 0 };
                cur.total++;
                if (r.status === 'completed') cur.completed++;
                if (r.status === 'no_show') cur.no_shows++;
                map.set(r.associate_id, cur);
            }
            if (rows.length < PAGE) break;
        }
        return map;
    },
};
```

> The `practice:practices!associates_primary_practice_id_fkey(name)` embed names the FK explicitly (the `associates.primary_practice_id → practices.id` constraint) so PostgREST resolves the join unambiguously. If a different generated constraint name surfaces during `supabase db reset`, use the name shown in `\d associates`.

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/repositories/associate.repository.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend/src/repositories/associate.repository.js
git commit -m "feat(associates): repository (roster + stats RPC w/ JS fallback)"
```

---

### Task 7: Associate service + isolation/merge test

**Files:**
- Create: `backend/src/services/associate.service.js`
- Test: `backend/test/associate.service.test.mjs`

- [ ] **Step 1: Write the service**

```js
// ============================================================================
// Associate service — merges the roster with appointment stats and bands a
// status. Production / UDA / conversion are not in the Dentally feed -> null.
// ============================================================================
import { associateRepository } from "../repositories/associate.repository.js";
import { associateStatus } from "../lib/associate-status.js";

export const associateService = {
    async list(orgId, { practice_id, weeks }) {
        const since = new Date(Date.now() - (weeks ?? 52) * 7 * 86400000).toISOString();
        const [roster, stats] = await Promise.all([
            associateRepository.list(orgId, practice_id),
            associateRepository.appointmentStatsByAssociate(orgId, since),
        ]);
        return roster.map((a) => {
            const s = stats.get(a.id) ?? { total: 0, completed: 0, no_shows: 0 };
            const completion_pct = s.total ? Math.round((100 * s.completed) / s.total) : null;
            const no_show_pct = s.total ? Math.round((100 * s.no_shows) / s.total) : null;
            return {
                id: a.id,
                full_name: a.full_name,
                practice: a.practice?.name ?? null,
                pay_pct: a.pay_pct != null ? a.pay_pct / 100 : null, // basis points -> %
                joined_date: a.joined_date ?? null,
                active: a.active !== false,
                treatments: s.completed,
                appointments_total: s.total,
                no_shows: s.no_shows,
                completion_pct,
                no_show_pct,
                status: associateStatus({ completionPct: completion_pct, total: s.total }),
                // Not available from Dentally:
                ttm_production: null,
                ttm_uda: null,
                conversion: null,
            };
        });
    },
};
```

- [ ] **Step 2: Write the test**

```js
// Associate service — org-scoping + roster/stats merge.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/associate.service.js')).associateService;

const ORG = 'org-aaaaaaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('associateService.list', () => {
    it('filters associates by organisation_id and merges stats', async () => {
        // roster query returns one associate; stats RPC returns its counts.
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Dr A', pay_pct: 4500, joined_date: '2022-01-01', active: true, practice: { name: 'Ashford' } }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = (fn) =>
            fn === 'associate_appointment_stats'
                ? { data: [{ associate_id: 'a1', total: 50, completed: 45, no_shows: 2 }], error: null }
                : { data: null, error: { message: 'unstubbed' } };

        const rows = await svc.list(ORG, { weeks: 52 });
        expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
        expect(rows[0]).toMatchObject({
            id: 'a1', full_name: 'Dr A', practice: 'Ashford', pay_pct: 45,
            treatments: 45, appointments_total: 50, no_shows: 2,
            completion_pct: 90, no_show_pct: 4, status: 'top',
            ttm_production: null, ttm_uda: null, conversion: null,
        });
    });

    it('associate with no appointments -> zeros and review status', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a2', full_name: 'Dr B', pay_pct: 5000, active: true, practice: null }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const rows = await svc.list(ORG, { weeks: 52 });
        expect(rows[0]).toMatchObject({ treatments: 0, appointments_total: 0, completion_pct: null, status: 'review' });
    });
});
```

> If `test/setup.js`'s fake doesn't yet route `resultProvider` by table for the embedded select, assert on the merged output shape and the recorded org filter only; the existing analytics tests use the same `supaRec` shape, so `resultProvider(q)` receiving the query is already supported.

- [ ] **Step 3: Run the test**

Run: `cd backend && npx vitest run test/associate.service.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/associate.service.js backend/test/associate.service.test.mjs
git commit -m "feat(associates): service merges roster + stats + status; isolation test"
```

---

### Task 8: Associate controller + routes + mount

**Files:**
- Create: `backend/src/controllers/associate.controller.js`
- Create: `backend/src/routes/associate.routes.js`
- Modify: `backend/src/app.js`

- [ ] **Step 1: Write the controller**

```js
import { associateService } from "../services/associate.service.js";
import { associateListQuerySchema } from "../models/associate.model.js";

export const associateController = {
    async list(req, res) {
        const q = associateListQuerySchema.parse(req.query);
        const associates = await associateService.list(req.user.organisation_id, q);
        res.json({ associates });
    },
};
```

- [ ] **Step 2: Write the routes**

```js
// ============================================================================
// Associates routes — roster + Dentally-derived appointment stats.
// Mounted at /api/associates. Owner + practice_manager only.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { associateController } from "../controllers/associate.controller.js";

const router = (0, express_1.Router)();
const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', gate, (0, async_handler_1.asyncHandler)(associateController.list));

export default router;
```

- [ ] **Step 3: Wire into `app.js`** — add the import near the other route imports:

```js
import * as associate_routes_1 from "./routes/associate.routes.js";
```

Mount in the `/api` block (after the appointments / chair-utilisation mounts):

```js
    api.use('/associates', associate_routes_1.default);
```

- [ ] **Step 4: Syntax check + full suite**

Run: `cd backend && node --check src/routes/associate.routes.js && node --check src/app.js && npm test`
Expected: no syntax errors; whole backend suite passes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/associate.controller.js backend/src/routes/associate.routes.js backend/src/app.js
git commit -m "feat(associates): GET /api/associates endpoint"
```

---

### Task 9: Docs — API.md

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Add the endpoint** (operations section):

```markdown
### Associates  — owner / practice_manager

- `GET /api/associates?practice_id=<uuid>&weeks=52` — roster merged with Dentally
  appointment stats. Each row: `{ id, full_name, practice, pay_pct, joined_date, active,
  treatments, appointments_total, no_shows, completion_pct, no_show_pct, status }`.
  `ttm_production`, `ttm_uda`, `conversion` are always `null` (not in the Dentally feed).
  Associates are created/linked by the Dentally sync (`/practitioners` → `associates`,
  `practitioner_id` → `appointments.associate_id`). A full re-sync backfills `associate_id`
  on historical appointments.
```

- [ ] **Step 2: Commit**

```bash
git add docs/API.md
git commit -m "docs(associates): GET /api/associates endpoint"
```

---

### Task 10: Frontend — wire AssociatesScreen to real data

**Files:**
- Create: `frontend/features/operations/associates-api.ts`
- Modify: `frontend/features/operations/components/AssociatesScreen.tsx`

- [ ] **Step 1: Write the API client** `frontend/features/operations/associates-api.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type AssociateRow = {
  id: string;
  full_name: string;
  practice: string | null;
  pay_pct: number | null;
  joined_date: string | null;
  active: boolean;
  treatments: number;
  appointments_total: number;
  no_shows: number;
  completion_pct: number | null;
  no_show_pct: number | null;
  status: 'top' | 'good' | 'review';
  ttm_production: number | null;
  ttm_uda: number | null;
  conversion: number | null;
};

export function useAssociates(practiceId?: string) {
  return useQuery({
    queryKey: ['associates', practiceId ?? 'all'],
    queryFn: () =>
      api<{ associates: AssociateRow[] }>(
        `/api/associates${practiceId ? `?practice_id=${practiceId}` : ''}`,
      ),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Read the current `AssociatesScreen.tsx`** to preserve its layout/markup (header, KPI cards, table). Run:

Run: `cd frontend && sed -n '1,200p' features/operations/components/AssociatesScreen.tsx`
Expected: see the existing JSX so the rewrite keeps the same visual structure.

- [ ] **Step 3: Rewrite `AssociatesScreen.tsx`** to source rows from `useAssociates()` instead of the `ASSOCIATES` mock. Keep the existing card/table markup; change only the data source and the columns. Replace the import and the data derivation:

```tsx
'use client';
// Associates — real roster from the backend (Dentally-linked). Appointment
// volume / treatments / completion / no-show come from synced appointments;
// production, UDA and conversion are not in the Dentally feed and show "—".

import { useMemo } from 'react';
import { formatNumber } from '@/lib/format';
import { useAssociates, type AssociateRow } from '../associates-api';

const STATUS_STYLE: Record<AssociateRow['status'], { bg: string; fg: string; label: string }> = {
  top: { bg: '#DCFCE7', fg: '#166534', label: 'Top' },
  good: { bg: '#E6F4F1', fg: '#0E7C7B', label: 'Good' },
  review: { bg: '#FEE2E2', fg: '#991B1B', label: 'Review' },
};

export default function AssociatesScreen() {
  const { data, isLoading, isError, error } = useAssociates();
  const associates = useMemo(() => data?.associates ?? [], [data]);

  const totals = useMemo(() => {
    const count = associates.length;
    const treatments = associates.reduce((s, a) => s + a.treatments, 0);
    const completionVals = associates.map((a) => a.completion_pct).filter((v): v is number => v != null);
    const avgCompletion = completionVals.length
      ? Math.round(completionVals.reduce((s, v) => s + v, 0) / completionVals.length)
      : null;
    const needReview = associates.filter((a) => a.status === 'review').length;
    return { count, treatments, avgCompletion, needReview };
  }, [associates]);

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>Associates</h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {totals.count} clinicians · {formatNumber(totals.treatments)} treatments (last 52 weeks) · live from Dentally
        </p>
      </div>

      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Associates" value={formatNumber(totals.count)} />
        <Kpi label="Treatments (TTM)" value={formatNumber(totals.treatments)} />
        <Kpi label="Avg completion" value={totals.avgCompletion != null ? `${totals.avgCompletion}%` : '—'} />
        <Kpi label="Need review" value={formatNumber(totals.needReview)} />
      </div>

      <div className="card-padded">
        {isLoading && <div className="text-ink-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>Loading associates…</div>}
        {isError && <div style={{ fontSize: 13, padding: '24px 0', textAlign: 'center', color: '#991B1B' }}>Could not load associates{error instanceof Error ? `: ${error.message}` : ''}.</div>}
        {!isLoading && !isError && associates.length === 0 && (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            No associates yet. They appear here once a Dentally sync has pulled practitioners.
          </div>
        )}
        {!isLoading && !isError && associates.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px 8px 0' }}>Associate</th>
                <th style={{ padding: '8px 12px' }}>Practice</th>
                <th style={{ padding: '8px 12px' }}>Treatments</th>
                <th style={{ padding: '8px 12px' }}>Appts</th>
                <th style={{ padding: '8px 12px' }}>Completion</th>
                <th style={{ padding: '8px 12px' }}>No-show</th>
                <th style={{ padding: '8px 12px' }}>Production</th>
                <th style={{ padding: '8px 0 8px 12px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {associates.map((a) => {
                const s = STATUS_STYLE[a.status];
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid #E5E7EB' }}>
                    <td style={{ padding: '10px 12px 10px 0' }}>{a.full_name}</td>
                    <td style={{ padding: '10px 12px' }} className="text-ink-muted">{a.practice ?? '—'}</td>
                    <td style={{ padding: '10px 12px' }}>{formatNumber(a.treatments)}</td>
                    <td style={{ padding: '10px 12px' }}>{formatNumber(a.appointments_total)}</td>
                    <td style={{ padding: '10px 12px' }}>{a.completion_pct != null ? `${a.completion_pct}%` : '—'}</td>
                    <td style={{ padding: '10px 12px' }}>{a.no_show_pct != null ? `${a.no_show_pct}%` : '—'}</td>
                    <td style={{ padding: '10px 12px' }} className="text-ink-muted" title="Not available from Dentally">—</td>
                    <td style={{ padding: '10px 0 10px 12px' }}>
                      <span className="font-bold" style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '3px 10px', fontSize: 11 }}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-padded">
      <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>{label}</div>
      <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Check whether `PayScreen.tsx` / `data.ts` still need the `ASSOCIATES` mock**

Run: `cd frontend && grep -rn "ASSOCIATES" features/ app/ components/`
Expected: only `PayScreen.tsx` and `data.ts` may remain. Leave `ASSOCIATES` in `data.ts` if `PayScreen.tsx` still imports it (Pay Run is out of scope for this plan); `AssociatesScreen.tsx` no longer imports it.

- [ ] **Step 5: Typecheck + lint + build**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/features/operations/associates-api.ts frontend/features/operations/components/AssociatesScreen.tsx
git commit -m "feat(associates): wire AssociatesScreen to /api/associates"
```

---

## Done-when

- `npm test` (backend) green incl. `dentally-associates`, `associate-status`, `associate.service` tests.
- Frontend typecheck + lint + build clean.
- After a Dentally sync (or full re-sync): `associates` rows exist with `pms_external_id`; recent appointments carry `associate_id`; `GET /api/associates` returns real treatments/completion/no-show; Associates page renders them with production/UDA/conversion as `—`.
- `docs/API.md` updated.

## Manual verification (post-merge, needs Dentally creds)

1. Run a full re-sync from the integrations panel.
2. Confirm `associates` populated and `appointments.associate_id` non-null for new rows.
3. Load the Associates page → real per-associate stats; `—` in the three Dentally-less columns.
