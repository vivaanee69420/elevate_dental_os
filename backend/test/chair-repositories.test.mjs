// The chair repositories. serviceClient bypasses RLS, so the explicit
// organisation_id filter on every query IS the tenant isolation -- these tests
// exist to make its absence impossible to miss.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { practiceChairRepository } = await import('../src/repositories/practice-chair.repository.js');
const { practiceOpeningHoursRepository } = await import('../src/repositories/practice-opening-hours.repository.js');
const { chairUtilisationRepository } = await import('../src/repositories/chair-utilisation.repository.js');
const { analyticsRepository } = await import('../src/repositories/analytics.repository.js');
const { pageAll } = await import('../src/lib/paged-select.js');
const { serviceClient } = await import('../src/lib/supabase.js');

const ORG = 'org-aaaaaaaa';
const OTHER = 'org-bbbbbbbb';
const orgOf = (q) => q.eqs.find((e) => e.col === 'organisation_id')?.val;

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('tenant isolation', () => {
    it('every chair read carries the organisation filter', async () => {
        await practiceChairRepository.listForPractice(ORG, 'prac-1');
        expect(supaRec.last.table).toBe('practice_chairs');
        expect(orgOf(supaRec.last)).toBe(ORG);
        expect(supaRec.last.eqs.find((e) => e.col === 'practice_id').val).toBe('prac-1');
    });

    it('every opening-hours read carries the organisation filter', async () => {
        await practiceOpeningHoursRepository.listForPractice(ORG, 'prac-1');
        expect(supaRec.last.table).toBe('practice_opening_hours');
        expect(orgOf(supaRec.last)).toBe(ORG);
    });

    it('an update is scoped by org AND id, so another tenant row cannot be hit', async () => {
        supaRec.resultProvider = () => ({ data: { id: 'c1' }, error: null });
        await practiceChairRepository.update(ORG, 'c1', { name: 'Surgery 2' });
        expect(orgOf(supaRec.last)).toBe(ORG);
        expect(supaRec.last.eqs.find((e) => e.col === 'id').val).toBe('c1');
    });

    it('a cross-org read carries the other org filter, never a merged set', async () => {
        await practiceChairRepository.listAll(OTHER);
        expect(orgOf(supaRec.last)).toBe(OTHER);
    });

    it('create injects the caller organisation, ignoring any body-supplied one', async () => {
        supaRec.resultProvider = () => ({ data: { id: 'c9' }, error: null });
        await practiceChairRepository.create(ORG, {
            practice_id: 'prac-1', name: 'Surgery 1',
            organisation_id: 'org-attacker', // must be overwritten, never honoured
        });
        expect(supaRec.last.insertVals.organisation_id).toBe(ORG);
    });
});

describe('pageAll', () => {
    it('keeps reading until an EMPTY page, not a short one', async () => {
        // A short page is NOT the end: PostgREST can return fewer rows than
        // asked for and still have more. Stopping on short silently truncates.
        const pages = [
            [{ id: 'a' }, { id: 'b' }],
            [{ id: 'c' }],          // SHORT but not last -- must not stop here
            [{ id: 'd' }],
            [],                     // empty: the only real terminator
        ];
        let reads = 0;
        supaRec.resultProvider = () => ({ data: pages[reads++] ?? [], error: null });

        const rows = await pageAll(
            () => serviceClient.from('practice_chairs').select('*').eq('organisation_id', ORG),
            { pageSize: 2 },
        );
        expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(reads).toBe(4); // assert the READ COUNT, not just the row total
    });

    it('advances the cursor past the last id of the previous page', async () => {
        const seen = [];
        let reads = 0;
        supaRec.resultProvider = (q) => {
            seen.push(q.gts?.[0]?.val ?? null);
            return { data: reads++ === 0 ? [{ id: 'a' }, { id: 'b' }] : [], error: null };
        };
        await pageAll(
            () => serviceClient.from('practice_chairs').select('*').eq('organisation_id', ORG),
            { pageSize: 2 },
        );
        expect(seen).toEqual([null, 'b']); // second read starts after 'b'
    });
});

describe('practiceOpeningHoursRepository.upsertWeek', () => {
    it('stamps the org and source on every row and upserts on the weekday key', async () => {
        await practiceOpeningHoursRepository.upsertWeek(ORG, 'prac-1', [
            { weekday: 1, openMinute: 540, closeMinute: 1020 },
            { weekday: 7, openMinute: null, closeMinute: null },
        ], 'dentally');
        const vals = supaRec.last.upsertVals;
        expect(vals).toHaveLength(2);
        expect(vals[0]).toMatchObject({
            organisation_id: ORG, practice_id: 'prac-1',
            weekday: 1, open_minute: 540, close_minute: 1020, source: 'dentally',
        });
        expect(vals[1]).toMatchObject({ weekday: 7, open_minute: null, close_minute: null });
    });

    it('writes nothing at all for an empty week', async () => {
        supaRec.last = undefined;
        await practiceOpeningHoursRepository.upsertWeek(ORG, 'prac-1', [], 'manual');
        expect(supaRec.last).toBeUndefined();
    });
});

describe('bulkUpsertChairWeek', () => {
    it('stamps org, practice, chair and chair_name on every cell', async () => {
        await chairUtilisationRepository.bulkUpsertChairWeek(ORG, {
            practice_id: 'prac-1', chair_id: 'c1', chair_name: 'Surgery 1',
            cells: [
                { weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 30000 },
                { weekday: 2, slot: 'midday', booked_minutes: 60, revenue_pence: 0, notes: 'half day' },
            ],
        });
        const vals = supaRec.last.upsertVals;
        expect(vals).toHaveLength(2);
        for (const v of vals) {
            expect(v.organisation_id).toBe(ORG);
            expect(v.practice_id).toBe('prac-1');
            expect(v.chair_id).toBe('c1');
            expect(v.chair_name).toBe('Surgery 1');
        }
        expect(vals[1].notes).toBe('half day');
    });

    it('NEVER writes available_minutes -- capacity is derived, not stored', async () => {
        // Migration 000180 deprecated the column. Writing it would recreate the
        // second, drifting definition of capacity this rebuild exists to remove.
        await chairUtilisationRepository.bulkUpsertChairWeek(ORG, {
            practice_id: 'prac-1', chair_id: 'c1', chair_name: 'Surgery 1',
            cells: [{ weekday: 1, slot: 'morning', booked_minutes: 120, revenue_pence: 0 }],
        });
        expect(supaRec.last.upsertVals[0]).not.toHaveProperty('available_minutes');
    });

    it('an empty cell list writes nothing at all', async () => {
        supaRec.last = undefined;
        await chairUtilisationRepository.bulkUpsertChairWeek(ORG, {
            practice_id: 'prac-1', chair_id: 'c1', chair_name: 'Surgery 1', cells: [],
        });
        expect(supaRec.last).toBeUndefined();
    });
});

describe('analyticsRepository.chairUtilisationRows', () => {
    it('pages until an empty page rather than trusting one capped read', async () => {
        const pages = [[{ id: '1', chair_id: 'c1' }], [{ id: '2', chair_id: 'c1' }], []];
        let reads = 0;
        supaRec.resultProvider = () => ({ data: pages[reads++] ?? [], error: null });

        const rows = await analyticsRepository.chairUtilisationRows(ORG);
        expect(rows).toHaveLength(2);
        expect(reads).toBe(3);
    });

    it('carries the organisation filter on every page', async () => {
        await analyticsRepository.chairUtilisationRows(ORG);
        expect(orgOf(supaRec.last)).toBe(ORG);
    });
});
