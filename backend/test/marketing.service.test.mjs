// Campaign aggregation. Every figure must be measured against the population it
// claims: a blended number must never present itself as a measured one, and the
// table must reconcile to the tiles above it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { __test } = await import('../src/services/marketing.service.js');

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

    // A lead whose campaign has no spend IN THIS WINDOW produces no row. It must
    // still be accounted for, or the table silently loses people.
    const strayCampaignLeads = [
        ...leads,
        { ad_campaign_id: '999999999', contact_id: 'c5', converted: false }, // no spend row
    ];

    it('the table reconciles to the tiles: sum(rows.leads) + unattributed === leads', () => {
        const { rows, totals } = __test.joinSpendToLeads(spend, strayCampaignLeads);
        const inRows = rows.reduce((n, r) => n + r.leads, 0);
        expect(inRows + totals.unattributedLeads).toBe(totals.leads);
    });

    it('counts a lead whose campaign has no spend row as unattributed', () => {
        const { totals } = __test.joinSpendToLeads(spend, strayCampaignLeads);
        expect(totals.leads).toBe(5);
        expect(totals.attributedLeads).toBe(3);      // c1, c2, c3
        expect(totals.unattributedLeads).toBe(2);    // c4 (no id) + c5 (unspent campaign)
    });

    it('costs divide spend by the ATTRIBUTED population, not every enquirer', () => {
        const { totals } = __test.joinSpendToLeads(spend, strayCampaignLeads);
        const spendPence = 147265 + 88668;           // 235933
        expect(totals.spendPence).toBe(spendPence);
        // Attributed leads (3), NOT totals.leads (5): paid spend must never be
        // charged against organic or unspent-campaign enquiries.
        expect(totals.costPerLeadPence).toBe(Math.round(spendPence / 3));
        expect(totals.costPerPatientPence).toBe(Math.round(spendPence / 2));
    });

    it('no attributed leads at all yields null costs, never Infinity or 0', () => {
        const { totals } = __test.joinSpendToLeads(spend, [
            { ad_campaign_id: null, contact_id: 'c8', converted: false },
        ]);
        expect(totals.attributedLeads).toBe(0);
        expect(totals.costPerLeadPence).toBeNull();
        expect(totals.costPerPatientPence).toBeNull();
    });
});


// The marketing payload is cached per org + window + practice. Ad spend arrives
// from a nightly sync and leads from the GoHighLevel sync, so it cannot change
// minute to minute — and both marketing screens plus every practice-toggle ask
// for the same window.
describe('cache key', () => {
    it('separates orgs implicitly and windows/practices explicitly', () => {
        const a = __test.cacheKey('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', null);
        const b = __test.cacheKey('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'practice-1');
        const c = __test.cacheKey('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z', null);
        // A practice-scoped payload must never be served for "all practices",
        // and a different window must never reuse another window's figures.
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
        // The org is NOT in the key: readDashboardCache/writeDashboardCache are
        // org-scoped by their own organisation_id filter, so folding the org in
        // here would be redundant — but the cache must stay org-scoped there.
        expect(a).not.toContain('org');
    });
    it('is stable for the same inputs, or the cache would never hit', () => {
        expect(__test.cacheKey('s', 'u', null)).toBe(__test.cacheKey('s', 'u', null));
    });
});
