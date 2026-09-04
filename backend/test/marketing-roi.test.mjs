// ============================================================================
// marketingRoi service (Marketing & ROI, GM Intelligence OS T11). Per-channel
// acquisition economics from REAL ad_metrics (spend) + CRM leads (attribution +
// conversion) + settled revenue. HONEST: revenue is NOT attributed per channel
// (only a business-level blended paid ROAS); conversions = leads reaching
// treatment_started/completed, one consistent definition across all channels.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-mkmkmkmk';
const now = () => new Date(Date.UTC(2026, 4, 15)); // 2026-05-15

const PRACTICES = [
  { id: 'p1', name: 'Rochester', chairs: 6, assumed_util_pct: 84 },
  { id: 'p2', name: 'Barnet', chairs: 5, assumed_util_pct: null },
];
const AD_ROWS = [
  { provider: 'google_ads', spend_pence: 200000, impressions: 1000, clicks: 100, conversions: 5, practice_id: null },
  { provider: 'meta_ads', spend_pence: 100000, impressions: 800, clicks: 60, conversions: 2, practice_id: null },
];
const LEADS = [
  { source: 'google', utm_source: 'google', utm_medium: 'cpc', status: 'treatment_started', practice_id: 'p1' },
  { source: 'google', status: 'new', practice_id: 'p1' },
  { source: 'facebook', status: 'treatment_completed', practice_id: 'p1' },
  { source: 'seo', status: 'treatment_started', practice_id: 'p2' },
  { source: 'referral', status: 'new', practice_id: 'p2' },
];
const REV = [
  { practice_id: 'p1', pence: 1500000 },
  { practice_id: 'p2', pence: 500000 },
];

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.rpcCalls = [];
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

function stub({ ad = AD_ROWS, leads = LEADS, rev = REV } = {}) {
  supaRec.resultProvider = (q) => {
    if (q.table === 'leads') return { data: leads, error: null };
    if (q.table === 'practices') return { data: PRACTICES, error: null };
    return { data: [], error: null };
  };
  // Ad spend is SUMMED IN SQL now (ad_metrics_rollup) rather than read row by
  // row: the live org holds 3,899 ad_metrics rows in a 90-day window and 1,079
  // in 30 days, both past PostgREST's silent row ceiling, so spend — and the
  // ROAS built on it — were partial sums shown as totals.
  supaRec.rpcProvider = (fn) =>
    fn === 'settled_revenue_by_practice' ? { data: rev, error: null }
    : fn === 'ad_metrics_rollup' ? { data: ad, error: null }
    : { data: [], error: null };
}

describe('marketingRoi', () => {
  it('builds real per-channel spend/leads/conversions + business-level blended ROAS', async () => {
    stub();
    const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

    expect(r.applicable).toBe(true);
    expect(r.connected).toBe(true);
    expect(r.hasLeads).toBe(true);
    expect(r.revenuePerChannelAvailable).toBe(false);

    const g = r.channels.find((c) => c.key === 'google_ads');
    expect(g).toMatchObject({ spendPence: 200000, leads: 2, conversions: 1, cpaPence: 200000, convRatePct: 50 });
    expect(g.leadSharePct).toBe(40); // 2 of 5 leads
    expect(r.channels.find((c) => c.key === 'seo')).toMatchObject({ spendPence: 0, leads: 1, conversions: 1 });

    expect(r.paidSpendPence).toBe(300000);
    expect(r.totalLeads).toBe(5);
    expect(r.totalConversions).toBe(3);

    // Business-level blended ROAS = settled revenue / paid spend (NOT per channel).
    expect(r.settledRevenuePence).toBe(2000000);
    expect(r.blendedRoas).toBe(6.67);
    expect(r.blendedRoiPct).toBe(567);

    // No per-channel revenue/roas fields fabricated.
    for (const c of r.channels) expect('roas' in c).toBe(false);
  });

  it('per-practice acquisition: patients/revenue real; no account->practice mapping → platform leads 0, no per-site ROAS', async () => {
    stub();
    const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.byPracticeAvailable).toBe(true);
    expect(r.adSpendPerPracticeAvailable).toBe(false);
    // Leads now come from the ad platforms via the account->practice mapping;
    // with no mapping, leads are 0. Patients (CRM) + revenue (settled) stay real.
    expect(r.byPractice[0]).toMatchObject({ id: 'p1', leads: 0, conversions: 2, revenuePence: 1500000, roas: null });
  });

  it('per-practice acquisition: account->practice mapping attributes platform leads + spend + real per-site ROAS', async () => {
    const ad = [
      { provider: 'google_ads', customer_id: 'g1', spend_pence: 200000, impressions: 1000, clicks: 100, conversions: 5, practice_id: null },
      { provider: 'meta_ads', customer_id: 'm1', spend_pence: 100000, impressions: 800, clicks: 60, conversions: 3, practice_id: null },
    ];
    const accounts = [
      { provider: 'google_ads', customer_id: 'g1', name: 'Rochester Ads', currency: 'GBP', status: 'active', is_selected: true, practice_id: 'p1' },
      { provider: 'meta_ads', customer_id: 'm1', name: 'Barnet Ads', currency: 'GBP', status: 'active', is_selected: true, practice_id: 'p2' },
    ];
    supaRec.resultProvider = (q) => {
      if (q.table === 'leads') return { data: LEADS, error: null };
      if (q.table === 'practices') return { data: PRACTICES, error: null };
      if (q.table === 'ad_accounts') return { data: accounts, error: null };
      return { data: [], error: null };
    };
    supaRec.rpcProvider = (fn) =>
      fn === 'settled_revenue_by_practice' ? { data: REV, error: null }
      : fn === 'ad_metrics_rollup' ? { data: ad, error: null }
      : { data: [], error: null };

    const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.adSpendPerPracticeAvailable).toBe(true);
    const p1 = r.byPractice.find((x) => x.id === 'p1');
    const p2 = r.byPractice.find((x) => x.id === 'p2');
    // p1: google account -> 5 platform conversions, 200000 spend, 1500000 revenue -> ROAS 7.5
    expect(p1).toMatchObject({ leads: 5, conversions: 2, spendPence: 200000, revenuePence: 1500000, roas: 7.5 });
    // p2: meta account -> 3 conversions, 100000 spend, 500000 revenue -> ROAS 5
    expect(p2).toMatchObject({ leads: 3, conversions: 1, spendPence: 100000, revenuePence: 500000, roas: 5 });
  });

  it('emits a blended-ROAS Decision Lens card', async () => {
    stub();
    const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.insights.some((i) => /Blended paid ROAS/.test(i.title))).toBe(true);
  });

  it('entity scope filters revenue to that practice (JS-side)', async () => {
    stub();
    const r = await svc.marketingRoi(ORG, { scope: 'p2', period: 'month', periodKey: '2026-05', now });
    expect(r.settledRevenuePence).toBe(500000);
  });

  it('no ad spend connected -> connected false, blendedRoas null, leads still real', async () => {
    stub({ ad: [] });
    const r = await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.connected).toBe(false);
    expect(r.blendedRoas).toBe(null);
    expect(r.totalLeads).toBe(5);
    expect(r.insights.some((i) => /No ad spend connected/.test(i.title))).toBe(true);
  });

  it('windows ad_metrics inclusively (lt-corrected toDate) and leads to the month', async () => {
    stub();
    await svc.marketingRoi(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    const rpc = supaRec.rpcCalls.find((c) => c.fn === 'settled_revenue_by_practice');
    expect(rpc.params.p_since).toBe('2026-05-01T00:00:00.000Z');
    expect(rpc.params.p_until).toBe('2026-06-01T00:00:00.000Z');
  });
});
