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

// The deploy risk this pins: one shared field list sent both requests
// ad_id,ad_name — fields that do not exist at ad-set level. Meta is documented
// to ignore out-of-level fields, but if it ever rejected them the ad-set pull
// would 400 every night, land silently in `skipped` (the pull is deliberately
// non-fatal) and ad_meta_adsets would never receive a row.
describe('per-level insight fields', () => {
    const fields = (s) => s.split(',');

    it('does not ask the ad-set level for ad-level fields', () => {
        expect(fields(__test.ADSET_FIELDS)).not.toContain('ad_id');
        expect(fields(__test.ADSET_FIELDS)).not.toContain('ad_name');
    });

    it('asks each level for the id and name it is keyed on', () => {
        expect(fields(__test.ADSET_FIELDS)).toEqual(
            expect.arrayContaining(['adset_id', 'adset_name']),
        );
        expect(fields(__test.AD_FIELDS)).toEqual(
            expect.arrayContaining(['ad_id', 'ad_name']),
        );
    });

    // parseMetaLevel parents an ad on its AD SET, so adset_id must be asked
    // for at ad level too — it is a genuine ad-level field, and without it
    // every ad row would be dropped for having no parent.
    it('asks the ad level for its parent ad set', () => {
        expect(fields(__test.AD_FIELDS)).toContain('adset_id');
    });

    it('asks both levels for the metrics and the campaign both rows carry', () => {
        for (const list of [__test.ADSET_FIELDS, __test.AD_FIELDS]) {
            expect(fields(list)).toEqual(expect.arrayContaining([
                'campaign_id', 'campaign_name', 'spend', 'impressions', 'clicks', 'reach', 'frequency',
            ]));
        }
    });

    it('is looked up by the level string the insights edge takes', () => {
        expect(__test.LEVEL_FIELDS.adset).toBe(__test.ADSET_FIELDS);
        expect(__test.LEVEL_FIELDS.ad).toBe(__test.AD_FIELDS);
    });
});

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

        // Asserted on the third argument, not on "was it called at all".
        // replaceWindow DELETES every row it holds for the accounts it is
        // given before reinserting the payload, so passing the full account
        // list rather than only those that returned rows would wipe a
        // throttled account's entire 92-day history and write nothing back —
        // and a bare toHaveBeenCalled() would not notice. 'bad' must not
        // appear.
        const accountLists = adGrainRepository.replaceWindow.mock.calls.map((c) => c[2]);
        expect(accountLists.length).toBeGreaterThan(0);
        for (const aids of accountLists) expect(aids).toEqual(['act1']);
        expect(accountLists.flat()).not.toContain('bad');
    });
});
