// ============================================================================
// THE "REAL CASE FEE" WAS AVERAGED OVER AN ARBITRARY ELEVENTH OF THE DATA.
//
// treatmentFeeBenchmarks read invoice_case_rollup, which returns ONE ROW PER
// INVOICE, and classified them in Node. PostgREST caps a set-returning function
// at 1000 rows exactly as it caps a table read, and that function has no ORDER
// BY — so the workbench averaged an arbitrary 1,000 of this organisation's
// 8,816 invoices and labelled the result "Case fee from real Dentally
// invoices".
//
// Measured on live data when it was found, Full Arch over twelve months:
//
//     shown on the page      11 invoices,  mean £7,785.06
//     actually in the data  163 invoices,  mean £6,028.06
//
// A 29% overstatement of the ONE figure on that page claiming to be measured,
// printed beside a sample size that made it look well-founded — and inherited
// by net profit, margin, annual profit and target price.
//
// This service had no test at all; only the pure classifier did, which is why
// the rewrite broke nothing and why the original bug survived.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const { TREATMENT_CASE_RULES, caseRulesForSql } = await import('../src/lib/formulas.js');

const ORG = 'org-benchmarks';
const now = () => new Date(2026, 8, 9); // 9 September 2026

beforeEach(() => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('treatmentFeeBenchmarks — aggregated in SQL, never over a truncated slice', () => {
    it('reads the aggregate function, not the per-invoice one', async () => {
        // The per-invoice read is what the 1000-row cap silently truncated.
        const called = [];
        supaRec.rpcProvider = (fn) => { called.push(fn); return { data: [], error: null }; };
        await svc.treatmentFeeBenchmarks(ORG, { months: 12, now });
        expect(called).toContain('invoice_case_stats');
        expect(called).not.toContain('invoice_case_rollup');
    });

    it('returns the full-population figures the aggregate reports', async () => {
        supaRec.rpcProvider = (fn) =>
            fn === 'invoice_case_stats'
                ? {
                    data: [{
                        key: 'fullarch', sample_size: 163, fee_pence: 602_806,
                        total_pence: 98_257_396, first_invoiced: '2025-09-15', last_invoiced: '2026-09-04',
                    }],
                    error: null,
                }
                : { data: [], error: null };
        const r = await svc.treatmentFeeBenchmarks(ORG, { months: 12, now });
        expect(r.benchmarks.fullarch.sampleSize).toBe(163);
        expect(r.benchmarks.fullarch.feePence).toBe(602_806);
        // NOT the truncated pair the page used to show.
        expect(r.benchmarks.fullarch.sampleSize).not.toBe(11);
        expect(r.benchmarks.fullarch.feePence).not.toBe(778_506);
    });

    it('reports REAL monthly volume, which the workbench never knew', async () => {
        // Its throughput was a hardcoded 1 surgery x 2 cases per month for every
        // tenant on the platform. 163 full arches over ~12 months is 13.6.
        supaRec.rpcProvider = (fn) =>
            fn === 'invoice_case_stats'
                ? { data: [{ key: 'fullarch', sample_size: 163, fee_pence: 602_806, total_pence: 1, first_invoiced: null, last_invoiced: null }], error: null }
                : { data: [], error: null };
        const r = await svc.treatmentFeeBenchmarks(ORG, { months: 12, now });
        expect(r.monthsCovered).toBeCloseTo(12, 0);
        expect(r.benchmarks.fullarch.casesPerMonth).toBeCloseTo(13.6, 1);
    });

    it('a short window is measured in the months it really spans', async () => {
        // 40 days is 1.3 months, not 1 — dividing by a whole month would
        // overstate the monthly rate by a quarter.
        supaRec.rpcProvider = (fn) =>
            fn === 'invoice_case_stats'
                ? { data: [{ key: 'fullarch', sample_size: 13, fee_pence: 1, total_pence: 1, first_invoiced: null, last_invoiced: null }], error: null }
                : { data: [], error: null };
        const r = await svc.treatmentFeeBenchmarks(ORG, { now, since: '2026-08-01', until: '2026-09-09' });
        expect(r.monthsCovered).toBeCloseTo(1.3, 1);
        expect(r.benchmarks.fullarch.casesPerMonth).toBeCloseTo(10, 0);
    });

    it('passes the practice and the window down to the aggregate', async () => {
        // The fee genuinely differs by site — £4,221 at one practice against
        // £6,617 at another — so an org-wide mean describes none of them.
        let params = null;
        supaRec.rpcProvider = (fn, p) => {
            if (fn === 'invoice_case_stats') params = p;
            return { data: [], error: null };
        };
        await svc.treatmentFeeBenchmarks(ORG, {
            now, practiceId: 'prac-1', since: '2026-01-01', until: '2026-06-30',
        });
        expect(params).toMatchObject({
            p_org: ORG, p_practice: 'prac-1', p_since: '2026-01-01', p_until: '2026-06-30',
        });
    });

    it('a treatment with no invoices is null, not a zero-fee benchmark', async () => {
        // A £0 case fee would flow into the compute and report a catastrophic
        // margin for a treatment the practice simply has not billed.
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const r = await svc.treatmentFeeBenchmarks(ORG, { months: 12, now });
        for (const key of Object.keys(TREATMENT_CASE_RULES)) {
            expect(r.benchmarks[key]).toBeNull();
        }
    });
});

describe('caseRulesForSql — one definition of what a full arch is', () => {
    it('is derived from TREATMENT_CASE_RULES, never a second list', () => {
        const sql = caseRulesForSql();
        expect(sql.map((r) => r.key).sort()).toEqual(Object.keys(TREATMENT_CASE_RULES).sort());
        for (const r of sql) {
            expect(r.match).toBe(TREATMENT_CASE_RULES[r.key].match.source);
            const not = TREATMENT_CASE_RULES[r.key].not;
            expect(r.not).toBe(not ? not.source : null);
        }
    });

    it('carries the exclusions, or an implant consult counts as an implant case', () => {
        const implant = caseRulesForSql().find((r) => r.key === 'implant');
        expect(implant.not).toBeTruthy();
        expect(new RegExp(implant.not, 'i').test('Implant consultation')).toBe(true);
    });
});
