import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { dailyReportService } from '../src/services/daily-report.service.js';

const ORG = 'org-aaaa';
const NOW = new Date('2026-07-21T17:00:00.000Z'); // 18:00 London

function deps(overrides = {}) {
  return {
    adAttribution: {
      getPerformance: vi.fn().mockResolvedValue({
        channels: [
          { channel: 'google_ads', leads: 14, conversions: 4, spendPence: 41200, costPerLeadPence: 2943, costPerAcquisitionPence: 10300, conversionRate: 0.2857 },
          { channel: 'meta_ads', leads: 10, conversions: 2, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: 0.2 },
          { channel: 'unassigned', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null },
        ],
        totals: { channel: 'total', leads: 24, conversions: 6, spendPence: 41200, costPerLeadPence: 1717, costPerAcquisitionPence: 6867, conversionRate: 0.25, paidLeads: 24, paidConversions: 6 },
      }),
    },
    cockpit: {
      // todayDate must match the reported day (2026-07-20) or the cash figure
      // is deliberately suppressed — see buildMetrics.
      build: vi.fn().mockResolvedValue({ revenue: { month: { todayPence: 624000, todayDate: '2026-07-20' } } }),
    },
    auth: { organisationName: vi.fn().mockResolvedValue('Plan4growth') },
    analytics: {
      // NB: noShowRate is a 0..100 PERCENTAGE (e.g. 5.9 means 5.9%), same as
      // marginPct — this is the REAL shape analyticsService.businessHub
      // emits (backend/src/services/analytics.service.js: `rate()` returns
      // Math.round((n / d) * 1000) / 10). Do NOT "correct" this back to
      // 0.059 — that shape doesn't exist in production and previously hid a
      // units bug that would have rendered "590% DNA" to the practice owner.
      businessHub: vi.fn().mockResolvedValue({
        group: { appointments: 118, noShows: 7, noShowRate: 5.9, newPatients: 12, marginPct: 18.4, revenuePence: 14200000 },
      }),
    },
    postWebhook: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    ...overrides,
  };
}

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('buildMetrics', () => {
  it('queries the previous London day and splits channels', async () => {
    const d = deps();
    const m = await dailyReportService.buildMetrics(ORG, { now: NOW, deps: d });

    // `until` is EXCLUSIVE across every repository, so the one-day window for
    // 2026-07-20 is [2026-07-20, 2026-07-21). The previous assertion expected
    // until === since, which matches no rows at all and made the whole report
    // come back zeroes.
    expect(d.adAttribution.getPerformance).toHaveBeenCalledWith(ORG, { since: '2026-07-20', until: '2026-07-21' });
    expect(m.reportDateLabel).toBe('20 Jul');
    expect(m.leads).toEqual({ total: 24, google: 14, meta: 10 });
    expect(m.spendPence.google).toBe(41200);
    expect(m.spendPence.meta).toBeNull();
    expect(m.cashInPence).toBe(624000);
    expect(m.dentally.appointments).toBe(118);
  });

  it('tolerates a failing optional source rather than losing the report', async () => {
    const d = deps({ analytics: { businessHub: vi.fn().mockRejectedValue(new Error('rpc timeout')) } });

    const m = await dailyReportService.buildMetrics(ORG, { now: NOW, deps: d });

    expect(m.dentally).toBeNull();
    expect(m.qbo).toBeNull();
    expect(m.leads.total).toBe(24); // ad metrics survived
  });

  // cockpit.revenue.month.todayPence is the cash-up total for MAX(cashup_date)
  // across the whole month, which can lag the reported day when a practice
  // misses a cash-up or the overnight sync fails. Reporting the 18th's cash
  // under a "Daily 20 Jul" heading would be silently wrong.
  it('reports cash in when the cash-up date matches the reported day', async () => {
    const d = deps({
      cockpit: { build: vi.fn().mockResolvedValue({ revenue: { month: { todayPence: 624000, todayDate: '2026-07-20' } } }) },
    });

    const m = await dailyReportService.buildMetrics(ORG, { now: NOW, deps: d });

    expect(m.reportDate).toBe('2026-07-20');
    expect(m.cashInPence).toBe(624000);
  });

  it('suppresses cash in when the cash-up date is stale, rather than asserting another day\'s figure', async () => {
    const d = deps({
      cockpit: { build: vi.fn().mockResolvedValue({ revenue: { month: { todayPence: 624000, todayDate: '2026-07-18' } } }) },
    });

    const m = await dailyReportService.buildMetrics(ORG, { now: NOW, deps: d });

    expect(m.cashInPence).toBeNull();
  });

  it('suppresses cash in when the cockpit reports no cash-up date at all', async () => {
    const d = deps({
      cockpit: { build: vi.fn().mockResolvedValue({ revenue: { month: { todayPence: 624000, todayDate: null } } }) },
    });

    const m = await dailyReportService.buildMetrics(ORG, { now: NOW, deps: d });

    expect(m.cashInPence).toBeNull();
  });
});

describe('buildPayload', () => {
  it('includes the rendered line and flat display fields', async () => {
    const { payload } = await dailyReportService.buildPayload(ORG, { now: NOW, deps: deps() });

    expect(payload.report_date).toBe('2026-07-20');
    expect(payload.report_line).toContain('Daily 20 Jul');
    expect(payload.leads_total).toBe(24);
    expect(payload.spend_meta).toBe('not reporting');
    expect(payload.cash_in).toBe('£6,240');
    // noShowRate (5.9, a 0..100 percentage) must be scaled to a 0..1 ratio
    // before formatPercent, and marginPct (18.4, already 0..100) must pass
    // through unscaled. Getting either wrong renders a wildly wrong figure
    // in a message to the business owner (e.g. "590% DNA").
    expect(payload.dna_rate).toBe('5.9%');
    expect(payload.qbo_margin).toBe('18.4%');
  });

  it('resolves the organisation name so payload.organisation is never a permanent null', async () => {
    const d = deps();
    const { payload } = await dailyReportService.buildPayload(ORG, { now: NOW, deps: d });

    expect(d.auth.organisationName).toHaveBeenCalledWith(ORG);
    expect(payload.organisation).toBe('Plan4growth');
  });

  it('still builds the report when the organisation name cannot be resolved', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ auth: { organisationName: vi.fn().mockRejectedValue(new Error('db down')) } });

    const { payload } = await dailyReportService.buildPayload(ORG, { now: NOW, deps: d });

    expect(payload.organisation).toBeNull();
    expect(payload.report_line).toContain('Daily 20 Jul');
    errSpy.mockRestore();
  });

  it('exposes no raw pence integers, which must never reach a message', async () => {
    const { payload } = await dailyReportService.buildPayload(ORG, { now: NOW, deps: deps() });

    for (const [key, value] of Object.entries(payload)) {
      if (key.startsWith('leads_') || key === 'conversions' || key.startsWith('appointments') || key === 'dna' || key === 'new_patients') continue;
      expect(typeof value === 'number' && value > 10000).toBe(false);
    }
  });
});

describe('send', () => {
  it('skips when the organisation has no settings row', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });

    const res = await dailyReportService.send(ORG, { now: NOW, deps: deps() });

    expect(res.status).toBe('skipped');
    expect(res.sent).toBe(false);
  });

  it('skips when there is no data at all rather than sending zeroes', async () => {
    const d = deps({
      adAttribution: {
        getPerformance: vi.fn().mockResolvedValue({
          channels: [
            { channel: 'google_ads', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null },
            { channel: 'meta_ads', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null },
            { channel: 'unassigned', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null },
          ],
          totals: { channel: 'total', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null, paidLeads: 0, paidConversions: 0 },
        }),
      },
      cockpit: { build: vi.fn().mockResolvedValue({ revenue: { month: { todayPence: null } } }) },
      analytics: { businessHub: vi.fn().mockResolvedValue({ group: {} }) },
    });
    supaRec.resultProvider = () => ({
      data: { organisation_id: ORG, webhook_url: null, enabled: true, last_sent_at: null },
      error: null,
    });

    const res = await dailyReportService.send(ORG, { now: NOW, deps: d, settings: { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null } });

    expect(res.status).toBe('skipped');
    expect(d.postWebhook).not.toHaveBeenCalled();
  });

  it('blocks a second automatic send on the same day after a SUCCESSFUL send', async () => {
    const d = deps();
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: '2026-07-21T17:00:00.000Z', lastStatus: 'ok' };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'cron', deps: d, settings });

    expect(res.status).toBe('skipped');
    expect(d.postWebhook).not.toHaveBeenCalled();
  });

  it('does NOT block a same-day retry after an earlier FAILED send', async () => {
    const d = deps();
    // Same London day as NOW, but the earlier attempt failed — a worker
    // restart later that day must be able to retry, not be told "already
    // sent today" when nothing was ever delivered.
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: '2026-07-21T15:00:00.000Z', lastStatus: 'failed' };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'cron', deps: d, settings });

    expect(res.sent).toBe(true);
    expect(res.status).toBe('ok');
    expect(d.postWebhook).toHaveBeenCalledTimes(1);
  });

  it('allows a manual send to bypass the same-day block', async () => {
    const d = deps();
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: '2026-07-21T17:00:00.000Z', lastStatus: 'ok' };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'manual', deps: d, settings });

    expect(res.sent).toBe(true);
    expect(d.postWebhook).toHaveBeenCalledTimes(1);
  });

  it('records a failure without throwing', async () => {
    const d = deps({ postWebhook: vi.fn().mockResolvedValue({ ok: false, status: 500, error: 'boom' }) });
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'cron', deps: d, settings });

    expect(res.sent).toBe(false);
    expect(res.status).toBe('failed');
  });

  it('contains a mandatory-source failure instead of throwing out of send()', async () => {
    const d = deps({
      adAttribution: { getPerformance: vi.fn().mockRejectedValue(new Error('ad attribution unreachable')) },
    });
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'cron', deps: d, settings });

    expect(res.sent).toBe(false);
    expect(res.status).toBe('failed');
    expect(res.reason).toContain('ad attribution unreachable');
    expect(d.postWebhook).not.toHaveBeenCalled();
  });
});
