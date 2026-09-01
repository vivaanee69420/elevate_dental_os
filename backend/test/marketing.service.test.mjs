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

// £0.00 on a practice is ambiguous. It reads as "this practice spent nothing"
// when the truth may be "no ad account is mapped to it, so none of the group's
// spend can be attributed here" — the exact state that made the Marketing
// overview show Barnet £0.00 beside 315 leads. coverage is what lets the
// screen tell those two apart.
describe('buildCoverage', () => {
  const { buildCoverage } = __test;
  const ACC = [
    { provider: 'meta_ads', customer_id: 'm1', name: 'GM Barnet', practice_id: 'prac-barnet' },
    { provider: 'google_ads', customer_id: 'g1', name: 'GM Rochester', practice_id: 'prac-roch' },
    { provider: 'google_ads', customer_id: 'g2', name: 'Snoreeze', practice_id: null },
  ];

  it('flags a scoped practice that has no ad account mapped to it', () => {
    const c = buildCoverage(ACC, 'prac-ashford', 5000);
    expect(c.practiceHasMappedAccount).toBe(false);
    expect(c.unmappedAccounts).toBe(1);
    expect(c.unmappedAccountNames).toEqual(['Snoreeze']);
  });

  it('confirms a scoped practice that does have one', () => {
    expect(buildCoverage(ACC, 'prac-barnet', 5000).practiceHasMappedAccount).toBe(true);
  });

  it('reports unmapped spend only on the group view', () => {
    // Group view: the money is in the total the user can see, so name it.
    expect(buildCoverage(ACC, null, 5000).unmappedSpendPence).toBe(5000);
    // Practice view: the query already excluded those rows, so surfacing the
    // figure would be a number that appears in no tile on the page.
    expect(buildCoverage(ACC, 'prac-barnet', 5000).unmappedSpendPence).toBe(0);
    expect(buildCoverage(ACC, null, 5000).practiceHasMappedAccount).toBeNull();
  });

  it('handles an org with no ad accounts connected at all', () => {
    const c = buildCoverage([], null, 0);
    expect(c).toMatchObject({ totalAccounts: 0, mappedAccounts: 0, unmappedAccounts: 0 });
  });
});

describe('channelSplit', () => {
  const { channelSplit } = __test;
  const ROWS = [
    { provider: 'meta_ads', spendPence: 4000, impressions: 10, clicks: 5, platformConversions: 2, leads: 8, patients: 2 },
    { provider: 'meta_ads', spendPence: 1000, impressions: 5, clicks: 1, platformConversions: 1, leads: 2, patients: 0 },
    { provider: 'google_ads', spendPence: 3000, impressions: 7, clicks: 4, platformConversions: 3, leads: 5, patients: 1 },
  ];

  it('rolls campaigns up per channel, highest spend first', () => {
    const out = channelSplit(ROWS);
    expect(out.map((c) => c.provider)).toEqual(['meta_ads', 'google_ads']);
    expect(out[0]).toMatchObject({ spendPence: 5000, leads: 10, patients: 2, campaigns: 2 });
  });

  it('reconciles to the table total — the channels cannot disagree with the tiles', () => {
    const out = channelSplit(ROWS);
    expect(out.reduce((n, c) => n + c.spendPence, 0))
      .toBe(ROWS.reduce((n, r) => n + r.spendPence, 0));
  });

  it('gives no cost per patient to a channel that won none', () => {
    const out = channelSplit([{ provider: 'meta_ads', spendPence: 1000, impressions: 0, clicks: 0, platformConversions: 0, leads: 3, patients: 0 }]);
    expect(out[0].costPerLeadPence).toBe(333);
    expect(out[0].costPerPatientPence).toBeNull();   // never Infinity, never 0
  });
});
