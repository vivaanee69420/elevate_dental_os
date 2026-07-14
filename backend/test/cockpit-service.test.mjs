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
  },
}));
let cockpitService;
beforeEach(async () => { vi.clearAllMocks(); ({ cockpitService } = await import('../src/services/cockpit.service.js')); });
it('sums revenue from cash-up and threads leadRoi', async () => {
  const r = await cockpitService.build('org1', { since: '2026-07-01', until: '2026-07-15' });
  expect(r.revenue.collectedPence).toBe(185000);
  expect(r.monthly.revenuePence).toBe(9500000);
  expect(r.leadRoi).toBeDefined();
});
