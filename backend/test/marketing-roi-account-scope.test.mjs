// ============================================================================
// Selecting an ad account must scope the WHOLE marketing block, not half of it.
//
// `adRows` was filtered by the chosen accountIds while `leads` and `revRows`
// were filtered only by the scope picker's practices. So picking one ad account
// narrowed SPEND but left LEADS and REVENUE org-wide, and blended ROAS divided
// one by the other.
//
// Live proof from the owner's screen: ROAS read 32.36x on £1,801.08 of spend.
// 32.36 x 1,801.08 = £58,283 — the group's ENTIRE takings (£58,281.02). The card
// was dividing every practice's revenue by one account's spend, so it would read
// "Strong" no matter how badly that account performed.
//
// An account with no practice mapped implies no revenue scope at all. Rather
// than divide by a scope we cannot pin down, ROAS is withheld and the reason is
// stated.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const ORG = 'org-acctscope';
const now = () => new Date(Date.UTC(2026, 4, 15));

const PRACTICES = [{ id: 'p1', name: 'Rochester', chairs: 6 }, { id: 'p2', name: 'Barnet', chairs: 5 }];
// Two accounts, one per practice.
const ACCOUNTS = [
    { provider: 'google_ads', customer_id: 'G-ROCH', practice_id: 'p1', is_selected: true },
    { provider: 'meta_ads', customer_id: 'M-BARN', practice_id: 'p2', is_selected: true },
];
const LEADS = [
    { source: 'google', status: 'treatment_started', practice_id: 'p1' },
    { source: 'google', status: 'new', practice_id: 'p1' },
    { source: 'facebook', status: 'new', practice_id: 'p2' },
    { source: 'facebook', status: 'new', practice_id: 'p2' },
    { source: 'facebook', status: 'new', practice_id: 'p2' },
];
const REV = [{ practice_id: 'p1', pence: 1000000 }, { practice_id: 'p2', pence: 9000000 }];

function stub({ accounts = ACCOUNTS, ad = [], leads = LEADS, rev = REV } = {}) {
    supaRec.resultProvider = (q) => {
        if (q.table === 'leads') return { data: leads, error: null };
        if (q.table === 'practices') return { data: PRACTICES, error: null };
        if (q.table === 'ad_accounts') return { data: accounts, error: null };
        return { data: [], error: null };
    };
    supaRec.rpcProvider = (fn) =>
        fn === 'settled_revenue_by_practice' ? { data: rev, error: null }
            : fn === 'ad_metrics_rollup' ? { data: ad, error: null }
                : { data: [], error: null };
}

beforeEach(() => {
    supaRec.rpcCalls = [];
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('marketingRoi — an ad-account filter scopes everything', () => {
    it('narrows revenue and leads to the practices the chosen accounts run', async () => {
        // Only the Rochester Google account. Its practice is p1, so p2's
        // £90,000 of revenue and three Meta leads must NOT be counted.
        stub({ ad: [{ provider: 'google_ads', customer_id: 'G-ROCH', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: 'p1' }] });
        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', accountIds: 'G-ROCH', now });

        expect(r.settledRevenuePence).toBe(1000000);   // p1 only, not 10,000,000
        expect(r.totalLeads).toBe(2);                  // p1's two leads only
        expect(r.blendedRoas).toBe(10);                // 1,000,000 / 100,000 — like for like
    });

    it('leaves everything org-wide when no account filter is applied', async () => {
        stub({ ad: [{ provider: 'google_ads', customer_id: 'G-ROCH', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: 'p1' }] });
        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

        expect(r.settledRevenuePence).toBe(10000000);
        expect(r.totalLeads).toBe(5);
    });

    it('publishes the practice set it scoped to, so Dentally-fed cards can follow', async () => {
        // Revenue / Lead and Conversion take their NUMERATOR from Dentally
        // (plan fees, new patients), which the ROI feed does not carry. Naming
        // the practices in scope lets the page narrow those per-practice figures
        // the same way, instead of dividing a group numerator by a scoped
        // denominator — the very mismatch that made ROAS read 32x.
        stub({ ad: [{ provider: 'google_ads', customer_id: 'G-ROCH', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: 'p1' }] });
        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', accountIds: 'G-ROCH', now });

        expect(r.scopePracticeIds).toEqual(['p1']);
    });

    it('publishes null when nothing narrows the scope', async () => {
        stub({ ad: [{ provider: 'google_ads', customer_id: 'G-ROCH', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: 'p1' }] });
        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

        expect(r.scopePracticeIds).toBeNull();
    });

    it('withholds ROAS when a chosen account has no practice mapped', async () => {
        // Spend is known, but which revenue it earned is not — there is no
        // honest denominator, so the card must say so rather than divide by the
        // whole group and read "Strong".
        stub({
            accounts: [{ provider: 'google_ads', customer_id: 'G-NOMAP', practice_id: null, is_selected: true }],
            ad: [{ provider: 'google_ads', customer_id: 'G-NOMAP', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: null }],
        });
        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', accountIds: 'G-NOMAP', now });

        expect(r.blendedRoas).toBeNull();
        expect(r.roasUnavailableReason).toBe('unmapped_ad_account');
    });
});

describe('marketingRoi — the attributed funnel behind the marketing cards', () => {
    it('reports the funnel for the selected accounts, read through the report pages own ledgers', async () => {
        // Leads/booked/patients/paid come from ad_account_marketing, which reads
        // ad_meta_lead_ledger + ad_google_lead_ledger — the exact functions the
        // Facebook and Google pages use. The Business Hub therefore cannot show
        // a different lead count from those pages for the same accounts, which
        // is what it did before: 200 practice enquiries against their 66.
        stub({ ad: [{ provider: 'google_ads', customer_id: 'G-ROCH', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: 'p1' }] });
        supaRec.rpcProvider = (fn) =>
            fn === 'settled_revenue_by_practice' ? { data: REV, error: null }
                : fn === 'ad_metrics_rollup' ? { data: [{ provider: 'google_ads', customer_id: 'G-ROCH', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: 'p1' }], error: null }
                    : fn === 'ad_account_marketing'
                        ? { data: [{ leads: 72, booked: 6, patients: 2, new_patients: 3, paid_pence: 250000 }], error: null }
                        : { data: [], error: null };
        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', accountIds: 'G-ROCH', now });

        expect(r.adFunnel).toEqual({ leads: 72, booked: 6, patients: 2, newPatients: 3, paidPence: 250000 });
    });

    it('degrades to null rather than failing the page when the funnel is unavailable', async () => {
        stub();
        supaRec.rpcProvider = (fn) =>
            fn === 'ad_account_marketing' ? { data: null, error: { message: 'boom' } }
                : fn === 'settled_revenue_by_practice' ? { data: REV, error: null }
                    : { data: [], error: null };
        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

        expect(r.adFunnel).toBeNull();
    });
});
