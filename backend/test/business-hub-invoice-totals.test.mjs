// ============================================================================
// Business Hub — invoice totals that match Dentally's Invoice Timeline.
//
// The two money cards under Dentally were built from `invoice_items` filtered to
// lines carrying a treatment_plan_id. Dentally has no such filter, so neither
// number appeared in any Dentally screen and the owner could not check them: for
// Rochester 1-6 Sep 2026 the card read £11,781.22 against Dentally's £11,877.62,
// £136.40 apart with nothing on screen to explain it.
//
// These pin the replacement against the three columns Dentally actually shows
// (Invoices -> Invoice Timeline): Total, Unpaid, Paid — read from `invoices`,
// not `invoice_items`.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-invtotals';
const JUN = { since: '2026-05-31T23:00:00.000Z', until: '2026-06-30T23:00:00.000Z' };
const NOW = () => new Date('2026-07-15T09:00:00.000Z');
const practices = [{ id: 'p1', name: 'Alpha', chairs: 4 }, { id: 'p2', name: 'Beta', chairs: 2 }];

beforeEach(() => {
    svc.invalidateBusinessHub();
    supaRec.resultProvider = (q) => (
        q.table === 'practices' ? { data: practices, error: null }
            : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
                : { data: [], error: null }
    );
    supaRec.rpcProvider = (fn) => (
        fn === 'invoice_totals_by_practice'
            ? { data: [
                { practice_id: 'p1', invoiced_pence: 1191762, outstanding_pence: 44900, settled_pence: 1146862, invoice_count: 46 },
                { practice_id: 'p2', invoiced_pence: 83840, outstanding_pence: 6400, settled_pence: 77440, invoice_count: 3 },
            ], error: null }
            : { data: [], error: null }
    );
});

describe('businessHub — invoice totals (Dentally Invoice Timeline)', () => {
    it('reports invoiced, outstanding and settled per practice', async () => {
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });
        const alpha = res.practices.find((p) => p.practiceId === 'p1');

        expect(alpha.invoicedPence).toBe(1191762);
        expect(alpha.invoiceOutstandingPence).toBe(44900);
        expect(alpha.invoiceSettledPence).toBe(1146862);
        expect(alpha.invoiceCount).toBe(46);
    });

    it('sums the group total from the practice rows', async () => {
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(res.group.invoicedPence).toBe(1191762 + 83840);
        expect(res.group.invoiceOutstandingPence).toBe(44900 + 6400);
        expect(res.group.invoiceSettledPence).toBe(1146862 + 77440);
    });

    it('keeps the identity Dentally states on screen: invoiced = settled + outstanding', async () => {
        // The Invoice Timeline prints Total, Paid and Unpaid in one row, so the
        // three must add up or the card contradicts the screen it is checked
        // against. Asserted on the GROUP figure because that is the one a reader
        // sees first.
        const { group } = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(group.invoiceSettledPence + group.invoiceOutstandingPence).toBe(group.invoicedPence);
    });

    it('carries prior-period invoice totals, so the cards compare like with like', async () => {
        // These cards change what they measure (plan-line fees -> whole invoices).
        // If the prior figure stayed on the old basis the percentage underneath
        // would compare two different metrics and be wrong by whatever the plan
        // filter excluded — the exact failure this whole change is fixing.
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(res.group.compare.prev.invoicedPence).toBe(1191762 + 83840);
        expect(res.group.compare.prev.invoiceSettledPence).toBe(1146862 + 77440);
        expect(res.group.compare.prev.byPractice.find((r) => r.practiceId === 'p1').invoicedPence).toBe(1191762);
    });

    it('leaves the figures at zero rather than guessing when the feed returns nothing', async () => {
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const res = await svc.businessHub(ORG, { ...JUN, now: NOW });

        expect(res.group.invoicedPence).toBe(0);
        expect(res.group.invoiceOutstandingPence).toBe(0);
        expect(res.group.invoiceSettledPence).toBe(0);
    });
});

// ============================================================================
// The margin card has to be able to show its working.
//
// `marginPct` is a percentage over the trailing TWELVE ledger months, org-wide,
// and it used to arrive on the cashflow page as a bare number that the page
// then multiplied by the selected window's billed work and labelled "Profit".
// Two different periods, presented as one figure, with nothing on screen a
// reader could check it against.
//
// The inputs now travel with it. These assertions are the reconciliation the
// proof panel makes visible: the rows it prints must add up to the percentage
// printed above them, or the panel is decoration.
// ============================================================================
describe('business hub — the margin carries the numbers behind it', () => {
    const now = () => new Date(2026, 4, 15);

    it('revenue less costs equals net profit, and that is the margin', async () => {
        supaRec.resultProvider = (q) =>
            q.table === 'monthly_financials'
                ? {
                    data: [
                        { period: '2026-04', dental_bucket: 'revenue', amount_pence: 10_000_000, source: 'quickbooks', practice_id: null },
                        { period: '2026-04', dental_bucket: 'staff', amount_pence: 4_000_000, source: 'quickbooks', practice_id: null },
                        { period: '2026-04', dental_bucket: 'lab', amount_pence: 1_000_000, source: 'quickbooks', practice_id: null },
                    ],
                    error: null,
                }
                : { data: [], error: null };
        supaRec.rpcProvider = () => ({ data: [], error: null });
        svc.invalidateBusinessHub();
        const r = await svc.businessHub(ORG, { days: 30, now });
        const mi = r.group.marginInputs;
        expect(mi).not.toBeNull();
        // The identity the panel renders as Revenue / Less all costs / Net profit.
        expect(mi.revenuePence - mi.totalCostsPence).toBe(mi.netProfitPence);
        // And the headline percentage is that net profit over that revenue —
        // not a figure arrived at any other way.
        expect(Math.round((mi.netProfitPence / mi.revenuePence) * 1000) / 10)
            .toBe(Math.round(r.group.marginPct * 10) / 10);
        expect(mi.monthsCovered).toBeGreaterThan(0);
    });

    it('no P&L feed → null inputs, never a zeroed set of rows', async () => {
        // A proof panel showing "Revenue £0.00 / Less costs £0.00" would be a
        // statement that the practice earned nothing, which is not what "no
        // accounting feed connected" means.
        supaRec.resultProvider = () => ({ data: [], error: null });
        supaRec.rpcProvider = () => ({ data: [], error: null });
        svc.invalidateBusinessHub();
        const r = await svc.businessHub(ORG, { days: 30, now });
        expect(r.group.marginInputs).toBeNull();
        expect(r.group.marginPct).toBe(0);
    });
});
