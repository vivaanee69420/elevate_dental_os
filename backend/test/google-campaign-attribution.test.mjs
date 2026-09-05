// Per-campaign cost per lead / booking / accepted patient, and the coverage
// figure that says how much of the table can be trusted.
//
// The Google report could never show this before migration 000165 — the
// service header said plainly it was not buildable, because CallRail calls
// were believed to carry no campaign linkage. They do: the campaign name, the
// bid keyword and the gclid, all captured from the click. These tests pin the
// three judgements that make the resulting table honest rather than merely
// populated:
//
//   1. Leads that could not be attributed are RETURNED, in their own bucket,
//      never dropped — or the campaign rows silently sum to fewer leads than
//      the practice card directly above them.
//   2. That bucket's costs are NULL, not £0.00 — it has no spend of its own,
//      and dividing £0 by its leads makes the unattributable leads look like
//      the cheapest campaign in the table.
//   3. Coverage is published, so the page can state it instead of asking
//      anyone to trust a cost figure on faith.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: {
        campaignSpendByProvider: vi.fn(),
        adAccountsForProvider: vi.fn(),
        hasProviderMetrics: vi.fn(),
        hasGrainMetrics: vi.fn(),
        adSpendByPractice: vi.fn(),
        googleLeadLedger: vi.fn(),
    },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword', 'google_search_term'],
    GOOGLE_GRAINS: ['google_adgroup', 'google_ad', 'google_keyword', 'google_search_term'],
    adGrainRepository: { rollup: vi.fn(), keywordRollup: vi.fn(), googleRollup: vi.fn(), googleCampaignRollup: vi.fn() },
}));
vi.mock('../src/repositories/ad-channel-pipeline.repository.js', () => ({
    adChannelPipelineRepository: { list: vi.fn() },
}));

const { googleReportService, __test, invalidateLeadPerformanceCache } =
    await import('../src/services/google-report.service.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');
const { adChannelPipelineRepository } = await import('../src/repositories/ad-channel-pipeline.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const PRACTICE = '22222222-2222-2222-2222-222222222222';

function campaignSpend(overrides = {}) {
    return {
        entity_id: 'CMP1', entity_name: 'Implants', entity_status: 'ENABLED', objective: 'SEARCH',
        spend_pence: 100000, impressions: 5000, clicks: 250, conversions: 10,
        conversions_value_pence: null, all_conversions: null, phone_calls: null,
        search_impression_share: null, search_top_impression_share: null,
        search_absolute_top_impression_share: null,
        search_budget_lost_impression_share: null, search_rank_lost_impression_share: null,
        ...overrides,
    };
}

function lead(overrides = {}) {
    return {
        phone10: '7000000001', practice_id: PRACTICE, practice_name: 'Ashford',
        source: 'callrail', lead_at: '2026-08-10T09:00:00Z', name: 'A Patient', email: null,
        treatment: null, booked: true, accepted: true, is_new_patient: true, paid_pence: 20000,
        campaign_id: 'CMP1', campaign_name: 'Implants',
        ad_group_id: 'AG1', ad_group_name: 'Exact', keyword_id: 'K1', keyword_text: 'dental implants',
        gclid: 'abc', attribution: 'callrail_keyword',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    invalidateLeadPerformanceCache();
    marketingRepository.hasProviderMetrics.mockResolvedValue(true);
    marketingRepository.hasGrainMetrics.mockResolvedValue(true);
    marketingRepository.adAccountsForProvider.mockResolvedValue([
        { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
    ]);
    marketingRepository.adSpendByPractice.mockResolvedValue([
        { practice_id: PRACTICE, practice_name: 'Ashford', spend_pence: 100000, impressions: 5000, clicks: 250 },
    ]);
    adChannelPipelineRepository.list.mockResolvedValue([{ channel: 'google_ads' }]);
    adGrainRepository.googleCampaignRollup.mockResolvedValue([campaignSpend()]);
    marketingRepository.googleLeadLedger.mockResolvedValue([lead()]);
});

describe('campaignLeadPerformance', () => {
    const { campaignLeadPerformance, UNATTRIBUTED } = __test;

    it('divides a campaign\'s own spend by its own leads, bookings and accepted patients', () => {
        const [row] = campaignLeadPerformance(
            [campaignSpend({ spend_pence: 120000 })],
            [
                lead({ phone10: '1', booked: true, accepted: true, paid_pence: 50000 }),
                lead({ phone10: '2', booked: true, accepted: false, paid_pence: 1000 }),
                lead({ phone10: '3', booked: false, accepted: false, paid_pence: 0 }),
            ],
        );
        expect(row.leads).toBe(3);
        expect(row.booked).toBe(2);
        expect(row.accepted).toBe(1);
        expect(row.cplPence).toBe(40000);   // 120000 / 3
        expect(row.cpbPence).toBe(60000);   // 120000 / 2
        expect(row.cpaPence).toBe(120000);  // 120000 / 1
        // Money collected against money spent. £510 in on £1,200 out.
        expect(row.paidPence).toBe(51000);
        expect(row.returnOnSpend).toBeCloseTo(51000 / 120000);
    });

    // THE RECONCILIATION RULE. 178 of 553 live leads land here today; if they
    // vanished, every campaign's conversion rate would be overstated by a
    // denominator smaller than the truth, and nothing on the page would say so.
    it('keeps leads with no campaign in their own bucket rather than dropping them', () => {
        const rows = campaignLeadPerformance(
            [campaignSpend()],
            [lead({ phone10: '1' }), lead({ phone10: '2', campaign_id: null, campaign_name: null, attribution: null })],
        );
        const total = rows.reduce((n, r) => n + r.leads, 0);
        expect(total).toBe(2);
        const bucket = rows.find((r) => !r.attributed);
        expect(bucket).toBeTruthy();
        expect(bucket.campaignId).toBeNull();
        expect(bucket.leads).toBe(1);
    });

    // A cost per nothing is unknowable, not free — and here it is worse than
    // usual: £0.00 per lead would sort the unattributable leads to the top of
    // any "cheapest campaign" reading of the table.
    it('reports NULL costs for the unattributed bucket, never zero', () => {
        const [bucket] = campaignLeadPerformance(
            [], [lead({ campaign_id: null, campaign_name: null, attribution: null })],
        );
        expect(bucket.attributed).toBe(false);
        expect(bucket.spendPence).toBe(0);
        expect(bucket.cplPence).toBeNull();
        expect(bucket.cpbPence).toBeNull();
        expect(bucket.cpaPence).toBeNull();
        expect(bucket.returnOnSpend).toBeNull();
    });

    // A LEFT-JOIN-SHAPED MERGE, both ways. An inner join would delete exactly
    // the two most interesting rows in the table: money spent that produced
    // nothing, and a patient who arrived from a campaign that has since
    // stopped spending.
    it('keeps a campaign with spend and no leads, and leads from a campaign with no spend in the window', () => {
        const rows = campaignLeadPerformance(
            [campaignSpend({ entity_id: 'QUIET', entity_name: 'Quiet', spend_pence: 50000 })],
            [lead({ campaign_id: 'OLD', campaign_name: 'Last month' })],
        );
        const quiet = rows.find((r) => r.campaignId === 'QUIET');
        const old = rows.find((r) => r.campaignId === 'OLD');
        expect(quiet.leads).toBe(0);
        // Spend with no leads: the cost per lead is unknowable, not infinite
        // and not zero.
        expect(quiet.cplPence).toBeNull();
        expect(old.leads).toBe(1);
        expect(old.spendPence).toBe(0);
        // Attributed, so it keeps real (if null-denominatored) cost fields —
        // it is a real campaign, just one that did not spend in this window.
        expect(old.attributed).toBe(true);
        expect(old.returnOnSpend).toBeNull();
    });

    // The owner's own definition of CPB/CPA is NEW patients only; the toggle
    // exists because they doubted a low booked count. Both figures come from
    // the same rows, gated differently — never from two queries that could
    // drift.
    it('gates booked/accepted on new-patient status unless told to include existing', () => {
        const rows = [
            lead({ phone10: '1', is_new_patient: true, booked: true, accepted: true, paid_pence: 10000 }),
            lead({ phone10: '2', is_new_patient: false, booked: true, accepted: true, paid_pence: 90000 }),
        ];
        const [newOnly] = campaignLeadPerformance([campaignSpend()], rows, false);
        const [all] = campaignLeadPerformance([campaignSpend()], rows, true);
        // leads counts everyone either way — it is the denominator of CPL,
        // which is about what the spend BOUGHT, not about who converted.
        expect(newOnly.leads).toBe(2);
        expect(all.leads).toBe(2);
        expect(newOnly.booked).toBe(1);
        expect(all.booked).toBe(2);
        expect(newOnly.paidPence).toBe(10000);
        expect(all.paidPence).toBe(100000);
    });

    it('names the unattributed bucket with a sentinel that is not a usable campaign id', () => {
        // Pinned because the sentinel leaks into a Map key, and a value that
        // could collide with a real Google campaign id (all digits) would
        // silently merge someone's campaign into the bucket.
        expect(UNATTRIBUTED).toBe('__unattributed__');
        expect(/^\d+$/.test(UNATTRIBUTED)).toBe(false);
    });
});

describe('attributionCoverage', () => {
    const { attributionCoverage } = __test;

    it('counts each resolution route and the unattributed remainder by source', () => {
        const out = attributionCoverage([
            lead({ phone10: '1', attribution: 'callrail_keyword' }),
            lead({ phone10: '2', attribution: 'callrail_campaign' }),
            lead({ phone10: '3', source: 'ghl', attribution: 'ghl_campaign' }),
            lead({ phone10: '4', source: 'ghl', campaign_id: null, attribution: null }),
            lead({ phone10: '5', source: 'callrail', campaign_id: null, attribution: null }),
        ]);
        expect(out.total).toBe(5);
        expect(out.attributed).toBe(3);
        expect(out.byRoute).toEqual({ callrail_keyword: 1, callrail_campaign: 1, ghl_campaign: 1 });
        // Split BY SOURCE because the two gaps have different causes and
        // different fixes: a CallRail miss is a tracking-template problem, a
        // GoHighLevel miss is a landing-page/ValueTrack problem.
        expect(out.unattributedBySource).toEqual({ ghl: 1, callrail: 1 });
    });

    it('is present and empty rather than absent when there are no leads at all', () => {
        expect(attributionCoverage([])).toEqual({
            total: 0, attributed: 0, byRoute: {}, unattributedBySource: {},
        });
    });
});

describe('leadPerformance — campaign breakdown on the payload', () => {
    it('returns campaigns, campaignsAll and attribution alongside the practice figures', async () => {
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-08-01', until: '2026-08-31' });
        expect(out.state).toBe('ok');
        expect(out.campaigns).toHaveLength(1);
        expect(out.campaigns[0].campaignName).toBe('Implants');
        expect(out.campaignsAll).toHaveLength(1);
        expect(out.attribution).toEqual({
            total: 1, attributed: 1, byRoute: { callrail_keyword: 1 }, unattributedBySource: {},
        });
    });

    // The unattributed bucket is a caveat about the table, not a row competing
    // in it. On a low-coverage window it can carry more leads than any real
    // campaign, and sorting it to the top would bury what the reader came for.
    it('sorts the unattributed bucket last regardless of how large it is', async () => {
        marketingRepository.googleLeadLedger.mockResolvedValue([
            lead({ phone10: '1' }),
            ...Array.from({ length: 20 }, (_, i) => lead({
                phone10: `9${i}`, campaign_id: null, campaign_name: null, attribution: null,
            })),
        ]);
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-08-01', until: '2026-08-31' });
        expect(out.campaigns.at(-1).attributed).toBe(false);
        expect(out.campaigns.at(-1).leads).toBe(20);
    });

    it('scopes campaign spend at the source when a practice filter is applied', async () => {
        await googleReportService.leadPerformance(ORG, {
            since: '2026-08-01', until: '2026-08-31', practiceId: PRACTICE,
        });
        // Practice-scoped in SQL, not filtered afterwards: the rollup groups by
        // campaign, so there is no practice column left to narrow on once it
        // returns. A JS filter here would divide GROUP-wide spend by ONE
        // practice's leads — the same defect the Facebook report shipped and
        // had to fix.
        expect(adGrainRepository.googleCampaignRollup).toHaveBeenCalledWith(
            ORG, expect.objectContaining({ practiceId: PRACTICE }),
        );
    });

    it('never serves one org\'s campaign spend from another org\'s cache entry', async () => {
        const OTHER = '33333333-3333-3333-3333-333333333333';
        await googleReportService.leadPerformance(ORG, { since: '2026-08-01', until: '2026-08-31' });
        await googleReportService.leadPerformance(OTHER, { since: '2026-08-01', until: '2026-08-31' });
        const orgs = adGrainRepository.googleCampaignRollup.mock.calls.map((c) => c[0]);
        expect(orgs).toContain(ORG);
        expect(orgs).toContain(OTHER);
    });

    it('carries each lead\'s campaign, ad group, keyword and resolution route into the drill-down', async () => {
        const out = await googleReportService.leadPerformance(ORG, { since: '2026-08-01', until: '2026-08-31' });
        expect(out.leads[0]).toMatchObject({
            campaignId: 'CMP1', campaignName: 'Implants',
            adGroupId: 'AG1', adGroupName: 'Exact',
            keywordId: 'K1', keywordText: 'dental implants',
            attribution: 'callrail_keyword',
        });
    });

    it('publishes an empty campaign breakdown on the not-connected and empty-window shapes', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const off = await googleReportService.leadPerformance(ORG, { since: '2026-08-01', until: '2026-08-31' });
        expect(off.state).toBe('not_connected');
        // PRESENT, not absent — the front end reads these keys unconditionally,
        // and an undefined here renders as a crash rather than as an empty
        // table. Same discipline effectiveSince/windowClamped already follow.
        expect(off.campaigns).toEqual([]);
        expect(off.attribution.total).toBe(0);

        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
        ]);
        marketingRepository.adSpendByPractice.mockResolvedValue([]);
        marketingRepository.googleLeadLedger.mockResolvedValue([]);
        invalidateLeadPerformanceCache();
        const empty = await googleReportService.leadPerformance(ORG, { since: '2026-08-02', until: '2026-08-30' });
        expect(empty.campaigns).toEqual([]);
        expect(empty.attribution.total).toBe(0);
    });
});

describe('googleExtras', () => {
    const { googleExtras } = __test;

    // NULL MEANS "GOOGLE DOES NOT REPORT THIS HERE", NOT ZERO. Impression
    // share does not exist for an individual ad; conversion value does not
    // exist without a value-tracking conversion action. An ad rendering 0%
    // impression share reads as "you are invisible", which is a very different
    // claim from "not measured".
    it('keeps every unreported field null rather than coercing it to zero', () => {
        const out = googleExtras({ spend_pence: 1000 });
        expect(out.conversionsValuePence).toBeNull();
        expect(out.allConversions).toBeNull();
        expect(out.searchImpressionShare).toBeNull();
        expect(out.searchBudgetLostImpressionShare).toBeNull();
        expect(out.searchRankLostImpressionShare).toBeNull();
        // A return on spend where the return is unknown is not 0x.
        expect(out.roas).toBeNull();
    });

    it('derives return on spend only when both sides are known', () => {
        expect(googleExtras({ spend_pence: 10000, conversions_value_pence: 25000 }).roas).toBe(2.5);
        // Value known, spend zero: still unknowable — a return on nothing is
        // not an infinite return, it is not a ratio at all.
        expect(googleExtras({ spend_pence: 0, conversions_value_pence: 25000 }).roas).toBeNull();
    });

    // PostgREST serialises a SQL numeric as a STRING. Left unconverted these
    // reach the front end as "0.62" and render fine right up until something
    // does arithmetic on them.
    it('numbers the ratios PostgREST hands back as strings', () => {
        const out = googleExtras({ spend_pence: 100, search_impression_share: '0.62', all_conversions: '3.5' });
        expect(out.searchImpressionShare).toBe(0.62);
        expect(out.allConversions).toBe(3.5);
    });
});

describe('clampSearchTermWindow', () => {
    const { clampSearchTermWindow } = __test;

    it('clamps to the search-term table\'s own shallower window and says so', () => {
        const out = clampSearchTermWindow('2020-01-01', '2026-08-31');
        expect(out.windowClamped).toBe(true);
        expect(out.effectiveSince).toBe(out.since);
        // Reported, so the page can name the period it is actually showing
        // rather than silently showing a different one.
        expect(out.windowDays).toBe(30);
        expect(out.since > '2020-01-01').toBe(true);
    });

    it('leaves a window already inside the floor alone', () => {
        const today = new Date().toISOString().slice(0, 10);
        const out = clampSearchTermWindow(today, today);
        expect(out.windowClamped).toBe(false);
        expect(out.since).toBe(today);
    });
});
