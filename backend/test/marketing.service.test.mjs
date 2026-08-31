// Tier model + campaign aggregation. Every figure must declare which tier it
// came from: a blended number must never present itself as a measured one.
import { describe, it, expect } from 'vitest';
const { __test } = await import('../src/services/marketing.service.js');

describe('resolveTier', () => {
    it('campaign tier when the lead carries a campaign id', () => {
        expect(__test.resolveTier({ ad_campaign_id: '120249721894530517' })).toBe('campaign');
    });
    it('channel tier when only a mapped pipeline channel is known', () => {
        expect(__test.resolveTier({ ad_campaign_id: null, channel: 'meta_ads' })).toBe('channel');
    });
    it('unattributed when neither is present', () => {
        expect(__test.resolveTier({ ad_campaign_id: null, channel: null })).toBe('unattributed');
    });
    it('campaign id WINS over a pipeline channel — tiers are strictly ordered', () => {
        // A lead that resolves at campaign level never consults the pipeline map.
        expect(__test.resolveTier({ ad_campaign_id: '111', channel: 'google_ads' })).toBe('campaign');
    });
});

describe('joinSpendToLeads', () => {
    const spend = [
        { provider: 'meta_ads', campaign_id: '120249721894530517', campaign_name: 'Dental Implant Open Day Sept 26',
          spend_pence: 147265, impressions: 105437, clicks: 2400, conversions: 412 },
        { provider: 'google_ads', campaign_id: '22794584316', campaign_name: '.G New Patient',
          spend_pence: 88668, impressions: 10916, clicks: 764, conversions: 52 },
    ];
    const leads = [
        { ad_campaign_id: '120249721894530517', contact_id: 'c1', converted: true },
        { ad_campaign_id: '120249721894530517', contact_id: 'c2', converted: false },
        { ad_campaign_id: '22794584316', contact_id: 'c3', converted: true },
        { ad_campaign_id: null, contact_id: 'c4', converted: false },
    ];

    it('computes cost per lead in integer pence, per campaign', () => {
        const { rows } = __test.joinSpendToLeads(spend, leads);
        const meta = rows.find((r) => r.campaignId === '120249721894530517');
        expect(meta.leads).toBe(2);
        expect(meta.spendPence).toBe(147265);
        expect(meta.costPerLeadPence).toBe(73633);  // round(147265 / 2)
        expect(meta.patients).toBe(1);
        expect(meta.costPerPatientPence).toBe(147265);
    });

    it('counts PEOPLE, not lead rows — one contact in two pipelines is one lead', () => {
        const dupes = [
            { ad_campaign_id: '22794584316', contact_id: 'c9', converted: false },
            { ad_campaign_id: '22794584316', contact_id: 'c9', converted: false },
        ];
        const { rows } = __test.joinSpendToLeads(spend, dupes);
        expect(rows.find((r) => r.campaignId === '22794584316').leads).toBe(1);
    });

    it('never divides by zero — a campaign with spend and no leads has null CPL, not Infinity', () => {
        const { rows } = __test.joinSpendToLeads(spend, []);
        expect(rows.every((r) => r.costPerLeadPence === null)).toBe(true);
    });

    it('keeps unattributed leads out of every campaign row but counted in totals', () => {
        const { rows, totals } = __test.joinSpendToLeads(spend, leads);
        expect(rows.some((r) => r.campaignId === null)).toBe(false);
        expect(totals.unattributedLeads).toBe(1);
        expect(totals.leads).toBe(4);
    });

    it('reports platform conversions separately from real patients', () => {
        // Google/Facebook count a form submission; we count someone in Dentally.
        const { totals } = __test.joinSpendToLeads(spend, leads);
        expect(totals.platformConversions).toBe(464);   // 412 + 52
        expect(totals.patients).toBe(2);
    });
});
