// Google keyword grain. Keywords are siblings of ads under an ad group, so a
// keyword's parent is its ad group. Google removed average position in
// September 2019; impression share and Quality Score are the ranking signals
// that replaced it.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { replaceWindow: vi.fn(async () => 1) },
}));

const { __test } = await import('../src/lib/integrations/google-ads-deep-sync.js');

const ORG = '11111111-1111-1111-1111-111111111111';

describe('buildKeywordGaql', () => {
    it('selects from keyword_view with quality and impression share', () => {
        const q = __test.buildKeywordGaql('2026-06-01', '2026-08-31');
        expect(q).toContain('FROM keyword_view');
        expect(q).toContain('ad_group_criterion.criterion_id');
        expect(q).toContain('ad_group_criterion.keyword.text');
        expect(q).toContain('ad_group_criterion.keyword.match_type');
        expect(q).toContain('ad_group_criterion.quality_info.quality_score');
        expect(q).toContain('metrics.search_impression_share');
        expect(q).toContain('metrics.search_top_impression_share');
        expect(q).toContain('metrics.search_absolute_top_impression_share');
    });

    it('does not ask for average_position, which Google removed in 2019', () => {
        expect(__test.buildKeywordGaql('2026-06-01', '2026-08-31')).not.toContain('average_position');
    });
});

describe('parseKeywords', () => {
    const batch = [{ results: [{
        campaign: { id: 7, name: 'Implants' },
        adGroup: { id: 42 },
        adGroupCriterion: {
            criterionId: 555,
            status: 'ENABLED',
            keyword: { text: 'dental implants near me', matchType: 'PHRASE' },
            qualityInfo: {
                qualityScore: 8,
                creativeQualityScore: 'ABOVE_AVERAGE',
                postClickQualityScore: 'AVERAGE',
                searchPredictedCtr: 'ABOVE_AVERAGE',
            },
        },
        segments: { date: '2026-08-01' },
        metrics: {
            costMicros: '7500000', impressions: '400', clicks: '20', conversions: 1.5,
            searchImpressionShare: 0.62,
            searchTopImpressionShare: 0.41,
            searchAbsoluteTopImpressionShare: 0.18,
        },
    }] }];

    it('parents a keyword on its ad group and carries the keyword text as the name', () => {
        const [row] = __test.parseKeywords(batch, { orgId: ORG, customerId: 'C1' });
        expect(row.parent_id).toBe('42');
        expect(row.entity_id).toBe('555');
        expect(row.entity_name).toBe('dental implants near me');
        expect(row.campaign_id).toBe('7');
        expect(row.spend_pence).toBe(750);
        expect(row.conversions).toBe(1.5);
    });

    it('carries match type, quality score and impression share', () => {
        const [row] = __test.parseKeywords(batch, { orgId: ORG, customerId: 'C1' });
        expect(row.match_type).toBe('PHRASE');
        expect(row.quality_score).toBe(8);
        expect(row.creative_quality_score).toBe('ABOVE_AVERAGE');
        expect(row.post_click_quality_score).toBe('AVERAGE');
        expect(row.search_predicted_ctr).toBe('ABOVE_AVERAGE');
        expect(row.search_impression_share).toBe(0.62);
        expect(row.search_top_impression_share).toBe(0.41);
        expect(row.search_absolute_top_impression_share).toBe(0.18);
    });

    it('leaves quality and impression share null when Google omits them', () => {
        const [row] = __test.parseKeywords([{ results: [{
            campaign: { id: 7 }, adGroup: { id: 42 },
            adGroupCriterion: { criterionId: 555, keyword: { text: 'x' } },
            segments: { date: '2026-08-01' }, metrics: { costMicros: '0' },
        }] }], { orgId: ORG, customerId: 'C1' });
        expect(row.quality_score).toBeNull();
        expect(row.search_impression_share).toBeNull();
        expect(row.match_type).toBeNull();
    });

    it('drops a row with no criterion id or no ad group', () => {
        const rows = __test.parseKeywords([{ results: [
            { campaign: { id: 7 }, adGroup: { id: 42 }, adGroupCriterion: {}, segments: { date: '2026-08-01' } },
            { campaign: { id: 7 }, adGroupCriterion: { criterionId: 1 }, segments: { date: '2026-08-01' } },
        ] }], { orgId: ORG, customerId: 'C1' });
        expect(rows).toEqual([]);
    });
});

describe('STREAMS', () => {
    it('includes the keyword and search-term grains so syncGoogleDeep picks them up unchanged', () => {
        expect(__test.STREAM_GRAINS).toEqual([
            'google_adgroup', 'google_ad', 'google_keyword', 'google_search_term',
        ]);
    });

    // The search-term grain is the ONLY one with a window of its own, and it
    // must be a SHALLOWER one. Pinned because the direction matters: `days`
    // narrows the caller's window and must never widen it, or a grain quietly
    // pulls past what the rolling-window contract promises.
    it('gives search terms a shallower window than the other grains, and only search terms', () => {
        expect(__test.SEARCH_TERM_WINDOW_DAYS).toBeLessThan(__test.DEEP_WINDOW_DAYS);
    });

    // A fallback exists for every grain that HAD a working shape before the
    // enrichment. Search terms are new, so there is nothing to fall back to
    // and the absence is deliberate, not an oversight.
    it('has a degraded fallback query for each pre-existing grain, and none for search terms', () => {
        expect(Object.keys(__test.BASIC_GAQL).sort())
            .toEqual(['google_ad', 'google_adgroup', 'google_keyword']);
    });
});

describe('impression-share fields by grain', () => {
    // THE BUDGET-LOST SHARE IS CAMPAIGN-ONLY, MEASURED AGAINST THE LIVE API.
    // Not a guess and not a hedge — see the support table in
    // google-ads-deep-sync.js. GAQL rejects the WHOLE query on one
    // grain-incompatible field, so asking ad_group for it took all three of
    // this org's ad-group pulls down to the degraded fallback and cost them
    // their conversion value too. These tests pin the measurement.
    it('never asks ad_group or keyword_view for the campaign-only budget-lost share', () => {
        for (const gaql of [
            __test.buildAdGroupGaql('2026-08-01', '2026-08-31'),
            __test.buildKeywordGaql('2026-08-01', '2026-08-31'),
        ]) {
            expect(gaql).not.toContain('search_budget_lost_impression_share');
        }
    });

    // Supported at both, and the more actionable of the two at this depth: it
    // says raise the bid or improve the ad, which an ad group can act on.
    it('asks ad_group and keyword_view for the three shares plus rank-lost', () => {
        for (const gaql of [
            __test.buildAdGroupGaql('2026-08-01', '2026-08-31'),
            __test.buildKeywordGaql('2026-08-01', '2026-08-31'),
        ]) {
            expect(gaql).toContain('metrics.search_impression_share');
            expect(gaql).toContain('metrics.search_top_impression_share');
            expect(gaql).toContain('metrics.search_absolute_top_impression_share');
            expect(gaql).toContain('metrics.search_rank_lost_impression_share');
        }
    });

    // Campaign is the ONLY grain that gets all five, and its list is imported
    // from here rather than re-typed in google-ads-sync.js — a second copy is
    // what caused the outage above.
    it('keeps all five for campaign grain, budget-lost included', () => {
        expect(__test.CAMPAIGN_SHARE_METRICS).toContain('search_budget_lost_impression_share');
        expect(__test.CAMPAIGN_SHARE_METRICS).toContain('search_rank_lost_impression_share');
    });

    // Neither ads nor search terms accept ANY impression share.
    it('never asks for an impression share where the resource reports none', () => {
        expect(__test.buildAdGaql('2026-08-01', '2026-08-31')).not.toContain('impression_share');
        expect(__test.buildSearchTermGaql('2026-08-01', '2026-08-31')).not.toContain('impression_share');
    });

    // Google reports no impression share for an individual ad at all, so
    // asking for one would fail the ad pull outright.
    it('never asks for an impression share at ad grain', () => {
        expect(__test.buildAdGaql('2026-08-01', '2026-08-31')).not.toContain('impression_share');
    });

    // shareMetrics maps ABSENT to null, never 0 — ad_google_rollup filters its
    // weighted-average denominator on exactly this nullness, so a 0 here would
    // drag every reported share downward for every entity in the account.
    it('maps an unreported share to null rather than zero', () => {
        expect(__test.shareMetrics({})).toEqual({
            search_impression_share: null,
            search_top_impression_share: null,
            search_absolute_top_impression_share: null,
            search_budget_lost_impression_share: null,
            search_rank_lost_impression_share: null,
        });
        expect(__test.shareMetrics({ searchImpressionShare: 0 }).search_impression_share).toBe(0);
    });
});
