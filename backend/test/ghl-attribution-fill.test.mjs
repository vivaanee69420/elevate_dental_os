// Opportunistic attribution fill. The nightly walk already holds every
// contact; a contact outside the incremental window whose attribution has
// never been captured is written anyway. A contact that ALREADY has
// attribution is still skipped — otherwise the incremental sync degenerates
// into a full rewrite every night.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { getByProvider: vi.fn(), markSynced: vi.fn(), markFailed: vi.fn() },
}));

const { __test } = await import('../src/lib/integrations/gohighlevel-sync.js');

describe('selectContactsToWrite', () => {
    const older = '2020-01-01T00:00:00.000Z';
    const newer = '2030-01-01T00:00:00.000Z';
    const since = '2025-01-01T00:00:00.000Z';

    it('includes contacts changed since the last sync', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'a', dateUpdated: newer }], since, new Set());
        expect(out.map((c) => c.id)).toEqual(['a']);
    });

    it('includes an UNCHANGED contact whose attribution was never captured', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'b', dateUpdated: older }], since, new Set(['b']));
        expect(out.map((c) => c.id)).toEqual(['b']);
    });

    it('skips an unchanged contact that already has attribution', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'c', dateUpdated: older }], since, new Set());
        expect(out).toEqual([]);
    });

    it('keeps a contact with no update timestamp rather than silently dropping it', () => {
        const out = __test.selectContactsToWrite([{ id: 'd' }], since, new Set());
        expect(out.map((c) => c.id)).toEqual(['d']);
    });

    it('a full run (no since) takes everything', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'e', dateUpdated: older }], null, new Set());
        expect(out.map((c) => c.id)).toEqual(['e']);
    });
});

// ---------------------------------------------------------------------------
// The bulk write. postgrest-js sends `?columns=<union of every row's keys>`
// with defaultToNull, so PostgREST writes NULL into any column a given row
// omits. contactRow omits the attribution keys when the source carries none —
// correct per row, fatal per batch: ONE attributed contact in a 500-row chunk
// would null the attribution of every unattributed row beside it.
// ---------------------------------------------------------------------------
const ORG = 'org-ghl-1';
const base = (id) => ({
    organisation_id: ORG, practice_id: null, integration_account_id: null,
    source: 'gohighlevel', ghl_contact_id: id, first_name: 'A', last_name: 'B',
    email: `${id}@example.com`, phone: null,
});
const attributed = (id) => ({
    ...base(id), ad_campaign_id: '120249721894530517', ad_id: 'ad1', ad_set_id: null,
    gclid: null, landing_page_url: null, attribution_source: 'fb', attribution_medium: null,
    attribution_campaign_name: null, utm_source: null, utm_medium: null, utm_campaign: null,
    attribution_captured_at: '2026-08-30T10:00:00.000Z',
});

// Every array the writer hands to .upsert(), in order.
function recordUpserts() {
    const calls = [];
    supaRec.resultProvider = (q) => {
        if (q.op === 'upsert') calls.push(q);
        return { data: [], error: null };
    };
    return calls;
}

const keySet = (row) => Object.keys(row).sort().join(' ');

describe('upsertContactRows', () => {
    beforeEach(() => {
        supaRec.last = undefined;
        supaRec.resultProvider = () => ({ data: [], error: null });
    });

    it('never mixes column sets in one array — the batch-nulling guard', async () => {
        const calls = recordUpserts();
        await __test.upsertContactRows([attributed('a1'), base('b1'), base('b2')]);
        expect(calls.length).toBeGreaterThan(0);
        // THE invariant: merge the groups back into one array and this fails.
        for (const q of calls) {
            const sets = new Set(q.upsertVals.map(keySet));
            expect(sets.size).toBe(1);
        }
    });

    it('one attributed contact in a batch cannot null its neighbours', async () => {
        const calls = recordUpserts();
        await __test.upsertContactRows([attributed('a1'), base('b1')]);
        const unattributedArrays = calls.filter((q) => !('ad_campaign_id' in q.upsertVals[0]));
        expect(unattributedArrays.length).toBe(1);
        // The attribution columns must be absent from this array's key set, so
        // PostgREST never writes NULL over values captured on an earlier run.
        for (const row of unattributedArrays[0].upsertVals) {
            expect('ad_campaign_id' in row).toBe(false);
            expect('attribution_source' in row).toBe(false);
            expect('gclid' in row).toBe(false);
        }
    });

    it('stamps attribution_captured_at on a checked-but-empty contact', async () => {
        // Otherwise it stays in needsAttribution and is rewritten every night —
        // the incremental sync degenerating into a full rewrite.
        const calls = recordUpserts();
        await __test.upsertContactRows([base('b1')]);
        const row = calls[0].upsertVals[0];
        expect(typeof row.attribution_captured_at).toBe('string');
        expect(Number.isNaN(Date.parse(row.attribution_captured_at))).toBe(false);
    });

    it('leaves an already-captured timestamp alone', async () => {
        const calls = recordUpserts();
        await __test.upsertContactRows([attributed('a1')]);
        expect(calls[0].upsertVals[0].attribution_captured_at).toBe('2026-08-30T10:00:00.000Z');
    });

    it('keeps the onConflict target on every write', async () => {
        const calls = recordUpserts();
        await __test.upsertContactRows([attributed('a1'), base('b1')]);
        for (const q of calls) {
            expect(q.table).toBe('contacts');
            expect(q.upsertOpts).toEqual({ onConflict: 'organisation_id,ghl_contact_id' });
        }
    });

    it('retries row by row when a chunk fails — for BOTH groups', async () => {
        const calls = [];
        supaRec.resultProvider = (q) => {
            if (q.op !== 'upsert') return { data: [], error: null };
            calls.push(q);
            // Fail the bulk write; succeed on the per-row fallback.
            return q.upsertVals.length > 1
                ? { data: null, error: { message: 'boom' } }
                : { data: [], error: null };
        };
        const { synced, failed } = await __test.upsertContactRows(
            [attributed('a1'), attributed('a2'), base('b1'), base('b2')]);
        expect(synced).toBe(4);
        expect(failed).toBe(0);
        // 2 bulk attempts (one per group) + 4 single-row retries.
        expect(calls.filter((q) => q.upsertVals.length === 1)).toHaveLength(4);
    });

    it('counts an unstorable row as failed rather than losing the chunk', async () => {
        supaRec.resultProvider = (q) => (q.op === 'upsert'
            ? { data: null, error: { message: 'boom' } }
            : { data: [], error: null });
        const { synced, failed } = await __test.upsertContactRows([base('b1'), base('b2')]);
        expect(synced).toBe(0);
        expect(failed).toBe(2);
    });

    it('reports progress against the full row count, across groups', async () => {
        recordUpserts();
        const ticks = [];
        await __test.upsertContactRows(
            [attributed('a1'), base('b1'), base('b2')],
            (written, total, synced) => ticks.push({ written, total, synced }));
        expect(ticks.at(-1)).toEqual({ written: 3, total: 3, synced: 3 });
    });
});

describe('groupByColumnSet', () => {
    it('groups rows by identical key sets regardless of key ORDER', () => {
        const groups = __test.groupByColumnSet([
            { a: 1, b: 2 }, { b: 3, a: 4 }, { a: 5 },
        ]);
        expect(groups).toHaveLength(2);
        expect(groups.find((g) => g.length === 2)).toBeTruthy();
    });

    it('separates a row carrying created_at from one without it', () => {
        // Same defect class as attribution: contactRow omits created_at when the
        // source has no timestamp, and a merged array would null it.
        const groups = __test.groupByColumnSet([
            { ...base('b1'), created_at: '2026-01-01T00:00:00.000Z' }, base('b2'),
        ]);
        expect(groups).toHaveLength(2);
    });

    it('an empty input yields no groups', () => {
        expect(__test.groupByColumnSet([])).toEqual([]);
    });
});
