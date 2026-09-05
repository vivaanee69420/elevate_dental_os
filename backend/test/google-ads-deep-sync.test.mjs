// Google deep-grain sync — ad group and ad. Verifies the GAQL shape, the
// camelCase parse, pence conversion, fractional conversions, and that each
// grain replaces independently.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { replaceWindow: vi.fn(async () => 1) },
}));

const { syncGoogleDeep, __test } = await import('../src/lib/integrations/google-ads-deep-sync.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { adGrainRepository.replaceWindow.mockClear(); });

describe('window', () => {
    it('is 92 days', () => {
        expect(__test.DEEP_WINDOW_DAYS).toBe(92);
    });
});

describe('buildAdGroupGaql', () => {
    it('selects from ad_group and bounds the window', () => {
        const q = __test.buildAdGroupGaql('2026-06-01', '2026-08-31');
        expect(q).toContain('FROM ad_group');
        expect(q).toContain('ad_group.id');
        expect(q).toContain('campaign.id');
        expect(q).toContain('segments.date');
        expect(q).toContain("BETWEEN '2026-06-01' AND '2026-08-31'");
    });
});

describe('buildAdGaql', () => {
    it('selects from ad_group_ad so ads hang off their ad group', () => {
        const q = __test.buildAdGaql('2026-06-01', '2026-08-31');
        expect(q).toContain('FROM ad_group_ad');
        expect(q).toContain('ad_group_ad.ad.id');
        expect(q).toContain('ad_group.id');
    });
});

describe('parseAdGroups', () => {
    it('maps an ad group to a row parented on its campaign', () => {
        const rows = __test.parseAdGroups([{ results: [{
            campaign: { id: 7, name: 'Implants' },
            adGroup: { id: 42, name: 'Exact', status: 'ENABLED' },
            segments: { date: '2026-08-01' },
            metrics: { costMicros: '12340000', impressions: '900', clicks: '45', conversions: 3.5 },
        }] }], { orgId: ORG, customerId: 'C1' });

        expect(rows).toEqual([{
            organisation_id: ORG, practice_id: null, provider: 'google_ads', customer_id: 'C1',
            campaign_id: '7', campaign_name: 'Implants',
            parent_id: '7', entity_id: '42', entity_name: 'Exact', entity_status: 'ENABLED',
            metric_date: '2026-08-01',
            spend_pence: 1234, impressions: 900, clicks: 45, conversions: 3.5,
            // Google reported none of the enriched fields on this row, and
            // every one of them comes back NULL rather than 0. That is the
            // assertion worth making: ad_google_rollup filters its weighted
            // impression-share denominator on exactly this nullness, so a 0
            // here would drag every reported share downward, and a 0
            // conversion value would price an unpriceable campaign at nothing.
            conversions_value_pence: null, all_conversions: null,
            search_impression_share: null, search_top_impression_share: null,
            search_absolute_top_impression_share: null,
            search_budget_lost_impression_share: null, search_rank_lost_impression_share: null,
        }]);
    });

    it('carries conversion value, all-conversions and all five impression shares', () => {
        const [row] = __test.parseAdGroups([{ results: [{
            campaign: { id: 7 }, adGroup: { id: 42 }, segments: { date: '2026-08-01' },
            metrics: {
                conversions: 2, conversionsValue: 1234.5, allConversions: 3.5,
                searchImpressionShare: 0.62, searchTopImpressionShare: 0.41,
                searchAbsoluteTopImpressionShare: 0.18,
                searchBudgetLostImpressionShare: 0.25, searchRankLostImpressionShare: 0.13,
            },
        }] }], { orgId: ORG, customerId: 'C1' });
        // Value arrives in whole account-currency units, not micros — pence is
        // x100, not /10,000. Getting this backwards would be off by 10,000x
        // and still look like a plausible number.
        expect(row.conversions_value_pence).toBe(123450);
        expect(row.all_conversions).toBe(3.5);
        expect(row.search_impression_share).toBe(0.62);
        expect(row.search_budget_lost_impression_share).toBe(0.25);
        expect(row.search_rank_lost_impression_share).toBe(0.13);
    });

    it('keeps conversions fractional rather than rounding', () => {
        const [row] = __test.parseAdGroups([{ results: [{
            campaign: { id: 1 }, adGroup: { id: 2 }, segments: { date: '2026-08-01' },
            metrics: { conversions: 2.5 },
        }] }], { orgId: ORG, customerId: 'C1' });
        expect(row.conversions).toBe(2.5);
    });

    it('drops rows with no ad group or no date', () => {
        const rows = __test.parseAdGroups([{ results: [
            { campaign: { id: 1 }, adGroup: {}, segments: { date: '2026-08-01' } },
            { campaign: { id: 1 }, adGroup: { id: 2 }, segments: {} },
        ] }], { orgId: ORG, customerId: 'C1' });
        expect(rows).toEqual([]);
    });
});

describe('parseAds', () => {
    // Asserted as a WHOLE row, like parseAdGroups above, not field by field.
    // entity_name and entity_status are sourced from different places on an ad
    // than on an ad group (`adGroupAd.ad.name` and `adGroupAd.status`, one
    // level apart), which is exactly the sort of thing a refactor gets wrong —
    // and a spot-check of four fields would not catch it.
    it('parents an ad on its AD GROUP, not its campaign', () => {
        const rows = __test.parseAds([{ results: [{
            campaign: { id: 7, name: 'Implants' },
            adGroup: { id: 42 },
            adGroupAd: { ad: { id: 99, name: 'Headline A' }, status: 'ENABLED' },
            segments: { date: '2026-08-01' },
            metrics: { costMicros: '5000000', impressions: '10', clicks: '1', conversions: 0 },
        }] }], { orgId: ORG, customerId: 'C1' });

        expect(rows).toEqual([{
            organisation_id: ORG, practice_id: null, provider: 'google_ads', customer_id: 'C1',
            campaign_id: '7', campaign_name: 'Implants',
            parent_id: '42', entity_id: '99', entity_name: 'Headline A', entity_status: 'ENABLED',
            metric_date: '2026-08-01',
            spend_pence: 500, impressions: 10, clicks: 1, conversions: 0,
            conversions_value_pence: null, all_conversions: null,
            ad_type: null, ad_strength: null, approval_status: null,
            final_url: null, headlines: null, descriptions: null,
        }]);
    });

    // THE REASON THE CREATIVE PULL EXISTS. ad_group_ad.ad.name is an optional
    // internal label and almost nobody sets one: 0 of 186 ads in this org's
    // live tables had a name, so the Ads tab rendered a bare 12-digit id on
    // every row. The first responsive-search headline is what a human calls
    // that ad, and it is the fallback.
    it('names an unnamed ad after its first headline', () => {
        const [row] = __test.parseAds([{ results: [{
            campaign: { id: 7 }, adGroup: { id: 42 },
            adGroupAd: {
                ad: {
                    id: 99,
                    type: 'RESPONSIVE_SEARCH_AD',
                    finalUrls: ['https://example.test/implants', 'https://example.test/alt'],
                    responsiveSearchAd: {
                        headlines: [{ text: 'Dental Implants in Ashford' }, { text: 'Book Today' }],
                        descriptions: [{ text: 'Free consultation.' }],
                    },
                },
                status: 'ENABLED', adStrength: 'GOOD',
                policySummary: { approvalStatus: 'APPROVED' },
            },
            segments: { date: '2026-08-01' },
            metrics: {},
        }] }], { orgId: ORG, customerId: 'C1' });

        expect(row.entity_name).toBe('Dental Implants in Ashford');
        // Flattened to plain strings — no reader should have to know about
        // Google's {text, pinnedField} asset shape.
        expect(row.headlines).toEqual(['Dental Implants in Ashford', 'Book Today']);
        expect(row.descriptions).toEqual(['Free consultation.']);
        // An ad may declare several final URLs; the FIRST is stored, and the
        // column is named for what it is rather than pretending to be "the" URL.
        expect(row.final_url).toBe('https://example.test/implants');
        expect(row.ad_strength).toBe('GOOD');
        expect(row.approval_status).toBe('APPROVED');
    });

    // The advertiser's own label wins when they set one — the headline is a
    // FALLBACK, not a replacement.
    it('prefers an explicit ad name over the headline', () => {
        const [row] = __test.parseAds([{ results: [{
            campaign: { id: 7 }, adGroup: { id: 42 },
            adGroupAd: {
                ad: { id: 99, name: 'Q3 promo', responsiveSearchAd: { headlines: [{ text: 'Book Today' }] } },
                status: 'ENABLED',
            },
            segments: { date: '2026-08-01' }, metrics: {},
        }] }], { orgId: ORG, customerId: 'C1' });
        expect(row.entity_name).toBe('Q3 promo');
    });
});

describe('parseSearchTerms', () => {
    it('identifies a search term by its TEXT and parents it on the ad group', () => {
        const [row] = __test.parseSearchTerms([{ results: [{
            campaign: { id: 7, name: 'Implants' },
            adGroup: { id: 42, name: 'Exact' },
            searchTermView: { searchTerm: 'emergency dentist near me', status: 'NONE' },
            segments: {
                date: '2026-08-01',
                keyword: { info: { text: 'emergency dentist', matchType: 'PHRASE' } },
            },
            metrics: { costMicros: '2500000', impressions: '30', clicks: '4', conversions: 1 },
        }] }], { orgId: ORG, customerId: 'C1' });

        // Google gives a search term no id — it is not an object in the
        // account, it is a string a stranger typed — so the text IS the
        // identity, and (ad group, text, day) is the unique key.
        expect(row.entity_id).toBe('emergency dentist near me');
        expect(row.parent_id).toBe('42');
        // The actionable half: which keyword caught this term.
        expect(row.keyword_text).toBe('emergency dentist');
        expect(row.match_type).toBe('PHRASE');
        expect(row.search_term_status).toBe('NONE');
        expect(row.spend_pence).toBe(250);
    });

    it('drops a row with no search term text', () => {
        expect(__test.parseSearchTerms([{ results: [{
            campaign: { id: 7 }, adGroup: { id: 42 },
            searchTermView: {}, segments: { date: '2026-08-01' }, metrics: {},
        }] }], { orgId: ORG, customerId: 'C1' })).toEqual([]);
    });
});

describe('syncGoogleDeep', () => {
    const batches = (results) => [{ results }];

    it('replaces each grain independently', async () => {
        const queryCustomer = vi.fn(async (_cid, _tok, gaql) => (
            gaql.includes('FROM ad_group_ad')
                ? batches([{ campaign: { id: 7 }, adGroup: { id: 42 },
                             adGroupAd: { ad: { id: 99 } }, segments: { date: '2026-08-01' },
                             metrics: { costMicros: '1000000' } }])
                : batches([{ campaign: { id: 7 }, adGroup: { id: 42 },
                             segments: { date: '2026-08-01' }, metrics: { costMicros: '2000000' } }])
        ));

        await syncGoogleDeep(ORG, {
            accessToken: 'tok', customerIds: ['C1'],
            since: '2026-06-01', until: '2026-08-31', queryCustomer,
        });

        const grains = adGrainRepository.replaceWindow.mock.calls.map((c) => c[1]);
        expect(grains).toContain('google_adgroup');
        expect(grains).toContain('google_ad');
    });

    it('writes ONE call per account, never one payload for all of them', async () => {
        const queryCustomer = vi.fn(async (cid, _tok, gaql) => (
            gaql.includes('FROM ad_group_ad') || gaql.includes('FROM keyword_view')
                ? batches([])
                : batches([{ campaign: { id: 7 }, adGroup: { id: 42 },
                             segments: { date: '2026-08-01' }, metrics: { costMicros: '1000000' } }])
        ));

        await syncGoogleDeep(ORG, {
            accessToken: 'tok', customerIds: ['C1', 'C2', 'C3'],
            since: '2026-06-01', until: '2026-08-31', queryCustomer,
        });

        const adgroupCalls = adGrainRepository.replaceWindow.mock.calls
            .filter((c) => c[1] === 'google_adgroup');

        // Three accounts, three writes. Batching them into one jsonb argument
        // made the payload grow with the number of connected accounts against a
        // fixed 60s statement_timeout: it worked at one account and timed out at
        // three, and because the deep sync is wrapped so it can never fail the
        // campaign sync, the only symptom was deep tabs quietly serving stale
        // rows. Asserting the COUNT is the point — asserting the summed row
        // total would pass just as happily against a single oversized write.
        expect(adgroupCalls).toHaveLength(3);

        // Each write is scoped to exactly its own account, both in the customer
        // list that drives the RPC's DELETE and in the rows it carries. A call
        // that deleted for one account while carrying another's rows would
        // still be "one call per account" and would still lose data.
        for (const [, , cids, rows] of adgroupCalls) {
            expect(cids).toHaveLength(1);
            expect(rows.every((r) => String(r.customer_id) === String(cids[0]))).toBe(true);
        }
        expect(adgroupCalls.map((c) => c[2][0]).sort()).toEqual(['C1', 'C2', 'C3']);
    });

    it('does not replace a grain that returned nothing', async () => {
        const queryCustomer = vi.fn(async () => batches([]));
        await syncGoogleDeep(ORG, {
            accessToken: 'tok', customerIds: ['C1'],
            since: '2026-06-01', until: '2026-08-31', queryCustomer,
        });
        expect(adGrainRepository.replaceWindow).not.toHaveBeenCalled();
    });

    it('keeps going when one account fails, and reports which grain failed', async () => {
        const queryCustomer = vi.fn(async (cid) => {
            if (cid === 'BAD') throw new Error('RESOURCE_EXHAUSTED');
            return batches([{ campaign: { id: 7 }, adGroup: { id: 42 },
                             segments: { date: '2026-08-01' }, metrics: { costMicros: '1000000' } }]);
        });
        const res = await syncGoogleDeep(ORG, {
            accessToken: 'tok', customerIds: ['BAD', 'C1'],
            since: '2026-06-01', until: '2026-08-31', queryCustomer,
        });
        // BAD's mock throws for every query, so it must be reported once per
        // grain — the no-dedup behaviour that tells an owner exactly which
        // part of the pull failed. Derived from STREAM_GRAINS rather than
        // hardcoded, so adding a grain does not falsify this test.
        expect(res.skipped.map((s) => s.grain)).toEqual(__test.STREAM_GRAINS);
        expect(res.skipped.every((s) => s.customerId === 'BAD')).toBe(true);
        expect(res.skipped.every((s) => s.error.includes('RESOURCE_EXHAUSTED'))).toBe(true);

        // THE most dangerous property in this file, asserted on the third
        // argument rather than on "was it called at all". replaceWindow DELETES
        // every row it holds for the accounts it is given before reinserting
        // the payload. An implementation that passed the full account list
        // instead of only the accounts that actually returned rows would still
        // satisfy `toHaveBeenCalled()` — and on the first night an account
        // throttles it would wipe that account's entire 92-day history and
        // write nothing back in its place. BAD must not appear.
        const accountLists = adGrainRepository.replaceWindow.mock.calls.map((c) => c[2]);
        expect(accountLists.length).toBeGreaterThan(0);
        for (const cids of accountLists) expect(cids).toEqual(['C1']);
        expect(accountLists.flat()).not.toContain('BAD');
    });
});
