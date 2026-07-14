import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/services/lead-attribution.service.js', () => ({
  leadAttributionService: { channelBreakdown: vi.fn(async () => ({ channels: [], spendByChannel: { google: 0, facebook: 0 }, group: {} })) },
  classifyChannel: () => null,
}));
vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    cashupRollup: vi.fn(async () => [{ practice_id: 'P1', business_name: 'Ashford', cash_up_money_taken_pence: 185000, treatments_accepted: 2, tx_plans_given: 3, tx_plan_given_value_pence: 1200000, num_new_leads: 9, num_attended: 8, detail_patient_money_total_pence: 450000 }]),
    monthlyPl: vi.fn(async () => [{ business_name: 'Ashford', revenue_pence: 9500000, net_profit_pence: 2122000 }]),
    latestMonthlyPl: vi.fn(async () => ({ periodMonth: null, rows: [] })),
    acceptedContactsInWindow: vi.fn(async () => [{ practice_id: 'P1', value_pence: 450000 }, { practice_id: 'P1', value_pence: 120000 }]),
  },
}));
let cockpitService, cockpitRepository;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ cockpitService } = await import('../src/services/cockpit.service.js'));
  ({ cockpitRepository } = await import('../src/repositories/cockpit.repository.js'));
  // vi.clearAllMocks() wipes mockImplementation return values too — restore defaults each test.
  cockpitRepository.monthlyPl.mockImplementation(async () => [{ business_name: 'Ashford', revenue_pence: 9500000, net_profit_pence: 2122000 }]);
  cockpitRepository.latestMonthlyPl.mockImplementation(async () => ({ periodMonth: null, rows: [] }));
});
it('sums revenue from cash-up and threads leadRoi', async () => {
  const r = await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15' });
  expect(r.revenue.collectedPence).toBe(185000);
  expect(r.monthly.revenuePence).toBe(9500000);
  expect(r.leadRoi).toBeDefined();
  expect(r.treatment.acceptedValuePence).toBe(570000);
  expect(r.treatment.acceptedCount).toBe(2);
});
it('falls back to the latest available month when the current month has no P&L row yet', async () => {
  cockpitRepository.monthlyPl.mockImplementation(async () => []);
  cockpitRepository.latestMonthlyPl.mockImplementation(async () => ({
    periodMonth: '2026-05-01',
    rows: [{ business_name: 'Ashford', period_month: '2026-05-01', revenue_pence: 800000, net_profit_pence: 100000 }],
  }));
  const r = await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15' });
  expect(r.monthly.periodMonth).toBe('2026-05-01');
  expect(r.monthly.revenuePence).toBe(800000);
  expect(r.monthly.netProfitPence).toBe(100000);
});
it('stays on the current month with zeroed totals when no P&L data exists at all', async () => {
  cockpitRepository.monthlyPl.mockImplementation(async () => []);
  cockpitRepository.latestMonthlyPl.mockImplementation(async () => ({ periodMonth: null, rows: [] }));
  const r = await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15' });
  expect(r.monthly.revenuePence).toBe(0);
  expect(r.monthly.byBusiness).toEqual([]);
});
