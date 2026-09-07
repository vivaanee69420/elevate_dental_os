// ============================================================================
// Business Hub hardening — the defects found auditing the page, pinned so they
// cannot come back. Each block names the wrong number it produced.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { clampDays } from '../src/controllers/analytics.controller.js';
import { analyticsRepository } from '../src/repositories/analytics.repository.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-hub-hardening';

beforeEach(() => {
  supaRec.rpcCalls = [];
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
  svc.invalidateBusinessHub(ORG);
});

// ---------------------------------------------------------------------------
describe('the trailing-window length is clamped', () => {
  // `Number(req.query.days) || 90` accepted anything. A negative put `since` in
  // the FUTURE and inverted the prior-period comparison (winMs = days * 86400000
  // went negative), so the "vs last period" chip compared the window against a
  // window that ran backwards out of it.
  it('rejects a negative, a zero and junk, falling back to the default', () => {
    expect(clampDays('-5')).toBe(90);
    expect(clampDays('0')).toBe(90);
    expect(clampDays('abc')).toBe(90);
    expect(clampDays(undefined)).toBe(90);
    expect(clampDays(Number.NaN)).toBe(90);
    expect(clampDays(Infinity)).toBe(90);
  });

  it('caps an absurd window', () => {
    // Unbounded values were not only an expensive scan: the payload cache is one
    // 300-entry LRU shared by every tenant, keyed on the window, so a caller
    // issuing distinct windows could evict every OTHER tenant's cached payload.
    expect(clampDays('99999999')).toBe(1827);
    expect(clampDays('365')).toBe(365);
  });

  it('takes the floor rather than passing a fraction into date arithmetic', () => {
    expect(clampDays('30.7')).toBe(30);
  });
});

// ---------------------------------------------------------------------------
describe('the revenue target is pro-rated to the window', () => {
  const practices = [{ id: 'p1', name: 'Alpha', chairs: 4 }];
  const baseline = { revenue: 1_200_000 }; // £1.2m ANNUAL, in pounds

  function stub() {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: practices, error: null }
      : q.table === 'business_health' ? { data: { baseline }, error: null }
      : { data: [], error: null };
  }

  it('a one-month window compares against a month of the annual goal, not the year', async () => {
    // `baseline.revenue` is an ANNUAL figure — business-health labels it "Annual
    // revenue" and every other reader divides it by 12. This card compared it
    // UNSCALED against one window's revenue, so a group exactly on plan for the
    // month rendered "-£1,200,000 vs target" in warning amber. The `developer`
    // org has £800,000 set today, so this was live.
    stub();
    // LONDON midnights, which is what the period pickers send. A UTC-midnight
    // pair looks like the same month but spans 31 London days through BST
    // (01:00 on 1 Jun to 01:00 on 1 Jul touches 31 dates), so a fixture built
    // that way pro-rates over a month that is one day too long.
    const res = await svc.businessHub(ORG, {
      since: '2026-05-31T23:00:00.000Z', until: '2026-06-30T23:00:00.000Z', label: 'Jun 2026',
      now: () => new Date('2026-07-20T09:00:00.000Z'),
    });
    expect(res.group.revenueTargetAnnualPence).toBe(120_000_000);
    expect(res.group.revenueTargetPence).toBe(Math.round((120_000_000 * 30) / 365));
    // Sanity: a month's slice must be nowhere near the annual figure.
    expect(res.group.revenueTargetPence).toBeLessThan(res.group.revenueTargetAnnualPence / 10);
  });

  it('a finished year recovers the whole annual goal', async () => {
    stub();
    svc.invalidateBusinessHub(ORG);
    const res = await svc.businessHub(ORG, {
      since: '2025-01-01T00:00:00.000Z', until: '2026-01-01T00:00:00.000Z', label: '2025',
      now: () => new Date('2026-03-01T09:00:00.000Z'),
    });
    expect(res.group.revenueTargetPence).toBe(120_000_000);
  });

  it('a year still running pro-rates the goal to the days elapsed', async () => {
    // The revenue figure beside this target covers 1 Jan to today, because a
    // running window is clamped there — appointments and invoices carry future
    // rows and an unclamped window would count bookings that have not happened.
    // The target has to cover the same span or a group two thirds through the
    // year is measured against a full year's goal and reads as far behind when
    // it is on plan. 1 Jan – 6 Sep 2026 inclusive is 249 days.
    stub();
    svc.invalidateBusinessHub(ORG);
    const res = await svc.businessHub(ORG, {
      since: '2026-01-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z', label: '2026',
      now: () => new Date('2026-09-06T13:20:00.000Z'),
    });
    expect(res.group.revenueTargetPence).toBe(Math.round((120_000_000 * 249) / 365));
    expect(res.group.compare.current.label).toBe('1 Jan – 6 Sep 2026');
  });

  it('no baseline means no target, not a zero one to miss', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: practices, error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : { data: [], error: null };
    svc.invalidateBusinessHub(ORG);
    const res = await svc.businessHub(ORG, { days: 30 });
    expect(res.group.revenueTargetPence).toBe(0);
    expect(res.group.revenueTargetAnnualPence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('a rate with no denominator is null, never a confident zero', () => {
  it('a practice with no leads reports an unknown conversion rate', async () => {
    // It used to report 0, which the UI rendered as a RED "0%" chip — a practice
    // that ran no campaigns was graded as converting badly.
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
      : { data: [], error: null };
    supaRec.rpcProvider = (fn) =>
      fn === 'appointments_rollup_by_practice'
        ? { data: [{ practice_id: 'p1', total: 5, completed: 5, no_shows: 0 }], error: null }
        : { data: [], error: null };
    const res = await svc.businessHub(ORG, { days: 30 });
    expect(res.practices[0].leads).toBe(0);
    expect(res.practices[0].conversionRate).toBeNull();
    expect(res.practices[0].crmConversionRate).toBeNull();
    expect(res.group.conversionRate).toBeNull();
    expect(res.group.leadToStartRate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('leads are windowed in trailing-days mode too', () => {
  it('the lead rollup gets the same lower bound as every other feed', async () => {
    // `leadSinceISO` used to be null unless an explicit `until` was set, so a
    // trailing-days call ran the lead rollup ALL-TIME while revenue and
    // appointments beside it covered N days. The conversion rate then divided a
    // windowed numerator by an unbounded denominator and sank as a tenant
    // accumulated history.
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
      : { data: [], error: null };
    await svc.businessHub(ORG, { days: 30, now: () => new Date('2026-06-30T00:00:00.000Z') });
    const leadCall = supaRec.rpcCalls.find((c) => c.fn === 'leads_rollup_by_practice');
    const revCall = supaRec.rpcCalls.find((c) => c.fn === 'settled_revenue_by_practice');
    expect(leadCall.params.p_since).not.toBeNull();
    expect(leadCall.params.p_since).toBe(revCall.params.p_since);
  });
});

// ---------------------------------------------------------------------------
describe('ad-platform leads are summed in SQL, not read through a row ceiling', () => {
  it('adLeadsByProvider calls the aggregate and never a raw ad_metrics select', async () => {
    // `.limit(5000)` does NOT lift PostgREST's server-side ceiling — measured on
    // this database in monthlyFinancial.repository. ad_metrics holds 3,899 rows
    // for the live org in a 90-day window, so roughly three quarters of its
    // conversions were dropped, with no ORDER BY to say which. Because this
    // figure is the conversion rate's DENOMINATOR, truncating it made conversion
    // look BETTER than it was.
    const tables = [];
    supaRec.resultProvider = (q) => { tables.push(q.table); return { data: [], error: null }; };
    supaRec.rpcProvider = (fn) =>
      fn === 'ad_leads_by_provider'
        ? { data: [
            { provider: 'google_ads', conversions: '1234.5', spend_pence: 999 },
            { provider: 'meta_ads', conversions: 4321, spend_pence: 111 },
          ], error: null }
        : { data: [], error: null };

    const by = await analyticsRepository.adLeadsByProvider(ORG, '2026-06-01', '2026-08-31');

    expect(supaRec.rpcCalls.map((c) => c.fn)).toContain('ad_leads_by_provider');
    expect(tables).not.toContain('ad_metrics');
    // Fractional conversions survive: Google reports modelled conversions, and
    // ad_metrics.conversions is numeric(14,2) for exactly that reason.
    expect(by.get('google_ads')).toBe(1234.5);
    expect(by.get('meta_ads')).toBe(4321);
  });

  it('passes the caller org through as the only tenant scope', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    await analyticsRepository.adLeadsByProvider(ORG, '2026-06-01', '2026-08-31');
    const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_leads_by_provider');
    expect(call.params.p_org).toBe(ORG);
    expect(call.params.p_from).toBe('2026-06-01');
    expect(call.params.p_to).toBe('2026-08-31');
  });
});

// ---------------------------------------------------------------------------
describe('leadsForMarketing pages past the row ceiling', () => {
  it('keeps reading until a page comes back EMPTY, not merely short', async () => {
    // Stopping on a SHORT page is safe only when the page size matches the
    // server ceiling exactly. Stopping on an EMPTY one is safe either way, and
    // this read feeds every channel count and cost-per-lead on the page.
    // The harness honours .range() by slicing the provider's rows, exactly as a
    // real server does — so the provider hands back the WHOLE set and the
    // repository has to page through it. A reader that ignored .range() would
    // re-read page one forever and never reach the empty page.
    const ALL = Array.from({ length: 2037 }, (_, i) => ({ id: `l${String(i).padStart(5, '0')}`, source: 'google', status: 'new' }));
    let call = 0;
    supaRec.resultProvider = (q) => {
      if (q.table !== 'leads') return { data: [], error: null };
      call += 1;
      return { data: ALL, error: null };
    };
    const rows = await analyticsRepository.leadsForMarketing(ORG, '2026-06-01T00:00:00Z', '2026-09-01T00:00:00Z');
    // 2,037 rows — well past the ceiling a single read would have stopped at.
    expect(rows).toHaveLength(2037);
    expect(rows[0].id).toBe('l00000');
    expect(rows[2036].id).toBe('l02036');
    // 1000 + 1000 + 37, then one more read that comes back empty and ends it.
    expect(call).toBe(4);
  });
});
