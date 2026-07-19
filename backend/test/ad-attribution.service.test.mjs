import { describe, it, expect } from 'vitest';
import {
  resolveChannel, ratio, computePerformance,
} from '../src/services/ad-attribution.service.js';

describe('resolveChannel', () => {
  const map = new Map([['acc1|pl1', 'google_ads']]);

  it('returns the mapped channel', () => {
    expect(resolveChannel(map, 'acc1', 'pl1')).toBe('google_ads');
  });

  it('returns unassigned when no row exists — it never guesses from the name', () => {
    expect(resolveChannel(map, 'acc1', 'pl2')).toBe('unassigned');
  });

  it('does not leak a mapping across subaccounts', () => {
    expect(resolveChannel(map, 'acc2', 'pl1')).toBe('unassigned');
  });
});

describe('ratio', () => {
  it('divides normally', () => {
    expect(ratio(1000, 4)).toBe(250);
  });

  it('returns null on a zero denominator rather than 0 or Infinity', () => {
    // A cost per lead of 0 reads as "free leads"; Infinity crashes formatting.
    expect(ratio(1000, 0)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
  });
});

describe('computePerformance', () => {
  const accountPractice = new Map([['acc1', 'p1'], ['acc2', null]]);
  const channelMap = new Map([
    ['acc1|g', 'google_ads'],
    ['acc1|f', 'meta_ads'],
  ]);

  it('counts one lead per PERSON, not per opportunity row', () => {
    // Counting rows is what produced the earlier inflated lead count: one
    // person sitting in two pipelines is one lead, not two.
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
      { id: 'l2', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-03', contacts: {} },
    ];
    const out = computePerformance({ leads, accepted: [], spend: [], channelMap, accountPractice });
    expect(out.channels.find((c) => c.channel === 'google_ads').leads).toBe(1);
  });

  it('buckets an unmapped pipeline into unassigned with null spend', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'other', created_at: '2026-07-02', contacts: {} },
    ];
    const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 50000, metric_date: '2026-07-02' }];
    const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });
    const un = out.channels.find((c) => c.channel === 'unassigned');
    expect(un.leads).toBe(1);
    // There is no spend to attribute to unassigned; zero would read as free leads.
    expect(un.spendPence).toBeNull();
    expect(un.costPerLeadPence).toBeNull();
  });

  it('computes cost per lead and cost per acquisition from matched conversions', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: { phone: '07700900123' } },
      { id: 'l2', contact_id: 'c2', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: { phone: '07700900999' } },
    ];
    const accepted = [
      { phone: '07700900123', value_pence: 400000, patient_name: 'Jo Bloggs', practice_id: 'p1' },
    ];
    const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 100000, metric_date: '2026-07-02' }];
    const out = computePerformance({ leads, accepted, spend, channelMap, accountPractice });
    const g = out.channels.find((c) => c.channel === 'google_ads');
    expect(g.leads).toBe(2);
    expect(g.conversions).toBe(1);
    expect(g.acceptedValuePence).toBe(400000);
    expect(g.spendPence).toBe(100000);
    expect(g.costPerLeadPence).toBe(50000);
    expect(g.costPerAcquisitionPence).toBe(100000);
    expect(g.conversionRate).toBeCloseTo(0.5);
  });

  it('excludes leads from a subaccount with no practice mapping', () => {
    // The Plan4Growth academy Location holds pipelines literally named
    // "Facebook Leads" that are business leads, not patient leads. Leaving a
    // subaccount unmapped must exclude it, not silently fold it in.
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc2', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
    ];
    const out = computePerformance({ leads, accepted: [], spend: [], channelMap, accountPractice });
    const total = out.channels.reduce((n, c) => n + c.leads, 0);
    expect(total).toBe(0);
    expect(out.excludedUnmappedLeads).toBe(1);
  });

  it('reports null spend for a practice with no mapped ad account', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
    ];
    // Spend rows exist but carry no practice_id, so no practice can claim them.
    const spend = [{ provider: 'google_ads', practice_id: null, spend_pence: 100000, metric_date: '2026-07-02' }];
    const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });
    const row = out.byPractice.find((p) => p.practiceId === 'p1');
    const g = row.channels.find((c) => c.channel === 'google_ads');
    // "Not reporting", never a fabricated £0.
    expect(g.spendPence).toBeNull();
    // Group level still sees the spend.
    expect(out.channels.find((c) => c.channel === 'google_ads').spendPence).toBe(100000);
  });
});
