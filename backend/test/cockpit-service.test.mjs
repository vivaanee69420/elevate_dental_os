import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/services/lead-attribution.service.js', () => ({
  leadAttributionService: {
    channelBreakdown: vi.fn(async () => ({
      channels: [],
      spendByChannel: { google: 0, facebook: 0 },
      group: {},
      groupChannels: {
        google: { leads: 10, conversions: 1, matchedValuePence: 200000, spendPence: 100000, cplPence: 10000, roi: 2 },
        facebook: { leads: 0, conversions: 0, matchedValuePence: 0, spendPence: 0, cplPence: null, roi: null },
      },
    })),
  },
  classifyChannel: () => null,
}));
vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    cashupRollup: vi.fn(async () => [{ practice_id: 'P1', business_name: 'Ashford', cashup_date: '2026-07-01', cash_up_money_taken_pence: 185000, treatments_accepted: 2, tx_plans_given: 3, tx_plan_given_value_pence: 1200000, num_new_leads: 9, num_attended: 8, detail_patient_money_total_pence: 450000 }]),
    monthlyPl: vi.fn(async () => [{
      business_name: 'Ashford', revenue_pence: 9500000, net_profit_pence: 2122000,
      principal_fees_pence: 300000, hygienist_therapist_pence: 0, lab_fees_pence: 150000, materials_pence: null, sedation_services_pence: 50000,
      advertising_marketing_pence: 80000, bank_charges_pence: 0, business_rates_rent_pence: 200000, salaries_staff_cost_pence: 500000, telephone_wifi_pence: null,
      utilities_pence: 40000, insurance_pence: 0, management_fees_pence: 0, subscriptions_pence: 10000, it_expenses_pence: 0, card_machine_charges_pence: 5000,
      custom_lines: { 'One-off refit': 60000, 'Zero line': 0 },
      line_notes: { principal_fees: 'includes bonus' },
    }]),
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
  cockpitRepository.monthlyPl.mockImplementation(async () => [{
    business_name: 'Ashford', revenue_pence: 9500000, net_profit_pence: 2122000,
    principal_fees_pence: 300000, hygienist_therapist_pence: 0, lab_fees_pence: 150000, materials_pence: null, sedation_services_pence: 50000,
    advertising_marketing_pence: 80000, bank_charges_pence: 0, business_rates_rent_pence: 200000, salaries_staff_cost_pence: 500000, telephone_wifi_pence: null,
    utilities_pence: 40000, insurance_pence: 0, management_fees_pence: 0, subscriptions_pence: 10000, it_expenses_pence: 0, card_machine_charges_pence: 5000,
    custom_lines: { 'One-off refit': 60000, 'Zero line': 0 },
    line_notes: { principal_fees: 'includes bonus' },
  }]);
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
it('threads groupChannels (org-wide per-channel CPL/ROI) onto leadRoi', async () => {
  const r = await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15' });
  expect(r.leadRoi.groupChannels.google).toEqual({ leads: 10, conversions: 1, matchedValuePence: 200000, spendPence: 100000, cplPence: 10000, roi: 2 });
  expect(r.leadRoi.groupChannels.facebook.cplPence).toBeNull();
  expect(r.leadRoi.groupChannels.facebook.roi).toBeNull();
});
it('treatment.byPractice carries newLeads/attended per practice', async () => {
  const r = await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15' });
  const p1 = r.treatment.byPractice.find(p => p.practiceId === 'P1');
  expect(p1.newLeads).toBe(9);
  expect(p1.attended).toBe(8);
});
it('includes monthly costLines/opexLines/customLines/lineNotes and revenue.dailySeries', async () => {
  const r = await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15' });
  expect(r.monthly.costLines).toBeDefined();
  expect(r.monthly.costLines[0]).toEqual({ name: expect.any(String), amountPence: expect.any(Number) });
  // largest-first, zero/absent dropped
  expect(r.monthly.costLines.map(l => l.amountPence)).toEqual([...r.monthly.costLines.map(l => l.amountPence)].sort((a, b) => b - a));
  expect(r.monthly.costLines.every(l => l.amountPence > 0)).toBe(true);
  expect(r.monthly.costLines.find(l => l.name.toLowerCase().includes('principal'))?.amountPence).toBe(300000);
  expect(r.monthly.costLines.find(l => l.name.toLowerCase().includes('hygienist'))).toBeUndefined();

  expect(r.monthly.opexLines).toBeDefined();
  expect(r.monthly.opexLines.every(l => l.amountPence > 0)).toBe(true);
  expect(r.monthly.opexLines.find(l => l.name.toLowerCase().includes('advertising'))?.amountPence).toBe(80000);

  expect(r.monthly.customLines).toBeDefined();
  expect(r.monthly.customLines).toEqual([{ name: 'One-off refit', amountPence: 60000 }]);

  expect(r.monthly.lineNotes).toBeDefined();
  expect(r.monthly.lineNotes.length).toBeGreaterThan(0);

  expect(r.revenue.dailySeries).toEqual([{ date: '2026-07-01', cashPence: 185000 }]);
});
it('threads practiceId to repo reads and channelBreakdown', async () => {
  const { leadAttributionService } = await import('../src/services/lead-attribution.service.js');
  await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15', practiceId: 'P1' });
  expect(cockpitRepository.cashupRollup).toHaveBeenCalledWith('org1', '2026-07-01', '2026-07-15', 'P1');
  expect(cockpitRepository.monthlyPl).toHaveBeenCalledWith('org1', expect.any(String), 'P1');
  expect(cockpitRepository.acceptedContactsInWindow).toHaveBeenCalledWith('org1', '2026-07-01', '2026-07-15', 'P1');
  expect(leadAttributionService.channelBreakdown).toHaveBeenCalledWith('org1', { since: '2026-07-01', until: '2026-07-15', practiceId: 'P1' });
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
