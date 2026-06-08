// Meta Ads sync — decimal-string spend -> pence, conversion summing from the
// actions breakdown, insight parsing, and syncOneOrg delete-then-insert into
// ad_metrics keyed by organisation_id + provider='meta_ads' (multi-tenant).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), getByProvider: vi.fn(), upsertAdAccounts: vi.fn() },
}));

const { syncOneOrg, __test } = await import('../src/lib/integrations/meta-ads-sync.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

describe('spendToPence', () => {
    it('converts an account-currency decimal string to integer pence', () => {
        expect(__test.spendToPence('10.00')).toBe(1000);   // £10.00 -> 1000p
        expect(__test.spendToPence('1.2345')).toBe(123);   // £1.2345 -> 123p (rounded)
        expect(__test.spendToPence('0')).toBe(0);
        expect(__test.spendToPence(undefined)).toBe(0);
        expect(__test.spendToPence('not-a-number')).toBe(0);
    });
});

describe('conversionsFromActions', () => {
    it('sums values of conversion-type actions, ignoring others', () => {
        const actions = [
            { action_type: 'lead', value: '3' },
            { action_type: 'offsite_conversion.fb_pixel_lead', value: '2' },
            { action_type: 'link_click', value: '40' },      // not a conversion
            { action_type: 'purchase', value: '1' },
            { action_type: 'landing_page_view', value: '99' }, // not a conversion
        ];
        expect(__test.conversionsFromActions(actions)).toBe(6); // 3 + 2 + 1
    });
    it('handles missing / non-array input', () => {
        expect(__test.conversionsFromActions(undefined)).toBe(0);
        expect(__test.conversionsFromActions([])).toBe(0);
    });
});

describe('parseInsights', () => {
    it('maps insight rows, drops rows missing campaign_id/date_start', () => {
        const rows = [
            { campaign_id: 1, campaign_name: 'Implants', date_start: '2026-05-01',
              spend: '5.00', impressions: '1200', clicks: '40', reach: '900', frequency: '1.33',
              actions: [{ action_type: 'lead', value: '3' }] },
            { campaign_id: 2, date_start: '', spend: '1.00' }, // no date -> dropped
            { campaign_name: 'No id', date_start: '2026-05-02' }, // no id -> dropped
        ];
        // campaignMeta supplies status + objective (not on insights).
        const meta = { 1: { status: 'ACTIVE', objective: 'OUTCOME_LEADS' } };
        expect(__test.parseInsights(rows, meta)).toEqual([
            { campaign_id: '1', campaign_name: 'Implants', metric_date: '2026-05-01', spend_pence: 500,
              impressions: 1200, clicks: 40, reach: 900, frequency: 1.33,
              campaign_status: 'ACTIVE', objective: 'OUTCOME_LEADS', conversions: 3 },
        ]);
    });
    it('defaults reach to 0, frequency/status/objective to null when absent', () => {
        const rows = [{ campaign_id: 9, date_start: '2026-05-03', spend: '2.00', impressions: '100', clicks: '5' }];
        expect(__test.parseInsights(rows)).toEqual([
            { campaign_id: '9', campaign_name: null, metric_date: '2026-05-03', spend_pence: 200,
              impressions: 100, clicks: 5, reach: 0, frequency: null,
              campaign_status: null, objective: null, conversions: 0 },
        ]);
    });
    it('handles empty / non-array input', () => {
        expect(__test.parseInsights(undefined)).toEqual([]);
        expect(__test.parseInsights([])).toEqual([]);
    });
});

describe('syncOneOrg', () => {
    beforeEach(() => {
        integrationRepository.upsert.mockReset();
        integrationRepository.markFailed.mockReset();
    });

    it('pulls spend per account and replaces the org window in ad_metrics', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; };
        global.fetch = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({
                data: [
                    { campaign_id: 7, campaign_name: 'Brand', date_start: '2026-05-10',
                      spend: '3.00', impressions: '500', clicks: '20', actions: [{ action_type: 'lead', value: '2' }] },
                ],
                paging: {},
            }),
        }));

        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { account_ids: ['1112223333'] },
            expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), // fresh -> no refresh
        };
        const res = await syncOneOrg('org-1', integration);

        expect(res.rows).toBe(1);
        expect(res.accounts).toBe(1);
        const del = queries.find((q) => q.table === 'ad_metrics' && q.op === 'delete');
        expect(del.eqs).toEqual(expect.arrayContaining([
            { col: 'organisation_id', val: 'org-1' }, { col: 'provider', val: 'meta_ads' },
        ]));
        const ins = queries.find((q) => q.table === 'ad_metrics' && q.op === 'insert');
        expect(ins.insertVals).toEqual(expect.arrayContaining([
            expect.objectContaining({
                organisation_id: 'org-1', provider: 'meta_ads', customer_id: '1112223333',
                campaign_id: '7', spend_pence: 300, clicks: 20, conversions: 2,
            }),
        ]));
        expect(integrationRepository.upsert).toHaveBeenCalled();
    });

    it('marks failed when no credentials are stored', async () => {
        const res = await syncOneOrg('org-1', { secrets: null });
        expect(res.error).toBe('no_auth');
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });

    it('marks failed when no ad accounts are connected', async () => {
        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { account_ids: [] },
            expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        };
        await expect(syncOneOrg('org-1', integration)).rejects.toThrow(/accounts/);
        expect(integrationRepository.markFailed).toHaveBeenCalled();
    });
});
