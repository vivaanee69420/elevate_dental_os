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
    // One group per (campaign, source, practice). Each PERSON appears in
    // exactly one group, so the counts add up without double-counting.
    const funnel = [
        { ad_campaign_id: '120249721894530517', attribution_source: 'Paid Social', practice_id: 'p1',
          leads: 2, booked: 1, attended: 1, patients: 1, newPatients: 1 },
        { ad_campaign_id: '22794584316', attribution_source: 'Paid Search', practice_id: 'p1',
          leads: 1, booked: 1, attended: 0, patients: 1, newPatients: 0 },
        { ad_campaign_id: null, attribution_source: 'Referral', practice_id: 'p1',
          leads: 1, booked: 0, attended: 0, patients: 0, newPatients: 0 },
    ];

    it('computes cost per lead, per booking and per new patient in integer pence', () => {
        const { rows } = __test.joinSpendToLeads(spend, funnel);
        const meta = rows.find((r) => r.campaignId === '120249721894530517');
        expect(meta.leads).toBe(2);
        expect(meta.booked).toBe(1);
        expect(meta.attended).toBe(1);
        expect(meta.costPerLeadPence).toBe(73633);        // round(147265 / 2)
        expect(meta.costPerBookingPence).toBe(147265);    // 147265 / 1
        expect(meta.costPerNewPatientPence).toBe(147265); // 147265 / 1
    });

    it('sums several groups that share a campaign', () => {
        // The same campaign reached two practices, so it arrives as two groups.
        const split = [
            { ad_campaign_id: '22794584316', attribution_source: 'Paid Search', practice_id: 'p1',
              leads: 3, booked: 2, attended: 1, patients: 1, newPatients: 1 },
            { ad_campaign_id: '22794584316', attribution_source: 'Paid Search', practice_id: 'p2',
              leads: 4, booked: 1, attended: 0, patients: 2, newPatients: 1 },
        ];
        const { rows } = __test.joinSpendToLeads(spend, split);
        const g = rows.find((r) => r.campaignId === '22794584316');
        expect(g.leads).toBe(7);
        expect(g.booked).toBe(3);
        expect(g.attended).toBe(1);
        expect(g.patients).toBe(3);
    });

    it('never divides by zero — spend with no bookings has null CPB, not Infinity', () => {
        const noneBooked = [{ ad_campaign_id: '22794584316', attribution_source: 'Paid Search',
                              practice_id: null, leads: 4, booked: 0, attended: 0, patients: 0, newPatients: 0 }];
        const { rows } = __test.joinSpendToLeads(spend, noneBooked);
        const g = rows.find((r) => r.campaignId === '22794584316');
        expect(g.costPerBookingPence).toBeNull();
        expect(g.costPerNewPatientPence).toBeNull();
    });

    it('keeps unattributed leads out of every row but counted in totals', () => {
        const { rows, totals } = __test.joinSpendToLeads(spend, funnel);
        expect(rows.some((r) => r.campaignId === null)).toBe(false);
        expect(totals.unattributedLeads).toBe(1);
        expect(totals.leads).toBe(4);
    });

    it('reports platform conversions separately from real patients', () => {
        const { totals } = __test.joinSpendToLeads(spend, funnel);
        expect(totals.platformConversions).toBe(464);   // 412 + 52, from the ad platforms
        expect(totals.patients).toBe(2);                // matched to a Dentally record
    });

    it('totals the funnel over every person, and costs over the attributed ones', () => {
        const { totals } = __test.joinSpendToLeads(spend, funnel);
        expect(totals.booked).toBe(2);                 // everyone, referral included
        expect(totals.attended).toBe(1);
        expect(totals.attributedBooked).toBe(2);       // only campaigns with spend
        expect(totals.attributedNewPatients).toBe(1);
        expect(totals.costPerBookingPence).toBe(117967);      // round(235933 / 2)
        expect(totals.costPerNewPatientPence).toBe(235933);   // 235933 / 1
    });

    // A lead whose campaign has no spend IN THIS WINDOW produces no row. It
    // must still be accounted for, or the table silently loses people.
    it('reconciles: sum(rows.leads) + unattributedLeads === totals.leads', () => {
        const orphan = [...funnel, { ad_campaign_id: 'no-spend-here', attribution_source: 'Paid Social',
                                     practice_id: 'p1', leads: 6, booked: 0, attended: 0, patients: 0, newPatients: 0 }];
        const { rows, totals } = __test.joinSpendToLeads(spend, orphan);
        const shown = rows.reduce((n, r) => n + r.leads, 0);
        expect(shown + totals.unattributedLeads).toBe(totals.leads);
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
    const spend = [
        { provider: 'meta_ads', spendPence: 100000, impressions: 1000, clicks: 100, platformConversions: 10 },
        { provider: 'google_ads', spendPence: 50000, impressions: 500, clicks: 50, platformConversions: 5 },
    ];
    const campaignProvider = new Map([['m1', 'meta_ads'], ['g1', 'google_ads']]);
    const funnel = [
        { ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p1',
          leads: 10, booked: 4, attended: 2, patients: 3, newPatients: 2 },
        { ad_campaign_id: 'g1', attribution_source: 'Paid Search', practice_id: 'p1',
          leads: 5, booked: 2, attended: 1, patients: 1, newPatients: 1 },
        { ad_campaign_id: null, attribution_source: 'Referral', practice_id: 'p1',
          leads: 7, booked: 1, attended: 1, patients: 2, newPatients: 1 },
    ];

    it('carries booked and attended per channel', () => {
        const out = __test.channelSplit(spend, funnel, campaignProvider);
        const meta = out.find((c) => c.channel === 'meta_ads');
        expect(meta.leads).toBe(10);
        expect(meta.booked).toBe(4);
        expect(meta.attended).toBe(2);
    });

    it('gives the organic channel leads and bookings but never a cost', () => {
        // Organic enquiries cost nothing; averaging them into a paid
        // denominator would quietly flatter every cost per unit.
        const out = __test.channelSplit(spend, funnel, campaignProvider);
        const other = out.find((c) => c.channel === 'other');
        expect(other.leads).toBe(7);
        expect(other.booked).toBe(1);
        expect(other.costPerLeadPence).toBeNull();
        expect(other.costPerBookingPence).toBeNull();
    });

    it('every lead lands in exactly one channel, so channels sum to the total', () => {
        const out = __test.channelSplit(spend, funnel, campaignProvider);
        expect(out.reduce((n, c) => n + c.leads, 0)).toBe(22);
    });
});

describe('resolveLeadChannel', () => {
  const { resolveLeadChannel } = __test;
  const PROVIDER = new Map([['m1', 'meta_ads'], ['g1', 'google_ads']]);

  it('trusts a matched campaign id over the session source', () => {
    // GoHighLevel files some booked Facebook traffic under 'Social media';
    // 103 live contacts carry a campaign id while sitting outside both paid
    // buckets. The campaign id names its own provider, so it wins.
    expect(resolveLeadChannel(
      { ad_campaign_id: 'm1', attribution_source: 'Social media' }, PROVIDER,
    )).toBe('meta_ads');
  });

  it('falls back to the session source when the campaign is unknown to us', () => {
    expect(resolveLeadChannel(
      { ad_campaign_id: 'not-ours', attribution_source: 'Paid Search' }, PROVIDER,
    )).toBe('google_ads');
  });

  it('reads Paid Search as Google — gclid and Paid Search are coincident in the data', () => {
    expect(resolveLeadChannel({ attribution_source: 'Paid Search' }, PROVIDER)).toBe('google_ads');
  });

  it('reads Paid Social as Facebook', () => {
    expect(resolveLeadChannel({ attribution_source: 'Paid Social' }, PROVIDER)).toBe('meta_ads');
  });

  it('does NOT fold organic social into paid Facebook', () => {
    // It cost nothing; averaging it into the paid denominator would flatter
    // cost per lead.
    expect(resolveLeadChannel({ attribution_source: 'Social media' }, PROVIDER)).toBe('other');
  });

  it('puts an unattributed lead in other, never in a paid channel', () => {
    expect(resolveLeadChannel({ ad_campaign_id: null, attribution_source: null }, PROVIDER)).toBe('other');
  });

  it('is case-insensitive about the session source', () => {
    expect(resolveLeadChannel({ attribution_source: 'PAID SEARCH' }, PROVIDER)).toBe('google_ads');
  });
});

describe('cacheKey payload version', () => {
  it('carries a version segment', () => {
    expect(__test.cacheKey('s', 'u', null)).toMatch(/^marketing:perf:v\d+:/);
  });

  it('never collides with a key written by an earlier payload shape', () => {
    const current = __test.cacheKey('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', null);
    const v1 = 'marketing:perf:2026-08-01T00:00:00Z|2026-09-01T00:00:00Z|all';
    expect(current).not.toBe(v1);
  });
});

// The Leads tile counts every person who enquired; the Became patients tile
// beside it must count that same population. It used to count only
// campaign-matched patients, so the pair implied a conversion rate about a
// third of the real one — and it contradicted the per-channel cards, whose
// patients sum to every converted lead.
describe('totals.patients population', () => {
  const { joinSpendToLeads } = __test;
  const SPEND = [{
    provider: 'meta_ads', campaign_id: 'm1', campaign_name: 'A',
    spend_pence: 10000, impressions: 0, clicks: 0, conversions: 0,
  }];
  // The same four people as before, now grouped: a and b share a campaign AND a
  // source, so they are ONE group of two. c's campaign has no spend in this
  // window; d is organic.
  const FUNNEL = [
    { ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: null,
      leads: 2, booked: 0, attended: 0, patients: 1, newPatients: 0 },
    { ad_campaign_id: 'zz', attribution_source: 'Paid Search', practice_id: null,
      leads: 1, booked: 0, attended: 0, patients: 1, newPatients: 0 },
    { ad_campaign_id: null, attribution_source: 'Social media', practice_id: null,
      leads: 1, booked: 0, attended: 0, patients: 1, newPatients: 0 },
  ];

  it('counts every converted person, not only the campaign-matched ones', () => {
    const { totals } = joinSpendToLeads(SPEND, FUNNEL);
    expect(totals.leads).toBe(4);
    expect(totals.patients).toBe(3);           // the m1, zz and organic converters
    expect(totals.attributedPatients).toBe(1); // only m1 sits on a campaign with spend
  });

  it('still divides spend by the attributable patients, never by all of them', () => {
    const { totals } = joinSpendToLeads(SPEND, FUNNEL);
    expect(totals.costPerPatientPence).toBe(10000);   // 10000 / 1, not / 3
  });

  it('reconciles with the channel cards — both count the same patients', () => {
    const { rows, totals } = joinSpendToLeads(SPEND, FUNNEL);
    const provider = new Map(SPEND.map((c) => [c.campaign_id, c.provider]));
    const channels = __test.channelSplit(rows, FUNNEL, provider);
    expect(channels.reduce((n, c) => n + c.patients, 0)).toBe(totals.patients);
    expect(channels.reduce((n, c) => n + c.leads, 0)).toBe(totals.leads);
  });
});

describe('practiceSplit', () => {
    const campaignProvider = new Map([['m1', 'meta_ads']]);
    const funnel = [
        { ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p1',
          leads: 10, booked: 4, attended: 2, patients: 3, newPatients: 2 },
        { ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p2',
          leads: 6, booked: 1, attended: 0, patients: 1, newPatients: 1 },
    ];

    it('carries booked per practice and costs it against that practice spend', () => {
        const out = __test.practiceSplit([['p1', 200000], ['p2', 60000]], funnel, campaignProvider);
        const p1 = out.find((p) => p.practiceId === 'p1');
        expect(p1.booked).toBe(4);
        expect(p1.costPerBookingPence).toBe(50000);       // 200000 / 4
        expect(p1.costPerNewPatientPence).toBe(100000);   // 200000 / 2
    });

    it('has no cost per booking where the practice booked nobody', () => {
        const none = [{ ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p3',
                        leads: 3, booked: 0, attended: 0, patients: 0, newPatients: 0 }];
        const out = __test.practiceSplit([['p3', 90000]], none, campaignProvider);
        expect(out[0].costPerBookingPence).toBeNull();
    });

    it('practices sum to the group total rather than double-counting', () => {
        const out = __test.practiceSplit([['p1', 200000], ['p2', 60000]], funnel, campaignProvider);
        expect(out.reduce((n, p) => n + p.leads, 0)).toBe(16);
    });
});
