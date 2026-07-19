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
      build: vi.fn().mockResolvedValue({ revenue: { month: { todayPence: 624000 } } }),
    },
    analytics: {
      businessHub: vi.fn().mockResolvedValue({
        group: { appointments: 118, noShows: 7, noShowRate: 0.059, newPatients: 12, marginPct: 18.4, revenuePence: 14200000 },
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

    expect(d.adAttribution.getPerformance).toHaveBeenCalledWith(ORG, { since: '2026-07-20', until: '2026-07-20' });
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
});

describe('buildPayload', () => {
  it('includes the rendered line and flat display fields', async () => {
    const { payload } = await dailyReportService.buildPayload(ORG, { now: NOW, deps: deps() });

    expect(payload.report_date).toBe('2026-07-20');
    expect(payload.report_line).toContain('Daily 20 Jul');
    expect(payload.leads_total).toBe(24);
    expect(payload.spend_meta).toBe('not reporting');
    expect(payload.cash_in).toBe('£6,240');
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

  it('blocks a second automatic send on the same day', async () => {
    const d = deps();
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: '2026-07-21T17:00:00.000Z' };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'cron', deps: d, settings });

    expect(res.status).toBe('skipped');
    expect(d.postWebhook).not.toHaveBeenCalled();
  });

  it('allows a manual send to bypass the same-day block', async () => {
    const d = deps();
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: '2026-07-21T17:00:00.000Z' };

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
});
