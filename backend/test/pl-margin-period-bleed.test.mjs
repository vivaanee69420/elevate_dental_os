// ============================================================================
// ONE MONTH'S TOTAL WAS CARRYING ANOTHER MONTH'S MONEY.
//
// plMargin resolves each entity's buckets independently, and when an entity has
// no rows in the selected window it FALLS BACK to that entity's own trailing
// twelve months. Applied per key inside a group, one entity silently borrows a
// different period while the rest sit on the selected month, and the group
// total becomes a mixture of two windows presented as one.
//
// Observed on live data, P&L & Margin on September 2026:
//
//     the four QuickBooks companies on screen summed to   £42,876.59
//     the Total row said                                  £57,674.16
//
// The £14,797.57 difference is, to the penny, the revenue of the ONE untagged
// row set in the whole ledger — June 2026 — which has no company against it and
// so is excluded from the visible rows while still being added to the total.
// Other opex was out by £3,076.59, that same June set's costs; net profit by the
// difference. September revenue read 34.5% high.
//
// TWO FAULTS, FIXED TOGETHER:
//   1. A key with nothing in the window contributes NOTHING to that window. The
//      annual fallback is for a whole statement that has no monthly data at all
//      — an annual filer — not for one key inside an otherwise-monthly group.
//   2. The untagged bucket is a VISIBLE ROW. A table with a Total is a claim
//      that the rows above it add up; keeping a contributor off the list while
//      counting it in the sum breaks that claim silently.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-bleed';
const now = () => new Date(Date.UTC(2026, 8, 15)); // 15 Sep 2026

const ENTITIES = [{ id: 'p1', name: 'Rochester', kind: 'practice' }];

/** September rows for a tagged practice, plus an UNTAGGED June row set. */
const FIN = [
    { practice_id: 'p1', period: '2026-09', dental_bucket: 'revenue', amount_pence: 4_287_659, source: 'quickbooks' },
    { practice_id: 'p1', period: '2026-09', dental_bucket: 'overhead', amount_pence: 899_249, source: 'quickbooks' },
    // No practice, no company — the "__org__" bucket. Its only data is JUNE.
    { practice_id: null, period: '2026-06', dental_bucket: 'revenue', amount_pence: 1_479_757, source: 'quickbooks' },
    { practice_id: null, period: '2026-06', dental_bucket: 'overhead', amount_pence: 307_659, source: 'quickbooks' },
];

beforeEach(() => {
    supaRec.rpcCalls = [];
    supaRec.rpcProvider = () => ({ data: [], error: null });
    supaRec.resultProvider = (q) => {
        if (q.table === 'practices') return { data: ENTITIES, error: null };
        if (q.table === 'monthly_financials') return { data: FIN, error: null };
        return { data: [], error: null };
    };
});

describe('plMargin — a period total holds only that period', () => {
    it('June money does not appear in a September total', async () => {
        const r = await svc.plMargin(ORG, { now, since: '2026-09-01', until: '2026-09-30' });
        // September's own revenue, and nothing else.
        expect(r.statement.revPence).toBe(4_287_659);
        expect(r.statement.revPence).not.toBe(4_287_659 + 1_479_757);
        expect(r.statement.otherOpexPence).toBe(899_249);
    });

    it('the total equals the sum of the rows shown beneath it', async () => {
        // A table with a Total is a claim that its rows add up. Whatever the
        // service chooses to include, the two must agree.
        const r = await svc.plMargin(ORG, { now, since: '2026-09-01', until: '2026-09-30' });
        const summed = r.entities.reduce((n, e) => n + e.revPence, 0);
        expect(summed).toBe(r.statement.revPence);
    });

    it('untagged rows alone → the statement, and NO per-entity table to disagree with it', async () => {
        // When the untagged bucket is the only contributor there is nothing to
        // reconcile against, so no breakdown is offered and a lone row
        // restating the total would be noise. The unreconciled-Total problem
        // cannot arise because there is no Total row over a list.
        const r = await svc.plMargin(ORG, { now, since: '2026-06-01', until: '2026-06-30' });
        expect(r.statement.revPence).toBe(1_479_757);
        expect(r.entities).toEqual([]);
        expect(r.perEntityAvailable).toBe(false);
    });

    it('untagged rows BESIDE tagged ones are shown, so the total still adds up', async () => {
        // The live case: four companies plus an untagged set. Hiding the
        // untagged one while counting it is what put £57,674.16 over
        // £42,876.59 of visible rows.
        supaRec.resultProvider = (q) => {
            if (q.table === 'practices') return { data: ENTITIES, error: null };
            if (q.table === 'monthly_financials') {
                return {
                    data: [
                        { practice_id: 'p1', period: '2026-06', dental_bucket: 'revenue', amount_pence: 4_287_659, source: 'quickbooks' },
                        { practice_id: null, period: '2026-06', dental_bucket: 'revenue', amount_pence: 1_479_757, source: 'quickbooks' },
                    ],
                    error: null,
                };
            }
            return { data: [], error: null };
        };
        const r = await svc.plMargin(ORG, { now, since: '2026-06-01', until: '2026-06-30' });
        expect(r.statement.revPence).toBe(4_287_659 + 1_479_757);
        const summed = r.entities.reduce((n, e) => n + e.revPence, 0);
        expect(summed).toBe(r.statement.revPence);
        expect(r.entities.some((e) => e.id === '__org__')).toBe(true);
    });

    it('a window with no actuals anywhere still falls back to the annual sum', async () => {
        // The fallback has a real purpose — an annual filer, or a window before
        // any monthly data exists. It applies to the WHOLE statement, not to one
        // key inside an otherwise-monthly group.
        const r = await svc.plMargin(ORG, { now, since: '2026-01-01', until: '2026-01-31' });
        expect(r.statement.revPence).toBeGreaterThan(0);
        expect(r.basis).toBe('actuals-annual');
    });
});
