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
    it('includes the keyword grain so syncGoogleDeep picks it up unchanged', () => {
        expect(__test.STREAM_GRAINS).toEqual(['google_adgroup', 'google_ad', 'google_keyword']);
    });
});
