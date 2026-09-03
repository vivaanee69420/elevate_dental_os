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
        }]);
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
        }]);
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
