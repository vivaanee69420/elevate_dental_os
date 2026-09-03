// Meta deep-grain sync. Meta returns spend as a decimal STRING in the account
// currency ("12.34"), unlike Google's integer micros.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { replaceWindow: vi.fn(async () => 1) },
}));

const { syncMetaDeep, __test } = await import('../src/lib/integrations/meta-ads-deep-sync.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { adGrainRepository.replaceWindow.mockClear(); });

describe('spendToPence', () => {
    it('converts a decimal string to integer pence', () => {
        expect(__test.spendToPence('12.34')).toBe(1234);
        expect(__test.spendToPence('0.005')).toBe(1);   // rounds
        expect(__test.spendToPence(undefined)).toBe(0);
        expect(__test.spendToPence('not a number')).toBe(0);
    });
});

describe('parseMetaLevel — adset', () => {
    it('parents an ad set on its campaign and carries reach and frequency', () => {
        const [row] = __test.parseMetaLevel([{
            campaign_id: '7', campaign_name: 'Implants',
            adset_id: '42', adset_name: 'Photos | 35+',
            date_start: '2026-08-01',
            spend: '25.00', impressions: '900', clicks: '45',
            reach: '700', frequency: '1.29',
        }], 'adset', { orgId: ORG, customerId: 'act1' });

        expect(row).toMatchObject({
            organisation_id: ORG, provider: 'meta_ads', customer_id: 'act1',
            campaign_id: '7', campaign_name: 'Implants',
            parent_id: '7', entity_id: '42', entity_name: 'Photos | 35+',
            metric_date: '2026-08-01',
            spend_pence: 2500, impressions: 900, clicks: 45,
            reach: 700, frequency: 1.29,
        });
    });
});

describe('parseMetaLevel — ad', () => {
    it('parents an ad on its AD SET, not its campaign', () => {
        const [row] = __test.parseMetaLevel([{
            campaign_id: '7', adset_id: '42', ad_id: '99', ad_name: 'Creative A',
            date_start: '2026-08-01', spend: '5.00',
        }], 'ad', { orgId: ORG, customerId: 'act1' });

        expect(row.parent_id).toBe('42');
        expect(row.entity_id).toBe('99');
        expect(row.campaign_id).toBe('7');
    });

    it('drops a row missing its own id, its parent, or its date', () => {
        const rows = __test.parseMetaLevel([
            { campaign_id: '7', adset_id: '42', date_start: '2026-08-01' },          // no ad_id
            { campaign_id: '7', ad_id: '99', date_start: '2026-08-01' },             // no adset_id
            { campaign_id: '7', adset_id: '42', ad_id: '99' },                       // no date
        ], 'ad', { orgId: ORG, customerId: 'act1' });
        expect(rows).toEqual([]);
    });
});

describe('syncMetaDeep', () => {
    it('replaces both grains and reports counts', async () => {
        const fetchLevel = vi.fn(async (_aid, _tok, level) => (level === 'adset'
            ? [{ campaign_id: '7', adset_id: '42', date_start: '2026-08-01', spend: '1.00' }]
            : [{ campaign_id: '7', adset_id: '42', ad_id: '99', date_start: '2026-08-01', spend: '2.00' }]));

        const res = await syncMetaDeep(ORG, {
            accessToken: 'tok', accountIds: ['act1'],
            since: '2026-06-01', until: '2026-08-31', fetchLevel,
        });

        const grains = adGrainRepository.replaceWindow.mock.calls.map((c) => c[1]);
        expect(grains).toEqual(['meta_adset', 'meta_ad']);
        expect(res.skipped).toEqual([]);
    });

    it('does not replace a grain that returned nothing', async () => {
        await syncMetaDeep(ORG, {
            accessToken: 'tok', accountIds: ['act1'],
            since: '2026-06-01', until: '2026-08-31', fetchLevel: async () => [],
        });
        expect(adGrainRepository.replaceWindow).not.toHaveBeenCalled();
    });

    it('keeps going when one account fails', async () => {
        const fetchLevel = vi.fn(async (aid) => {
            if (aid === 'bad') throw new Error('(#17) User request limit reached');
            return [{ campaign_id: '7', adset_id: '42', date_start: '2026-08-01', spend: '1.00' }];
        });
        const res = await syncMetaDeep(ORG, {
            accessToken: 'tok', accountIds: ['bad', 'act1'],
            since: '2026-06-01', until: '2026-08-31', fetchLevel,
        });
        expect(res.skipped.map((s) => s.accountId)).toEqual(['bad', 'bad']);
        expect(adGrainRepository.replaceWindow).toHaveBeenCalled();
    });
});
