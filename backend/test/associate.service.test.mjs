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

    it('defaults to a 52-week window and passes the since cutoff to the stats RPC', async () => {
        supaRec.rpcCalls = [];
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Dr A', active: true, practice: null }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const before = Date.now() - 52 * 7 * 86400000;
        await svc.list(ORG, {});
        const call = supaRec.rpcCalls.find((c) => c.fn === 'associate_appointment_stats');
        expect(call).toBeTruthy();
        const since = new Date(call.params.p_since).getTime();
        // within a minute of the expected 52-week cutoff (test wall-clock drift)
        expect(Math.abs(since - before)).toBeLessThan(60000);
    });

    it('falls back to a paginated appointment scan when the stats RPC is absent', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [{ id: 'a1', full_name: 'Dr A', active: true, practice: null }], error: null }
                : q.table === 'appointments'
                    ? { data: [
                        { associate_id: 'a1', status: 'completed' },
                        { associate_id: 'a1', status: 'no_show' },
                        { associate_id: 'a1', status: 'confirmed' },
                    ], error: null }
                    : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'rpc missing' } });
        const rows = await svc.list(ORG, { weeks: 12 });
        expect(rows[0]).toMatchObject({ appointments_total: 3, treatments: 1, no_shows: 1, completion_pct: 33 });
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
