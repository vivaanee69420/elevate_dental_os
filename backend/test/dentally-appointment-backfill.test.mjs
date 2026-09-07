// ============================================================================
// Dentally appointment BACKFILL reconciliation — the missing half of the sync.
//
// The nightly pull is `updated_after`-driven: it only ever sees records Dentally
// changed since the last run. That makes every miss PERMANENT. If a row is never
// stored (or is removed after the fact), its `updated_at` stays frozen in the
// past, the cursor moves forward, and no future incremental pull will ever
// return it again. The sync has a delete-reconciliation in both directions for
// rows Dentally REMOVED, and nothing at all for rows we simply do not have — so
// the error only ever accumulates, which is why the gap grows the further back
// you look.
//
// Measured on the live project 2026-09-07, Rochester August 2026: Dentally
// reports 620 patient appointments, we held 605. All 15 exist in Dentally
// (GET by id returns 200), all carry a mapped practitioner_site_id, a valid
// start/finish and a patient we already hold as a contact — and replaying the
// sync's own pull shape returned all 15 across 54 complete pages with no
// duplicates. Nothing about the fetch or the mapping was wrong. They were
// simply not in the table, and the incremental cursor could never go back for
// them.
//
// This reconciler closes that. Note the deliberate asymmetry with the delete
// prune beside it: THAT one is fail-CLOSED (a partial remote set makes healthy
// rows look deleted, so it aborts rather than act on incomplete data). This one
// is fail-OPEN — restoring a record Dentally just handed us is not destructive,
// so a short pull restores what it saw and the next run picks up the rest.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), mergeConfig: vi.fn() },
}));

const { reconcileMissingAppointments } = await import('../src/lib/integrations/dentally-sync.js');

const ORG = 'org-appt-backfill';
const BASE = 'https://api.dentally.co/v1';
const AUTH = 'Bearer k';
const SINCE = '2026-08-01T00:00:00.000Z';
const UNTIL = '2026-09-01T00:00:00.000Z';
const SITE = 'site-roch';

const appt = (id, over = {}) => ({
    id,
    practitioner_site_id: SITE,
    start_time: '2026-08-12T12:30:00.000+01:00',
    finish_time: '2026-08-12T13:00:00.000+01:00',
    state: 'Completed',
    patient_id: 28611,
    practitioner_id: 201522,
    reason: 'Review',
    ...over,
});

function serveRemote(pages) {
    return vi.fn(async (url) => {
        const page = Number(new URL(url).searchParams.get('page') || 1);
        const items = pages[page - 1] ?? [];
        return { ok: true, status: 200, json: async () => ({ appointments: items }) };
    });
}

let upserts;
// `held` = the pms ids already in our appointments table.
function db(held) {
    upserts = [];
    supaRec.resultProvider = (q) => {
        if (q.table === 'practices') return { data: [{ id: 'prac-roch', pms_site_id: SITE }], error: null };
        if (q.table === 'appointments' && q.op === 'upsert') { upserts.push(q); return { data: [], error: null }; }
        if (q.table === 'appointments' && q.op === 'select') {
            // The existence probe: which of the ids on this page do we already have?
            const asked = (q.ins ?? []).find((i) => i.col === 'pms_external_id')?.vals ?? [];
            return { data: asked.filter((id) => held.has(String(id))).map((id) => ({ pms_external_id: String(id) })), error: null };
        }
        return { data: [], error: null };
    };
}

beforeEach(() => { db(new Set()); });
afterEach(() => { vi.restoreAllMocks(); });

const rowsUpserted = () => upserts.flatMap((q) => q.upsertVals ?? []);

describe('reconcileMissingAppointments', () => {
    it('stores the appointments Dentally has that we never got', async () => {
        vi.stubGlobal('fetch', serveRemote([[appt('1076768678'), appt('1078629406')]]));
        db(new Set(['1078629406'])); // we already hold one of the two

        const res = await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        expect(res.restored).toBe(1);
        const rows = rowsUpserted();
        expect(rows).toHaveLength(1);
        expect(rows[0].pms_external_id).toBe('1076768678');
        // Mapped, not merely inserted: practice comes from practitioner_site_id,
        // and the Dentally patient id is persisted so the contact relink can
        // find it on the next pass.
        expect(rows[0].practice_id).toBe('prac-roch');
        expect(rows[0].pms_patient_id).toBe('28611');
        expect(rows[0].status).toBe('completed');
        expect(rows[0].organisation_id).toBe(ORG);
    });

    it('does not rewrite rows we already hold', async () => {
        // A blanket re-upsert of the whole window would be simpler and wrong: it
        // would rewrite thousands of rows a night and could blank a column the
        // row builder has no value for, to fix a handful of gaps.
        vi.stubGlobal('fetch', serveRemote([[appt('a'), appt('b'), appt('c')]]));
        db(new Set(['a', 'b', 'c']));

        const res = await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        expect(res.restored).toBe(0);
        expect(upserts).toEqual([]);
    });

    it('restores what it saw even when the pull is cut short — fail-OPEN, unlike the delete prune', async () => {
        // Two full pages then a short one; capped at 1 page. The delete prune
        // MUST abort here (a partial set makes live rows look deleted); this one
        // must not, because writing back a record Dentally just returned cannot
        // destroy anything.
        const pageA = Array.from({ length: 100 }, (_, i) => appt(`p1-${i}`));
        const pageB = Array.from({ length: 100 }, (_, i) => appt(`p2-${i}`));
        vi.stubGlobal('fetch', serveRemote([pageA, pageB]));

        const res = await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL, maxPages: 1 });

        expect(res.aborted).toBeUndefined();
        expect(res.restored).toBe(100);
        expect(res.truncated).toBe(true);
    });

    it('counts rather than stores an appointment whose site is not mapped', async () => {
        // practice_id is NOT NULL. An unmapped site is a mapping gap to report,
        // not a row to invent a practice for.
        vi.stubGlobal('fetch', serveRemote([[appt('x', { practitioner_site_id: 'site-unknown' })]]));

        const res = await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        expect(res.restored).toBe(0);
        expect(res.skippedUnmapped).toBe(1);
        expect(upserts).toEqual([]);
    });

    it('gives up quietly on a fetch failure without restoring a half-page', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

        const res = await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        expect(res.restored).toBe(0);
        expect(res.aborted).toBe('http_500');
        expect(upserts).toEqual([]);
    });

    it('waits out a 403 rate-limit instead of giving up', async () => {
        // Dentally signals its SUSTAINED cap as a 403 with a "Rate limit
        // exceeded" body and no Retry-After — not a 429. A fresh sub-account
        // paging its whole history is exactly the case that trips it, so
        // treating that 403 as a hard failure would make the reconciler abort
        // nightly for precisely the org that needs it most.
        let call = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            call++;
            if (call === 1) {
                return {
                    ok: false, status: 403,
                    headers: { get: () => null },
                    clone: () => ({ text: async () => JSON.stringify({ error: { type: 'invalid_access_error', message: 'Rate limit exceeded' } }) }),
                    json: async () => ({}),
                };
            }
            return { ok: true, status: 200, json: async () => ({ appointments: [appt('r1')] }) };
        }));

        const res = await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        expect(res.aborted).toBeUndefined();
        expect(res.restored).toBe(1);
        expect(call).toBe(2);
    });

    it('fails fast on a genuine 403 rather than retrying a permission error forever', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 403,
            headers: { get: () => null },
            clone: () => ({ text: async () => JSON.stringify({ error: { message: 'Forbidden' } }) }),
            json: async () => ({}),
        })));

        const res = await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        expect(res.aborted).toBe('http_403');
        expect(res.restored).toBe(0);
    });

    it('restores nothing, and does not crash, for an org with no practice mapped yet', async () => {
        // The state every NEW sub-account is in between connecting Dentally and
        // its sites being mapped. practice_id is NOT NULL, so there is no row to
        // write — the right outcome is a reported count, not an exception and
        // not an invented practice.
        vi.stubGlobal('fetch', serveRemote([[appt('n1'), appt('n2')]]));
        upserts = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices') return { data: [], error: null }; // nothing mapped
            if (q.table === 'appointments' && q.op === 'upsert') { upserts.push(q); return { data: [], error: null }; }
            return { data: [], error: null };
        };

        const res = await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        expect(res.restored).toBe(0);
        expect(res.skippedUnmapped).toBe(2);
        expect(upserts).toEqual([]);
    });

    it('stamps every restored row with the organisation it was reconciled for', async () => {
        // The reconciler runs per org from a shared worker; a row that carried
        // the wrong organisation_id would be a cross-tenant write, not a bug in
        // a count.
        vi.stubGlobal('fetch', serveRemote([[appt('t1'), appt('t2')]]));

        await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        const rows = rowsUpserted();
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.organisation_id === ORG)).toBe(true);
        expect(rows.every((r) => r.source === 'dentally')).toBe(true);
    });

    it('scopes the existence probe to this organisation', async () => {
        // The probe reads by pms_external_id, which is only unique WITHIN an org
        // — unscoped it would see another tenant's row and decide we already
        // hold an appointment we do not.
        const seen = [];
        vi.stubGlobal('fetch', serveRemote([[appt('z')]]));
        const inner = supaRec.resultProvider;
        supaRec.resultProvider = (q) => { if (q.table === 'appointments' && q.op === 'select') seen.push(q); return inner(q); };

        await reconcileMissingAppointments(ORG, BASE, AUTH, { sinceISO: SINCE, untilISO: UNTIL });

        expect(seen).toHaveLength(1);
        expect(seen[0].eqs).toContainEqual({ col: 'organisation_id', val: ORG });
        expect(seen[0].eqs).toContainEqual({ col: 'source', val: 'dentally' });
    });
});
