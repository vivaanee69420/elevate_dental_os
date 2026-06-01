import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/treatment.service.js')).treatmentService;

const ORG = 'org-tttttttt';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.rpcCalls = [];
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('treatmentService.mix', () => {
    it('builds the volume mix from the treatment_mix_stats RPC: share, sort, totals', async () => {
        supaRec.rpcProvider = (fn) =>
            fn === 'treatment_mix_stats'
                ? { data: [
                    { appointment_type: 'Filling', volume: 5 },
                    { appointment_type: 'Checkup', volume: 10 },
                    { appointment_type: 'Whitening', volume: 5 },
                ], error: null }
                : { data: null, error: { message: 'unstubbed' } };

        const out = await svc.mix(ORG, { weeks: 52 });
        expect(out.total_volume).toBe(20);
        expect(out.distinct_types).toBe(3);
        expect(out.top_treatment).toBe('Checkup');
        // Sorted by volume desc; share = volume/total.
        expect(out.treatments[0]).toEqual({ type: 'Checkup', volume: 10, share_pct: 50 });
        expect(out.treatments[1].share_pct).toBe(25);
        // RPC received the org + a since cutoff.
        const call = supaRec.rpcCalls.find((c) => c.fn === 'treatment_mix_stats');
        expect(call.params.p_org).toBe(ORG);
        expect(typeof call.params.p_since).toBe('string');
    });

    it('falls back to a paginated appointment scan when the RPC is absent', async () => {
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'rpc missing' } });
        supaRec.resultProvider = (q) =>
            q.table === 'appointments'
                ? { data: [
                    { appointment_type: 'Checkup' },
                    { appointment_type: 'Checkup' },
                    { appointment_type: null },
                ], error: null }
                : { data: [], error: null };

        const out = await svc.mix(ORG, { weeks: 12 });
        expect(out.total_volume).toBe(3);
        expect(out.treatments[0]).toEqual({ type: 'Checkup', volume: 2, share_pct: 66.7 });
        // NULL appointment_type collapses to 'Unspecified'.
        expect(out.treatments.find((t) => t.type === 'Unspecified').volume).toBe(1);
        // Fallback scan is org-scoped.
        expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    });

    it('no appointments -> empty mix, null top', async () => {
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const out = await svc.mix(ORG, {});
        expect(out).toMatchObject({ treatments: [], total_volume: 0, distinct_types: 0, top_treatment: null });
    });

    it('passes a practice filter through to the fallback scan', async () => {
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'rpc missing' } });
        supaRec.resultProvider = (q) =>
            q.table === 'appointments' ? { data: [{ appointment_type: 'Checkup' }], error: null } : { data: [], error: null };
        await svc.mix(ORG, { practice_id: 'prac-1' });
        expect(supaRec.last.eqs.find((e) => e.col === 'practice_id')).toEqual({ col: 'practice_id', val: 'prac-1' });
    });
});
