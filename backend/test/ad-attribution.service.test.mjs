import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { adAttributionRepository } from '../src/repositories/ad-attribution.repository.js';
import { adChannelPipelineRepository } from '../src/repositories/ad-channel-pipeline.repository.js';
import {
  resolveChannel, ratio, computePerformance, adAttributionService, accountPracticeByCustomerId,
} from '../src/services/ad-attribution.service.js';

vi.mock('../src/repositories/ad-attribution.repository.js', () => ({
  adAttributionRepository: {
    ghlAccounts: vi.fn(),
    practiceOptions: vi.fn(),
    adAccounts: vi.fn(),
    leadsInWindow: vi.fn(),
    acceptedForMatching: vi.fn(),
    adSpend: vi.fn(),
    leadCountsByPipeline: vi.fn(),
    setAdAccountPractice: vi.fn(),
    emergentBusinesses: vi.fn(),
  },
}));
vi.mock('../src/repositories/ad-channel-pipeline.repository.js', () => ({
  adChannelPipelineRepository: {
    channelMap: vi.fn(),
    setChannel: vi.fn(),
  },
}));

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

  it('treats a zero ACCUMULATED spend total as unknown, not a fabricated £0', () => {
    // ad_metrics.spend_pence is BIGINT NOT NULL DEFAULT 0, so a synced day with
    // genuinely no spend stores a real 0 row. That must read as "Not
    // reporting", the same as no rows at all — never as "these leads were free".
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
    ];
    const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 0, metric_date: '2026-07-02' }];
    const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });
    const g = out.channels.find((c) => c.channel === 'google_ads');
    expect(g.spendPence).toBeNull();
    expect(g.costPerLeadPence).toBeNull();
    expect(g.costPerAcquisitionPence).toBeNull();
    const row = out.byPractice.find((p) => p.practiceId === 'p1');
    const pg = row.channels.find((c) => c.channel === 'google_ads');
    expect(pg.spendPence).toBeNull();
    // The totals block must follow the same zero-means-unknown rule as the
    // per-channel rows above it — this is the assertion the original round
    // never added.
    expect(out.totals.spendPence).toBeNull();
  });

  it('rounds costPerLeadPence and costPerAcquisitionPence to whole pence', () => {
    const leads = [
      { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
      { id: 'l2', contact_id: 'c2', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
      { id: 'l3', contact_id: 'c3', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
    ];
    const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 100000, metric_date: '2026-07-02' }];
    const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });
    const g = out.channels.find((c) => c.channel === 'google_ads');
    // 100000 / 3 = 33333.33...; the unrounded float would fail this exact check.
    expect(g.costPerLeadPence).toBe(33333);
    expect(Number.isInteger(g.costPerLeadPence)).toBe(true);
  });

  describe('totals (deduped per person across all channels)', () => {
    it('dedupes a person seen in one mapped and one unassigned pipeline', () => {
      // This is the exact case that let the group/channel rows inflate a
      // summed total: per-channel counting is correct, but a naive consumer
      // summing google_ads + meta_ads + unassigned would double the person.
      const leads = [
        { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
        { id: 'l2', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'other', created_at: '2026-07-03', contacts: {} },
      ];
      const out = computePerformance({ leads, accepted: [], spend: [], channelMap, accountPractice });
      // Per-channel counting is unchanged: one lead each.
      expect(out.channels.find((c) => c.channel === 'google_ads').leads).toBe(1);
      expect(out.channels.find((c) => c.channel === 'unassigned').leads).toBe(1);
      // But the deduped total is the one person, not two.
      expect(out.totals.leads).toBe(1);
    });

    it('dedupes a person tagged under both google_ads and meta_ads pipelines', () => {
      const leads = [
        { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
        { id: 'l2', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'f', created_at: '2026-07-03', contacts: {} },
      ];
      const out = computePerformance({ leads, accepted: [], spend: [], channelMap, accountPractice });
      expect(out.channels.find((c) => c.channel === 'google_ads').leads).toBe(1);
      expect(out.channels.find((c) => c.channel === 'meta_ads').leads).toBe(1);
      expect(out.totals.leads).toBe(1);
    });

    it('derives totals.costPerLeadPence/costPerAcquisitionPence from the deduped figures via finalise()', () => {
      const leads = [
        { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: { phone: '07700900123' } },
        { id: 'l2', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'f', created_at: '2026-07-02', contacts: { phone: '07700900123' } },
      ];
      const accepted = [
        { phone: '07700900123', value_pence: 400000, patient_name: 'Jo Bloggs', practice_id: 'p1' },
      ];
      const spend = [
        { provider: 'google_ads', practice_id: 'p1', spend_pence: 60000, metric_date: '2026-07-02' },
        { provider: 'meta_ads', practice_id: 'p1', spend_pence: 40000, metric_date: '2026-07-02' },
      ];
      const out = computePerformance({ leads, accepted, spend, channelMap, accountPractice });
      expect(out.totals.leads).toBe(1);
      expect(out.totals.conversions).toBe(1);
      expect(out.totals.acceptedValuePence).toBe(400000);
      // Sum of google_ads + meta_ads spend; unassigned contributes none.
      expect(out.totals.spendPence).toBe(100000);
      expect(out.totals.costPerLeadPence).toBe(100000);
      expect(out.totals.costPerAcquisitionPence).toBe(100000);
    });

    it('adds a deduped total to each byPractice row, scoped to that practice', () => {
      const leads = [
        { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
        { id: 'l2', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'f', created_at: '2026-07-03', contacts: {} },
      ];
      const out = computePerformance({ leads, accepted: [], spend: [], channelMap, accountPractice });
      const row = out.byPractice.find((p) => p.practiceId === 'p1');
      expect(row.total.leads).toBe(1);
    });

    it('CRITICAL: divides totals cost metrics by PAID leads, not by every deduped lead including unassigned', () => {
      // 100 people through a mapped google_ads pipeline with £1,000 spend,
      // plus 100 people seen only in an untagged (unassigned) pipeline. The
      // untagged pipelines are the ordinary state, not an edge case — most of
      // this org's 113 pipelines are untagged today.
      //
      // Hand-worked expectation: spend is 100000p, paid leads are the 100
      // google_ads people (unassigned people cost nothing and must not be in
      // the denominator). costPerLeadPence = 100000 / 100 = 1000p (£10.00) —
      // matching the per-channel google_ads cost per lead exactly.
      //
      // Against the pre-fix implementation this divided by totals.leads (200,
      // ALL deduped people including unassigned), giving 100000 / 200 = 500p
      // (£5.00) — half the true paid cost per lead. This test fails against
      // that implementation and passes against the fix.
      const paidLeads = Array.from({ length: 100 }, (_, i) => ({
        id: `paid-${i}`, contact_id: `paid-${i}`, integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {},
      }));
      const untaggedLeads = Array.from({ length: 100 }, (_, i) => ({
        id: `untagged-${i}`, contact_id: `untagged-${i}`, integration_account_id: 'acc1', ghl_pipeline_id: 'other', created_at: '2026-07-02', contacts: {},
      }));
      const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 100000, metric_date: '2026-07-02' }];
      const out = computePerformance({
        leads: [...paidLeads, ...untaggedLeads], accepted: [], spend, channelMap, accountPractice,
      });

      // totals.leads counts EVERYONE — that is the honest funnel total and
      // the reason the totals block exists.
      expect(out.totals.leads).toBe(200);
      // paidLeads counts only the google_ads/meta_ads people.
      expect(out.totals.paidLeads).toBe(100);
      expect(out.totals.spendPence).toBe(100000);
      // The defect: this must be spend / paidLeads (1000), never spend /
      // totals.leads (500).
      expect(out.totals.costPerLeadPence).toBe(1000);
      expect(out.totals.costPerLeadPence).not.toBe(500);
    });

    it('nulls totals cost metrics when one paid channel has leads but its spend feed is not reporting', () => {
      // google_ads spend IS known (£1,000); meta_ads has a lead but no spend
      // row at all for the window, so its accumulated spend stays the
      // emptyStats() 0 — "not reporting", same as no rows. Charging the
      // known google spend against BOTH channels' leads (as a naive
      // spend/paidLeads division would) understates meta's true cost by
      // pretending it was free, the same class of error as the Critical
      // defect. costPerLeadPence and costPerAcquisitionPence must both be
      // null; spendPence must still show the known £1,000.
      //
      // Against an implementation with the paidLeads fix but WITHOUT this
      // guard, costPerLeadPence would come out as 100000 / 2 = 50000 — a
      // real, present-looking number silently built on an absent meta spend
      // feed. This test fails against that half-fixed implementation.
      const leads = [
        { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
        { id: 'l2', contact_id: 'c2', integration_account_id: 'acc1', ghl_pipeline_id: 'f', created_at: '2026-07-02', contacts: {} },
      ];
      const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 100000, metric_date: '2026-07-02' }];
      const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });

      expect(out.totals.paidLeads).toBe(2);
      expect(out.totals.spendPence).toBe(100000);
      expect(out.totals.costPerLeadPence).toBeNull();
      expect(out.totals.costPerAcquisitionPence).toBeNull();
    });

    it('applies the same paid-leads denominator to a byPractice total', () => {
      // Same shape as the CRITICAL test above, but scoped through
      // byPractice[].total rather than the group-level totals block — the
      // ruling applies "as well" to the per-practice total, and that path is
      // a separate call site in computePerformance, not automatically
      // covered by testing the group level alone.
      const paidLeads = Array.from({ length: 10 }, (_, i) => ({
        id: `paid-${i}`, contact_id: `paid-${i}`, integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {},
      }));
      const untaggedLeads = Array.from({ length: 10 }, (_, i) => ({
        id: `untagged-${i}`, contact_id: `untagged-${i}`, integration_account_id: 'acc1', ghl_pipeline_id: 'other', created_at: '2026-07-02', contacts: {},
      }));
      const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 10000, metric_date: '2026-07-02' }];
      const out = computePerformance({
        leads: [...paidLeads, ...untaggedLeads], accepted: [], spend, channelMap, accountPractice,
      });
      const row = out.byPractice.find((p) => p.practiceId === 'p1');

      // 20 people through this practice in total, only 10 of them paid.
      expect(row.total.leads).toBe(20);
      expect(row.total.paidLeads).toBe(10);
      // 10000p / 10 paid leads = 1000p, NOT 10000p / 20 = 500p.
      expect(row.total.costPerLeadPence).toBe(1000);
      expect(row.total.costPerLeadPence).not.toBe(500);
    });
  });

  describe('computePerformance trend', () => {
    const accountPractice = new Map([['acc1', 'p1']]);
    const channelMap = new Map([['acc1|g', 'google_ads']]);

    it('buckets leads and spend by month and dedupes per person within a month', () => {
      const leads = [
        { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-06-10T09:00:00Z', contacts: {} },
        { id: 'l2', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-06-20T09:00:00Z', contacts: {} },
        { id: 'l3', contact_id: 'c2', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-05T09:00:00Z', contacts: {} },
      ];
      const spend = [
        { provider: 'google_ads', practice_id: 'p1', spend_pence: 60000, metric_date: '2026-06-15' },
        { provider: 'google_ads', practice_id: 'p1', spend_pence: 20000, metric_date: '2026-07-02' },
      ];
      const out = computePerformance({
        leads, accepted: [], spend, channelMap, accountPractice,
      });
      expect(out.trend.map((t) => t.month)).toEqual(['2026-06', '2026-07']);
      const june = out.trend[0].channels.find((c) => c.channel === 'google_ads');
      // c1 appears twice in June — one person, one lead.
      expect(june.leads).toBe(1);
      expect(june.costPerLeadPence).toBe(60000);
    });

    it('reports a month with spend but no leads as an unknown cost per lead', () => {
      const spend = [{ provider: 'google_ads', practice_id: 'p1', spend_pence: 50000, metric_date: '2026-06-15' }];
      const out = computePerformance({
        leads: [], accepted: [], spend, channelMap, accountPractice,
      });
      const june = out.trend[0].channels.find((c) => c.channel === 'google_ads');
      expect(june.leads).toBe(0);
      // Spending with nothing to show for it must not render as a £0 cost per lead.
      expect(june.costPerLeadPence).toBeNull();
    });

    it('counts the SAME person in TWO different months once per month (archive-pipeline repeat enquirer)', () => {
      // Against the pre-fix implementation, the trend blocks sat after the
      // `if (!isNewToGroup && !isNewToPractice) continue;` guard, which is
      // keyed on `person` alone (± practiceId) — NOT on month. So the second
      // (July) lead from the same person, same channel, same practice was
      // already "seen" by that guard from the June visit and got skipped
      // before the trend code ever ran. July would show leads: 0, and with
      // known spend that renders as a null cost-per-lead gap on the chart
      // despite real spend and a real repeat enquiry — exactly the dominant
      // multi-year archive-pipeline case on the live data.
      const leads = [
        { id: 'l1', contact_id: 'repeat', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-06-10T09:00:00Z', contacts: {} },
        { id: 'l2', contact_id: 'repeat', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-10T09:00:00Z', contacts: {} },
      ];
      const spend = [
        { provider: 'google_ads', practice_id: 'p1', spend_pence: 50000, metric_date: '2026-06-15' },
        { provider: 'google_ads', practice_id: 'p1', spend_pence: 70000, metric_date: '2026-07-15' },
      ];
      const out = computePerformance({
        leads, accepted: [], spend, channelMap, accountPractice,
      });

      expect(out.trend.map((t) => t.month)).toEqual(['2026-06', '2026-07']);
      const june = out.trend.find((t) => t.month === '2026-06').channels.find((c) => c.channel === 'google_ads');
      const july = out.trend.find((t) => t.month === '2026-07').channels.find((c) => c.channel === 'google_ads');
      expect(june.leads).toBe(1);
      expect(july.leads).toBe(1);

      const row = out.byPractice.find((p) => p.practiceId === 'p1');
      const juneP = row.trend.find((t) => t.month === '2026-06').channels.find((c) => c.channel === 'google_ads');
      const julyP = row.trend.find((t) => t.month === '2026-07').channels.find((c) => c.channel === 'google_ads');
      expect(juneP.leads).toBe(1);
      expect(julyP.leads).toBe(1);

      // Meanwhile the scorecard (group-level, month-agnostic) still counts
      // this repeat enquirer once — the trend is deliberately not additive
      // to the scorecard.
      expect(out.channels.find((c) => c.channel === 'google_ads').leads).toBe(1);
    });

    it('skips a lead with no created_at from the trend rather than rendering an Invalid Date point', () => {
      const leads = [
        { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: null, contacts: {} },
        { id: 'l2', contact_id: 'c2', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-05T09:00:00Z', contacts: {} },
      ];
      const out = computePerformance({
        leads, accepted: [], spend: [], channelMap, accountPractice,
      });
      expect(out.trend.map((t) => t.month)).toEqual(['2026-07']);
      expect(out.trend.some((t) => t.month === '')).toBe(false);
    });

    it('skips a spend row with no metric_date from the trend rather than rendering an Invalid Date point', () => {
      const spend = [
        { provider: 'google_ads', practice_id: 'p1', spend_pence: 10000, metric_date: null },
        { provider: 'google_ads', practice_id: 'p1', spend_pence: 20000, metric_date: '2026-07-15' },
      ];
      const out = computePerformance({
        leads: [], accepted: [], spend, channelMap, accountPractice,
      });
      expect(out.trend.map((t) => t.month)).toEqual(['2026-07']);
      expect(out.trend.some((t) => t.month === '')).toBe(false);
    });

    describe('per-practice trend (obeys the practice selector)', () => {
      it('dedupes a person seen at two practices in the same month: once per practice, once for the group', () => {
        // Against the pre-fix implementation there is no `trend` on a
        // byPractice row at all, so `row.trend` is undefined and this
        // fails immediately. Even patched naively (e.g. reusing the group
        // trend for every practice), p1 and p3 would each show 1 lead from
        // this fixture but ALSO get credit for leads that never touched
        // that practice — the group-trend-shared-everywhere bug this test
        // guards against.
        const cp = new Map([['acc1', 'p1'], ['acc3', 'p3']]);
        const cm = new Map([['acc1|g', 'google_ads'], ['acc3|g', 'google_ads']]);
        const leads = [
          { id: 'l1', contact_id: 'shared', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
          { id: 'l2', contact_id: 'shared', integration_account_id: 'acc3', ghl_pipeline_id: 'g', created_at: '2026-07-10', contacts: {} },
        ];
        const out = computePerformance({ leads, accepted: [], spend: [], channelMap: cm, accountPractice: cp });

        const groupJuly = out.trend.find((t) => t.month === '2026-07').channels.find((c) => c.channel === 'google_ads');
        expect(groupJuly.leads).toBe(1);

        const p1 = out.byPractice.find((p) => p.practiceId === 'p1');
        const p3 = out.byPractice.find((p) => p.practiceId === 'p3');
        const p1July = p1.trend.find((t) => t.month === '2026-07').channels.find((c) => c.channel === 'google_ads');
        const p3July = p3.trend.find((t) => t.month === '2026-07').channels.find((c) => c.channel === 'google_ads');
        expect(p1July.leads).toBe(1);
        expect(p3July.leads).toBe(1);
      });

      it('reports null spend and null cost per lead for a practice with leads but no mapped ad account spend', () => {
        // This is the exact case the whole fix is for: a practice whose
        // scorecard correctly shows "Not reporting" must not have a
        // priced trend line built from group-wide spend divided by
        // group-wide leads. Against the pre-fix implementation `row.trend`
        // is undefined (there is no per-practice trend at all), so this
        // fails immediately; against a naive fix that just copies the
        // group trend onto every practice, this would show the group's
        // £1,000 spend / real cost-per-lead instead of null.
        const leads = [
          { id: 'l1', contact_id: 'c1', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
        ];
        // Spend exists at group level but carries no practice_id, so p1
        // cannot claim it — mirrors the existing group-vs-practice spend
        // fixture above.
        const spend = [{ provider: 'google_ads', practice_id: null, spend_pence: 100000, metric_date: '2026-07-02' }];
        const out = computePerformance({ leads, accepted: [], spend, channelMap, accountPractice });

        const row = out.byPractice.find((p) => p.practiceId === 'p1');
        const july = row.trend.find((t) => t.month === '2026-07').channels.find((c) => c.channel === 'google_ads');
        expect(july.leads).toBe(1);
        expect(july.spendPence).toBeNull();
        expect(july.costPerLeadPence).toBeNull();

        // The group trend still sees the (unattributed) spend.
        const groupJuly = out.trend.find((t) => t.month === '2026-07').channels.find((c) => c.channel === 'google_ads');
        expect(groupJuly.spendPence).toBe(100000);
      });
    });
  });

  describe('group-vs-practice dedupe asymmetry', () => {
    it('counts a person once at the group level AND once at each of two different practices', () => {
      // This is the subtlest line in the file: isNewToPractice must be
      // evaluated against a set keyed on THIS practice, not against the
      // group-wide seen set. Conflating the two guards would leave every
      // existing fixture green while silently zeroing the second practice's
      // lead count for anyone already seen elsewhere in the group.
      const cp = new Map([['acc1', 'p1'], ['acc3', 'p3']]);
      const cm = new Map([['acc1|g', 'google_ads'], ['acc3|g', 'google_ads']]);
      const leads = [
        { id: 'l1', contact_id: 'shared', integration_account_id: 'acc1', ghl_pipeline_id: 'g', created_at: '2026-07-02', contacts: {} },
        { id: 'l2', contact_id: 'shared', integration_account_id: 'acc3', ghl_pipeline_id: 'g', created_at: '2026-07-03', contacts: {} },
      ];
      const out = computePerformance({ leads, accepted: [], spend: [], channelMap: cm, accountPractice: cp });
      // Group dedupes across practices too — same person, counted once.
      expect(out.channels.find((c) => c.channel === 'google_ads').leads).toBe(1);
      // But EACH practice sees them as a lead of its own — the practice-level
      // guard must not be gated on group-level novelty.
      const p1 = out.byPractice.find((p) => p.practiceId === 'p1').channels.find((c) => c.channel === 'google_ads');
      const p3 = out.byPractice.find((p) => p.practiceId === 'p3').channels.find((c) => c.channel === 'google_ads');
      expect(p1.leads).toBe(1);
      expect(p3.leads).toBe(1);
    });
  });
});

describe('adAttributionService.getPerformance — unmappedPipelineCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adAttributionRepository.leadsInWindow.mockResolvedValue([]);
    adAttributionRepository.acceptedForMatching.mockResolvedValue([]);
    adAttributionRepository.adSpend.mockResolvedValue([]);
    adAttributionRepository.practiceOptions.mockResolvedValue([]);
  });

  it('excludes pipelines on a subaccount with no practice mapping (the academy/accounting Location)', async () => {
    // The client's own agency/academy Location carries ~67 pipelines that are
    // business leads, not patient leads, and is deliberately excluded from
    // this whole feature. Counting its pipelines as "unmapped" means the
    // footer note never clears and the "mapped but quiet" nudge can never
    // fire — against the pre-fix implementation this test fails because it
    // sums ALL accounts' pipelines regardless of practice_id.
    adAttributionRepository.ghlAccounts.mockResolvedValue([
      { id: 'acc-practice', label: 'Practice A', practice_id: 'p1', pipelines: [{ id: 'g', name: 'Google' }, { id: 'f', name: 'Facebook' }] },
      { id: 'acc-academy', label: 'Academy', practice_id: null, pipelines: Array.from({ length: 67 }, (_, i) => ({ id: `a${i}`, name: `Pipeline ${i}` })) },
    ]);
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map([['acc-practice|g', 'google_ads']]));

    const out = await adAttributionService.getPerformance('org1', { since: '2026-01-01', until: '2026-08-01', practiceId: null });
    // Only acc-practice's unmapped pipeline ('f') should count — none of the
    // academy Location's 67 pipelines, which can never legitimately be mapped.
    expect(out.unmappedPipelineCount).toBe(1);
  });

  it('is zero once every pipeline on a practice-mapped subaccount is set (mapped-but-quiet stays reachable)', async () => {
    adAttributionRepository.ghlAccounts.mockResolvedValue([
      { id: 'acc-practice', label: 'Practice A', practice_id: 'p1', pipelines: [{ id: 'g', name: 'Google' }] },
      { id: 'acc-academy', label: 'Academy', practice_id: null, pipelines: [{ id: 'a1', name: 'Business pipeline' }] },
    ]);
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map([['acc-practice|g', 'google_ads']]));

    const out = await adAttributionService.getPerformance('org1', { since: '2026-01-01', until: '2026-08-01', practiceId: null });
    expect(out.unmappedPipelineCount).toBe(0);
  });
});

describe('adAttributionService.setPipelineChannel — unknown subaccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws an AppError with statusCode 404, not a bare 500-mapped Error', async () => {
    // A stale accountId (after a disconnect) or a cross-org probe is ordinary
    // client input, not a server fault. errorHandler maps a non-AppError to
    // 500 + logs a stack + reports to Sentry — this must not happen for
    // input this routine. Against the pre-fix implementation (`throw new
    // Error(...)`), `err instanceof AppError` is false and this fails.
    adAttributionRepository.ghlAccounts.mockResolvedValue([
      { id: 'acc-real', label: 'Real', practice_id: 'p1', pipelines: [{ id: 'g', name: 'Google' }] },
    ]);

    await expect(
      adAttributionService.setPipelineChannel('org1', 'acc-does-not-exist', 'g', 'google_ads'),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Unknown subaccount' });
  });
});

describe('accountPracticeByCustomerId', () => {
  it('keys on provider AND customer id so two providers cannot collide', () => {
    const map = accountPracticeByCustomerId([
      { provider: 'google_ads', customer_id: '123', practice_id: 'p-google' },
      { provider: 'meta_ads', customer_id: '123', practice_id: 'p-meta' },
    ]);
    expect(map.get('google_ads|123')).toBe('p-google');
    expect(map.get('meta_ads|123')).toBe('p-meta');
  });

  it('keeps an unmapped account as null rather than dropping it', () => {
    const map = accountPracticeByCustomerId([
      { provider: 'google_ads', customer_id: '123', practice_id: null },
    ]);
    expect(map.has('google_ads|123')).toBe(true);
    expect(map.get('google_ads|123')).toBeNull();
  });

  it('returns an empty map for no accounts', () => {
    expect(accountPracticeByCustomerId([]).size).toBe(0);
  });

  it('tolerates a null or undefined account list', () => {
    expect(accountPracticeByCustomerId(null).size).toBe(0);
    expect(accountPracticeByCustomerId(undefined).size).toBe(0);
  });
});

describe('getMappingHealth', () => {
  beforeEach(() => {
    adAttributionRepository.practiceOptions.mockResolvedValue([
      { id: 'p1', name: 'Ashford' },
    ]);
    adAttributionRepository.adAccounts.mockResolvedValue([]);
    adAttributionRepository.ghlAccounts.mockResolvedValue([]);
    adAttributionRepository.emergentBusinesses.mockResolvedValue([]);
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map());
  });

  it('resolves a mapped ad account to its practice name and marks it mapped', async () => {
    adAttributionRepository.adAccounts.mockResolvedValue([
      { id: 'a1', provider: 'google_ads', customer_id: '123', name: 'Main', practice_id: 'p1' },
    ]);
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.adAccounts[0]).toEqual({
      id: 'a1', provider: 'google_ads', customerId: '123', name: 'Main',
      practiceId: 'p1', practiceName: 'Ashford', mapped: true,
    });
    expect(out.summary.adAccountsUnmapped).toBe(0);
  });

  it('marks an unmapped ad account and counts it, with a null practice name', async () => {
    adAttributionRepository.adAccounts.mockResolvedValue([
      { id: 'a1', provider: 'meta_ads', customer_id: '999', name: null, practice_id: null },
    ]);
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.adAccounts[0].mapped).toBe(false);
    expect(out.adAccounts[0].practiceName).toBeNull();
    expect(out.summary.adAccountsUnmapped).toBe(1);
  });

  it('counts a GHL subaccount pipeline with no channel as unmapped', async () => {
    adAttributionRepository.ghlAccounts.mockResolvedValue([
      {
        id: 'g1', label: 'Ashford', external_account_id: 'LOC1', practice_id: 'p1',
        status: 'active', pipelines: [{ id: 'pl1', name: 'A' }, { id: 'pl2', name: 'B' }],
      },
    ]);
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map([['g1|pl1', 'google_ads']]));
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.ghlAccounts[0].pipelineCount).toBe(2);
    expect(out.ghlAccounts[0].unmappedPipelineCount).toBe(1);
    expect(out.summary.pipelinesUnmapped).toBe(1);
  });

  it('excludes a practice-less GHL subaccount from pipelinesUnmapped', async () => {
    // The academy and accounting Locations live in integration_accounts too.
    // Their pipelines must never inflate the count — same rule getPerformance
    // already applies.
    adAttributionRepository.ghlAccounts.mockResolvedValue([
      {
        id: 'g2', label: 'Academy', external_account_id: 'LOC2', practice_id: null,
        status: 'active', pipelines: [{ id: 'plx', name: 'X' }],
      },
    ]);
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map());
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.summary.pipelinesUnmapped).toBe(0);
    expect(out.ghlAccounts[0].mapped).toBe(false);
    expect(out.summary.ghlAccountsUnmapped).toBe(1);
  });

  it('reports an intentionally unmapped Emergent business', async () => {
    adAttributionRepository.emergentBusinesses.mockResolvedValue([
      { businessId: 'BIZ1', businessName: 'Ashford', practiceId: 'p1' },
      { businessId: 'BIZ2', businessName: 'Unknown', practiceId: null },
    ]);
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.emergentBusinesses[0]).toEqual({
      businessId: 'BIZ1', businessName: 'Ashford',
      practiceId: 'p1', practiceName: 'Ashford', mapped: true,
    });
    expect(out.emergentBusinesses[1].mapped).toBe(false);
    expect(out.summary.emergentUnmapped).toBe(1);
  });

  it('returns empty surfaces rather than throwing when nothing is configured', async () => {
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.adAccounts).toEqual([]);
    expect(out.ghlAccounts).toEqual([]);
    expect(out.emergentBusinesses).toEqual([]);
    expect(out.summary).toEqual({
      adAccountsUnmapped: 0, ghlAccountsUnmapped: 0, emergentUnmapped: 0, pipelinesUnmapped: 0,
    });
  });
});
