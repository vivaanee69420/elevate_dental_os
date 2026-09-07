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
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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

// ============================================================================
// The Business Hub's marketing block must count what the Facebook and Google
// pages count.
//
// It was fed by the `ad_account_marketing` RPC — a THIRD definition of a lead,
// beside ad_campaign_funnel's and the report pages'. Measured live (Rochester's
// two ad accounts, August 2026) it returned 372 leads where those pages showed
// 341 Meta + 110 Google = 451. The block now reads the SAME two ledgers the
// pages read and narrows them to the practices behind the chosen accounts.
// ============================================================================
const marketing = await import('../src/repositories/marketing.repository.js');

describe('marketingRoi — the attributed funnel behind the marketing cards', () => {
    const lead = (practiceId, o = {}) => ({
        practice_id: practiceId, booked: false, accepted: false,
        is_new_patient: true, paid_pence: 0, ...o,
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it('counts the ledgers the report pages read, narrowed to the chosen accounts', async () => {
        stub({
            accounts: [
                { provider: 'google_ads', customer_id: 'G-ROCH', practice_id: 'p1', is_selected: true },
                { provider: 'google_ads', customer_id: 'G-ASH', practice_id: 'p2', is_selected: true },
            ],
            ad: [{ provider: 'google_ads', customer_id: 'G-ROCH', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: 'p1' }],
        });
        vi.spyOn(marketing.marketingRepository, 'googleLeadLedger').mockResolvedValue([
            lead('p1', { booked: true, accepted: true, paid_pence: 250000 }),
            lead('p1'),
            lead('p2'),   // another practice's account was not chosen
        ]);
        vi.spyOn(marketing.marketingRepository, 'metaLeadLedger').mockResolvedValue([]);

        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', accountIds: 'G-ROCH', now });

        expect(r.adFunnel).toEqual({ leads: 2, booked: 1, patients: 1, newPatients: 2, paidPence: 250000 });
    });

    it('scopes the two platforms separately — a Facebook account does not pull in Google leads', async () => {
        // Both accounts serve the same practice. Choosing only the Meta one must
        // count Meta's leads there and none of Google's, or the card silently
        // reports a channel the filter excluded.
        stub({
            accounts: [
                { provider: 'google_ads', customer_id: 'G-ROCH', practice_id: 'p1', is_selected: true },
                { provider: 'meta_ads', customer_id: 'M-ROCH', practice_id: 'p1', is_selected: true },
            ],
            ad: [{ provider: 'meta_ads', customer_id: 'M-ROCH', spend_pence: 100000, impressions: 10, clicks: 5, conversions: 1, practice_id: 'p1' }],
        });
        vi.spyOn(marketing.marketingRepository, 'googleLeadLedger').mockResolvedValue([lead('p1'), lead('p1')]);
        vi.spyOn(marketing.marketingRepository, 'metaLeadLedger').mockResolvedValue([lead('p1')]);

        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', accountIds: 'M-ROCH', now });

        expect(r.adFunnel.leads).toBe(1);
    });

    it('counts both platforms when no account filter is applied', async () => {
        stub({
            accounts: [
                { provider: 'google_ads', customer_id: 'G-ROCH', practice_id: 'p1', is_selected: true },
                { provider: 'meta_ads', customer_id: 'M-ROCH', practice_id: 'p1', is_selected: true },
            ],
        });
        vi.spyOn(marketing.marketingRepository, 'googleLeadLedger').mockResolvedValue([lead('p1'), lead('p1')]);
        vi.spyOn(marketing.marketingRepository, 'metaLeadLedger').mockResolvedValue([lead('p1')]);

        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

        expect(r.adFunnel.leads).toBe(3);
    });

    it('degrades to an empty funnel rather than failing the page when a ledger read errors', async () => {
        // Same discipline the RPC path had: the marketing block is one section
        // of a page, and it must never be able to take the rest down with it.
        stub();
        vi.spyOn(marketing.marketingRepository, 'googleLeadLedger').mockRejectedValue(new Error('boom'));
        vi.spyOn(marketing.marketingRepository, 'metaLeadLedger').mockResolvedValue([]);

        const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

        expect(r.adFunnel).toEqual({ leads: 0, booked: 0, patients: 0, newPatients: 0, paidPence: 0 });
    });
});
