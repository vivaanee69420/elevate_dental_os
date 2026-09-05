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
    // KEYWORDS ASK FOR THREE SHARES, CAMPAIGN AND AD GROUP ASK FOR FIVE, and
    // the asymmetry is deliberate rather than an oversight — which is exactly
    // why it is pinned here. Someone tidying these two constants into one
    // would not be making a cosmetic change.
    //
    // The three on the keyword query are the set 000148 has pulled
    // successfully since it shipped. Whether keyword_view also accepts the two
    // LOST shares is not verifiable from this repo, and GAQL rejects an
    // unknown or grain-incompatible field by failing the WHOLE query — so
    // guessing wrong would not cost two ratios, it would send every keyword
    // pull down the degraded fallback path permanently and take that tier's
    // conversion VALUE with it. A budget is a campaign-level constraint
    // anyway, so budget-lost share is a campaign fact a keyword only inherits.
    it('asks keyword_view for only the three shares that are known to work', () => {
        const gaql = __test.buildKeywordGaql('2026-08-01', '2026-08-31');
        expect(gaql).toContain('metrics.search_impression_share');
        expect(gaql).toContain('metrics.search_top_impression_share');
        expect(gaql).toContain('metrics.search_absolute_top_impression_share');
        expect(gaql).not.toContain('search_budget_lost_impression_share');
        expect(gaql).not.toContain('search_rank_lost_impression_share');
    });

    it('asks campaign-level grains for all five, including the two that say WHY share was lost', () => {
        const gaql = __test.buildAdGroupGaql('2026-08-01', '2026-08-31');
        expect(gaql).toContain('metrics.search_budget_lost_impression_share');
        expect(gaql).toContain('metrics.search_rank_lost_impression_share');
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
