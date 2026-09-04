// Google report — blended CPL/CPB/CPA cards (migration 000158). Practice
// grain, not per-campaign: see google-report.service.js's leadPerformance
// header for why (CallRail carries no ad/campaign linkage at all).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: {
        adAccountsForProvider: vi.fn(),
        adSpendByPractice: vi.fn(),
        googleLeadLedger: vi.fn(),
        hasProviderMetrics: vi.fn(),
        hasGrainMetrics: vi.fn(),
    },
}));
vi.mock('../src/repositories/ad-channel-pipeline.repository.js', () => ({
    adChannelPipelineRepository: { list: vi.fn() },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { rollup: vi.fn(), keywordRollup: vi.fn() },
}));

const { googleReportService, invalidateLeadPerformanceCache, __test } = await import('../src/services/google-report.service.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');
const { adChannelPipelineRepository } = await import('../src/repositories/ad-channel-pipeline.repository.js');
const { leadLedgerUntil, practiceLeadPerformance, sumPracticeRows, withLeadCosts } = __test;

const ORG = '11111111-1111-1111-1111-111111111111';

describe('leadLedgerUntil', () => {
    it('adds one day, converting an inclusive date bound to the ledger\'s exclusive one', () => {
        expect(leadLedgerUntil('2026-08-31')).toBe('2026-09-01');
    });

    it('rolls a month/year boundary correctly through Date.UTC, not millisecond arithmetic', () => {
        expect(leadLedgerUntil('2025-12-31')).toBe('2026-01-01');
    });
});

describe('withLeadCosts', () => {
    it('returns null, not 0, on a zero denominator — a cost per nothing is unknowable', () => {
        const row = withLeadCosts({ spendPence: 50000, leads: 0, booked: 0, accepted: 0 });
        expect(row.cplPence).toBeNull();
        expect(row.cpbPence).toBeNull();
        expect(row.cpaPence).toBeNull();
    });

    it('divides spend by each of leads/booked/accepted independently', () => {
        const row = withLeadCosts({ spendPence: 100000, leads: 10, booked: 4, accepted: 2 });
        expect(row.cplPence).toBe(10000);
        expect(row.cpbPence).toBe(25000);
        expect(row.cpaPence).toBe(50000);
    });
});

describe('practiceLeadPerformance', () => {
    it('merges spend and leads for the SAME practice into one row', () => {
        const spend = [{ practice_id: 'P1', practice_name: 'Ashford', spend_pence: 100000, impressions: 500, clicks: 20 }];
        const ledger = [
            { practice_id: 'P1', practice_name: 'Ashford', booked: true, accepted: true, is_new_patient: true },
            { practice_id: 'P1', practice_name: 'Ashford', booked: false, accepted: false, is_new_patient: true },
        ];
        const [row] = practiceLeadPerformance(spend, ledger);
        expect(row.practiceId).toBe('P1');
        expect(row.spendPence).toBe(100000);
        expect(row.leads).toBe(2);
        expect(row.booked).toBe(1);
        expect(row.accepted).toBe(1);
        expect(row.cplPence).toBe(50000);
    });

    // LEFT-JOIN shaped, not inner: a practice can have spend with zero leads
    // (a quiet window) or leads with zero spend (an unmapped/paused
    // account) — neither may be dropped, or a card would silently omit a
    // practice that is genuinely active.
    it('keeps a practice with spend but no leads', () => {
        const spend = [{ practice_id: 'P1', practice_name: 'Ashford', spend_pence: 5000, impressions: 10, clicks: 1 }];
        const rows = practiceLeadPerformance(spend, []);
        expect(rows).toHaveLength(1);
        expect(rows[0].leads).toBe(0);
        expect(rows[0].cplPence).toBeNull();
    });

    it('keeps a practice with leads but no spend', () => {
        const ledger = [{ practice_id: 'P2', practice_name: 'Barnet', booked: false, accepted: false }];
        const rows = practiceLeadPerformance([], ledger);
        expect(rows).toHaveLength(1);
        expect(rows[0].spendPence).toBe(0);
        expect(rows[0].leads).toBe(1);
        // Zero pence over a real lead IS a real (if unusual) cost — an
        // unmapped/paused account with organic leads still coming in — unlike
        // a zero DENOMINATOR, which is unknowable. perUnitPence only guards
        // the denominator; the numerator being zero is a legitimate £0.00.
        expect(rows[0].cplPence).toBe(0);
    });

    // A null-practice row (spend on an unmapped account, or a lead whose
    // practice could not be resolved) buckets together rather than being
    // dropped or crashing on a null map key.
    it('buckets unmapped spend/leads under one practiceId:null row, not one per null', () => {
        const spend = [
            { practice_id: null, practice_name: null, spend_pence: 1000, impressions: 1, clicks: 1 },
            { practice_id: null, practice_name: null, spend_pence: 2000, impressions: 1, clicks: 1 },
        ];
        const rows = practiceLeadPerformance(spend, []);
        expect(rows).toHaveLength(1);
        expect(rows[0].practiceId).toBeNull();
        expect(rows[0].spendPence).toBe(3000);
    });

    it('never returns another practice\'s leads under this one\'s row', () => {
        const spend = [
            { practice_id: 'P1', practice_name: 'Ashford', spend_pence: 1000, impressions: 1, clicks: 1 },
            { practice_id: 'P2', practice_name: 'Barnet', spend_pence: 2000, impressions: 1, clicks: 1 },
        ];
        const ledger = [{ practice_id: 'P1', practice_name: 'Ashford', booked: false, accepted: false }];
        const rows = practiceLeadPerformance(spend, ledger);
        const p1 = rows.find((r) => r.practiceId === 'P1');
        const p2 = rows.find((r) => r.practiceId === 'P2');
        expect(p1.leads).toBe(1);
        expect(p2.leads).toBe(0);
    });
});

// Owner-requested toggle, after doubting a suspiciously low booked count:
// "add a toggle with existing patients" — compare new-patients-only against
// including-existing side by side. Both must read off the SAME booked/
// accepted/is_new_patient columns (one ledger call), never two different
// computations that could silently drift apart.
describe('practiceLeadPerformance — includeExisting toggle', () => {
    const spend = [{ practice_id: 'P1', practice_name: 'Ashford', spend_pence: 100000, impressions: 1, clicks: 1 }];
    const ledger = [
        { practice_id: 'P1', practice_name: 'Ashford', booked: true, accepted: true, is_new_patient: true },
        { practice_id: 'P1', practice_name: 'Ashford', booked: true, accepted: false, is_new_patient: false },
    ];

    it('defaults to new-patients-only — an existing patient\'s booking/acceptance is not counted', () => {
        const [row] = practiceLeadPerformance(spend, ledger);
        expect(row.leads).toBe(2); // both leads counted regardless
        expect(row.booked).toBe(1); // only the new patient's booking
        expect(row.accepted).toBe(1);
    });

    it('includeExisting=true counts every booked/accepted lead regardless of is_new_patient', () => {
        const [row] = practiceLeadPerformance(spend, ledger, true);
        expect(row.leads).toBe(2);
        expect(row.booked).toBe(2); // both, including the existing patient
        expect(row.accepted).toBe(1);
    });

    it('never counts a booking/acceptance the ledger did not actually report, in either mode', () => {
        const noneBooked = [
            { practice_id: 'P1', practice_name: 'Ashford', booked: false, accepted: false, is_new_patient: true },
        ];
        expect(practiceLeadPerformance(spend, noneBooked, false)[0].booked).toBe(0);
        expect(practiceLeadPerformance(spend, noneBooked, true)[0].booked).toBe(0);
    });
});

describe('sumPracticeRows', () => {
    it('sums every practice into one all-practices total, with its own costs recomputed from the sums', () => {
        const rows = practiceLeadPerformance(
            [
                { practice_id: 'P1', practice_name: 'Ashford', spend_pence: 60000, impressions: 100, clicks: 10 },
                { practice_id: 'P2', practice_name: 'Barnet', spend_pence: 40000, impressions: 50, clicks: 5 },
            ],
            [
                { practice_id: 'P1', practice_name: 'Ashford', booked: true, accepted: false, is_new_patient: true },
                { practice_id: 'P1', practice_name: 'Ashford', booked: false, accepted: false, is_new_patient: true },
                { practice_id: 'P2', practice_name: 'Barnet', booked: true, accepted: true, is_new_patient: true },
            ],
        );
        const total = sumPracticeRows(rows);
        expect(total.spendPence).toBe(100000);
        expect(total.leads).toBe(3);
        expect(total.booked).toBe(2);
        expect(total.accepted).toBe(1);
        // NOT the average of the per-practice CPLs — the true blended figure.
        expect(total.cplPence).toBe(Math.round(100000 / 3));
    });

    it('returns null costs, not 0, when there is no data at all', () => {
        const total = sumPracticeRows([]);
        expect(total.spendPence).toBe(0);
        expect(total.cplPence).toBeNull();
    });
});

// MULTI-TENANT GOTCHA: found live on Plan4growth (105 GHL leads inflated to
// 3,644 by counting every lead in the org, not just the ones in a pipeline
// mapped to google_ads — fixed via an inner join to ad_channel_pipelines).
// The OPPOSITE failure mode exists for every OTHER tenant: an org that has
// never mapped a single pipeline to google_ads (confirmed live — the
// "developer" org has 6,868 leads and 0 ad_channel_pipelines rows) gets
// leads=0 from the ledger, correctly, but that reads identically to "quiet
// period" unless the page is told which one it is. googlePipelinesMapped
// exists to make that distinction on every payload shape.
describe('leadPerformance — googlePipelinesMapped', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The spend+ledger fetch is cached 60s by org+since+until (see
        // loadLeadPerformanceData) — every test below reuses ORG and the
        // same since/until with different mocked repository responses, so
        // the cache must be cleared between them or a test would silently
        // reuse a PRIOR test's rows instead of its own mocks.
        invalidateLeadPerformanceCache();
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'C1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
        ]);
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: 'P1', practice_name: 'Rochester', spend_pence: 100000, impressions: 10, clicks: 1 },
        ]);
        marketingRepository.googleLeadLedger.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(true);
    });

    it('is false when the org has zero ad_channel_pipelines rows at all', async () => {
        adChannelPipelineRepository.list.mockResolvedValue([]);
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(out.googlePipelinesMapped).toBe(false);
    });

    it('is false when the org has mapped pipelines but none to google_ads (meta_ads only)', async () => {
        adChannelPipelineRepository.list.mockResolvedValue([
            { integration_account_id: 'A1', ghl_pipeline_id: 'P1', channel: 'meta_ads' },
        ]);
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(out.googlePipelinesMapped).toBe(false);
    });

    it('is true when at least one pipeline is mapped to google_ads', async () => {
        adChannelPipelineRepository.list.mockResolvedValue([
            { integration_account_id: 'A1', ghl_pipeline_id: 'P1', channel: 'meta_ads' },
            { integration_account_id: 'A1', ghl_pipeline_id: 'P2', channel: 'google_ads' },
        ]);
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(out.googlePipelinesMapped).toBe(true);
    });

    it('is present on the not_connected early return, not just the ok path', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        adChannelPipelineRepository.list.mockResolvedValue([]);
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(out.state).toBe('not_connected');
        expect(out.googlePipelinesMapped).toBe(false);
    });

    it('is present on the empty-window early return, not just the ok path', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([]);
        marketingRepository.googleLeadLedger.mockResolvedValue([]);
        adChannelPipelineRepository.list.mockResolvedValue([
            { integration_account_id: 'A1', ghl_pipeline_id: 'P2', channel: 'google_ads' },
        ]);
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(out.state).not.toBe('ok');
        expect(out.googlePipelinesMapped).toBe(true);
    });

    // Never scoped to another tenant's mapping — a fresh org with real spend
    // must not inherit "mapped" from a different org's pipelines.
    it('reads the map for the CALLER\'s org, never another tenant\'s', async () => {
        adChannelPipelineRepository.list.mockResolvedValue([]);
        await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(adChannelPipelineRepository.list).toHaveBeenCalledWith(ORG);
    });
});

// Speed fix: the "include existing patients" toggle used to re-fetch the
// whole spend+ledger query for a decision that never depended on the SQL —
// only on how already-fetched rows are summed. Both figures now come from
// ONE fetch, and that fetch is itself cached 60s so repeat requests for the
// same org+window (a second navigation, a second component) cost nothing.
describe('leadPerformance — includeExisting toggle costs no extra fetch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidateLeadPerformanceCache();
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'C1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
        ]);
        adChannelPipelineRepository.list.mockResolvedValue([
            { integration_account_id: 'A1', ghl_pipeline_id: 'P1', channel: 'google_ads' },
        ]);
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: 'P1', practice_name: 'Rochester', spend_pence: 100000, impressions: 10, clicks: 1 },
        ]);
        marketingRepository.googleLeadLedger.mockResolvedValue([
            { phone10: '1', practice_id: 'P1', practice_name: 'Rochester', source: 'ghl', lead_at: '2026-06-05T00:00:00Z',
              name: 'A', email: 'a@x.com', treatment: 'Exam', booked: true, accepted: true, is_new_patient: true },
            { phone10: '2', practice_id: 'P1', practice_name: 'Rochester', source: 'callrail', lead_at: '2026-06-06T00:00:00Z',
              name: 'B', email: null, treatment: null, booked: true, accepted: false, is_new_patient: false },
        ]);
    });

    it('returns BOTH practices/total (new-only) and practicesAll/totalAll (including existing) from one response', async () => {
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(out.total.booked).toBe(1);   // only the new patient's booking
        expect(out.totalAll.booked).toBe(2); // both, including the existing patient's
        expect(out.total.leads).toBe(2);    // leads counted regardless either way
        expect(out.totalAll.leads).toBe(2);
    });

    it('never calls googleLeadLedger a second time for the SAME org+window within the cache TTL', async () => {
        await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(marketingRepository.googleLeadLedger).toHaveBeenCalledTimes(1);
    });

    it('never serves one org, window or practice from another\'s cache entry', async () => {
        const OTHER_ORG = '99999999-9999-9999-9999-999999999999';
        await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        await googleReportService.leadPerformance(OTHER_ORG, { since: '2026-06-01', until: '2026-06-30' });
        await googleReportService.leadPerformance(ORG, { since: '2026-07-01', until: '2026-07-31' });
        expect(marketingRepository.googleLeadLedger).toHaveBeenCalledTimes(3);
    });
});

// ---------------------------------------------------------------------------
// Acceptance by MONEY PAID, above a consultation floor (migration 000162).
//
// "Accepted" used to mean "the first treatment-plan invoice is marked paid".
// It now means the lead has PAID more than ACCEPTANCE_MIN_PAID_PENCE. The
// comparison itself lives in the RPC (and is verified against live data —
// see 000162's header); what these tests pin is the contract around it: the
// floor the service sends, the fact that it travels to the client instead of
// being re-declared there, and the money surfacing beside the flag.
describe('leadPerformance — acceptance floor (000162)', () => {
    const LEDGER_ROWS = [
        // Paid £43 — over the floor, so accepted.
        { phone10: '1', practice_id: 'P1', practice_name: 'Rochester', source: 'ghl',
          lead_at: '2026-06-05T00:00:00Z', name: 'Over', email: 'a@x.com', treatment: 'Implant',
          booked: true, accepted: true, is_new_patient: true, paid_pence: 4300 },
        // Paid exactly £40 — the consultation fee, NOT an acceptance. The
        // floor is exclusive: this is the row that says so.
        { phone10: '2', practice_id: 'P1', practice_name: 'Rochester', source: 'callrail',
          lead_at: '2026-06-06T00:00:00Z', name: 'Exactly', email: null, treatment: null,
          booked: true, accepted: false, is_new_patient: true, paid_pence: 4000 },
        // Paid nothing. 0 is a real answer, not a missing one.
        { phone10: '3', practice_id: 'P1', practice_name: 'Rochester', source: 'ghl',
          lead_at: '2026-06-07T00:00:00Z', name: 'None', email: null, treatment: null,
          booked: false, accepted: false, is_new_patient: true, paid_pence: 0 },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        invalidateLeadPerformanceCache();
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'C1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
        ]);
        adChannelPipelineRepository.list.mockResolvedValue([
            { integration_account_id: 'A1', ghl_pipeline_id: 'P1', channel: 'google_ads' },
        ]);
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: 'P1', practice_name: 'Rochester', spend_pence: 100000, impressions: 10, clicks: 1 },
        ]);
        marketingRepository.googleLeadLedger.mockResolvedValue(LEDGER_ROWS);
    });

    // The floor is £40 in pence. Pinned so that changing it is a deliberate
    // edit to a test, not a silent shift in what every CPA on the page means.
    it('sends £40, in pence, as the acceptance floor', () => {
        expect(__test.ACCEPTANCE_MIN_PAID_PENCE).toBe(4000);
    });

    // Passed explicitly rather than left to the RPC's DEFAULT: a server-side
    // default the caller never states is exactly how the two drift apart.
    it('passes the floor to the ledger call, alongside the exclusive until', async () => {
        await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(marketingRepository.googleLeadLedger)
            .toHaveBeenCalledWith(ORG, '2026-06-01', '2026-07-01', 4000);
    });

    // The card labels itself "paid over £40" from THIS number. A hardcoded
    // copy in the component would keep saying £40 after the server changed.
    it('returns the floor on every payload shape, including the early returns', async () => {
        const ok = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(ok.state).toBe('ok');
        expect(ok.acceptanceMinPaidPence).toBe(4000);

        invalidateLeadPerformanceCache();
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const notConnected = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(notConnected.state).toBe('not_connected');
        expect(notConnected.acceptanceMinPaidPence).toBe(4000);

        invalidateLeadPerformanceCache();
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'C1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
        ]);
        marketingRepository.adSpendByPractice.mockResolvedValue([]);
        marketingRepository.googleLeadLedger.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
        const empty = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(empty.state).not.toBe('ok');
        expect(empty.acceptanceMinPaidPence).toBe(4000);
    });

    // Money beside the flag, so a reader can check the claim. £0.00 must
    // survive as 0 and not be dropped or coerced to null — "paid nothing" is
    // known, unlike a cost per nothing, which is not.
    it('surfaces the amount paid on every lead row, zero included', async () => {
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(out.leads.map((l) => l.paidPence)).toEqual([4300, 4000, 0]);
        expect(out.leads.map((l) => l.accepted)).toEqual([true, false, false]);
    });

    // CPA divides by the accepted count, so exactly one of these three
    // leads. Spend £1,000 / 1 accepted = £1,000 — and a lead that paid the
    // consultation fee alone must NOT pull that figure down.
    it('counts only over-the-floor leads toward CPA', async () => {
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-06-01', until: '2026-06-30' });
        expect(out.total.accepted).toBe(1);
        expect(out.total.cpaPence).toBe(100000);
    });
});
