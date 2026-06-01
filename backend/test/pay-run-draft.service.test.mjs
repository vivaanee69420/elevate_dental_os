import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/pay-run.service.js')).payRunService;

const ORG = 'org-pppppppp';
const PERIOD = { period_start: '2026-05-01', period_end: '2026-05-31' };

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.rpcCalls = [];
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

const roster = [
    { id: 'a1', full_name: 'Dr A', pay_pct: 5000, lab_split_pct: 5000, active: true, practice: { name: 'Ashford' } },
    { id: 'a2', full_name: 'Dr B', pay_pct: 4500, lab_split_pct: 5000, active: true, practice: null },
];

describe('payRunService.draft', () => {
    it('derives production from the associate_production RPC and runs calculateAssociatePay', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates' ? { data: roster, error: null } : { data: [], error: null };
        supaRec.rpcProvider = (fn) =>
            fn === 'associate_production'
                ? { data: [{ associate_id: 'a1', production_pence: 1000000 }], error: null }
                : { data: null, error: { message: 'unstubbed' } };

        const out = await svc.draft(ORG, PERIOD);
        expect(out.status).toBe('draft');
        const a1 = out.rows.find((r) => r.associate_id === 'a1');
        // pay_pct is basis points -> 50% of £10,000 = £5,000; lab unfed -> net == gross.
        expect(a1).toMatchObject({
            production_pence: 1000000, gross_pence: 500000,
            lab_cost_pence: 0, lab_deduction_pence: 0, net_pence: 500000, practice: 'Ashford',
        });
        const a2 = out.rows.find((r) => r.associate_id === 'a2');
        expect(a2).toMatchObject({ production_pence: 0, gross_pence: 0, net_pence: 0 });
        expect(out.totals).toEqual({ production: 1000000, gross: 500000, lab: 0, net: 500000 });
        expect(out.pct_of_production).toBe(50);
        // RPC keyed the period as inclusive ISO bounds.
        const call = supaRec.rpcCalls.find((c) => c.fn === 'associate_production');
        expect(call.params.p_org).toBe(ORG);
        expect(call.params.p_start).toBe('2026-05-01T00:00:00.000Z');
        expect(call.params.p_end).toBe('2026-05-31T23:59:59.999Z');
    });

    it('falls back to summing treatment_plans when the RPC is absent', async () => {
        supaRec.resultProvider = (q) => {
            if (q.table === 'associates') return { data: [roster[0]], error: null };
            if (q.table === 'treatment_plans')
                return { data: [
                    { associate_id: 'a1', private_value_pence: 200000 },
                    { associate_id: 'a1', private_value_pence: 300000 },
                ], error: null };
            return { data: [], error: null };
        };
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'rpc missing' } });

        const out = await svc.draft(ORG, PERIOD);
        const a1 = out.rows.find((r) => r.associate_id === 'a1');
        expect(a1.production_pence).toBe(500000);
        expect(a1.gross_pence).toBe(250000);
    });

    it('excludes inactive associates from the draft', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'associates'
                ? { data: [...roster, { id: 'a3', full_name: 'Dr C', pay_pct: 5000, lab_split_pct: 5000, active: false, practice: null }], error: null }
                : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const out = await svc.draft(ORG, PERIOD);
        expect(out.rows.map((r) => r.associate_id)).toEqual(['a1', 'a2']);
    });

    it('empty roster -> empty draft with zero totals', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const out = await svc.draft(ORG, PERIOD);
        expect(out.rows).toEqual([]);
        expect(out.totals).toEqual({ production: 0, gross: 0, lab: 0, net: 0 });
        expect(out.pct_of_production).toBe(0);
    });
});
