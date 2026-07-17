import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/lead-attribution.service.js', () => ({
  leadAttributionService: { channelBreakdown: vi.fn(async () => ({ channels: [], group: {}, groupChannels: {} })) },
  classifyChannel: () => null,
  matchAcceptedValue: () => null,
  buildAcceptedByKey: () => ({ acceptedByKey: new Map(), nameByPractice: new Map() }),
}));

// Ashford traded one day (£4,900); Warwick Lodge has no cash-up at all.
const CASHUP = [
  { practice_id: 'P1', business_name: 'Ashford', cashup_date: '2026-07-15',
    cash_up_money_taken_pence: 490000, detail_patient_money_total_pence: 490000,
    tx_plans_given: 0, tx_plan_given_value_pence: 0, num_new_leads: 0, num_attended: 0 },
];

vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    cashupRollup: vi.fn(async () => CASHUP),
    monthlyPl: vi.fn(async () => []),
    latestMonthlyPl: vi.fn(async () => ({ periodMonth: null, rows: [] })),
    acceptedContactsInWindow: vi.fn(async () => []),
    revenueByLine: vi.fn(async () => []),
    activePractices: vi.fn(async () => [
      { id: 'P1', name: 'Ashford' },
      { id: 'P9', name: 'Warwick Lodge' },
    ]),
  },
}));
vi.mock('../src/repositories/practice-cost-model.repository.js', () => ({
  practiceCostModelRepository: {
    asOf: vi.fn(async () => [
      { practice_id: 'P1', effective_from: '2026-01-01', fixed_cost_pence_month: 3100000,
        breakeven_low_pence: 8100000, breakeven_high_pence: 8600000,
        working_days_per_month: 20, revenue_target_pence_month: 16000000 },
      // P9 (Warwick Lodge) deliberately has no model.
    ]),
  },
}));

let cockpitService;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ cockpitService } = await import('../src/services/cockpit.service.js'));
});

const WIN = { since: '2026-07-15', until: '2026-07-16' };

describe('cockpit breakeven block', () => {
  it('computes profit for a practice with a model over the days it traded', async () => {
    const out = await cockpitService.build('ORG1', WIN);
    const ashford = out.breakeven.rows.find((r) => r.practiceId === 'P1');
    expect(ashford.revenuePence).toBe(490000);
    expect(ashford.workingDaysInWindow).toBe(1);
    expect(ashford.breakevenDayPence).toBe(417500);
    expect(ashford.fixedPence).toBe(155000);
    expect(ashford.profitPence).toBe(26916);
    expect(ashford.status).toBe('above');
  });

  it('shows a practice with no feed as not_reporting, never £0', async () => {
    const out = await cockpitService.build('ORG1', WIN);
    const warwick = out.breakeven.rows.find((r) => r.practiceId === 'P9');
    expect(warwick.name).toBe('Warwick Lodge');
    expect(warwick.status).toBe('not_reporting');
    expect(warwick.revenuePence).toBeNull();
    expect(warwick.profitPence).toBeNull();
  });

  it('excludes practices without a usable model from the group row and counts them', async () => {
    const out = await cockpitService.build('ORG1', WIN);
    // Only Ashford contributes. Folding Warwick in as £0 fixed would overstate
    // group profit — the exact failure this section exists to prevent.
    expect(out.breakeven.group.revenuePence).toBe(490000);
    expect(out.breakeven.group.profitPence).toBe(26916);
    expect(out.breakeven.group.status).toBe('above');
    expect(out.breakeven.group.excludedCount).toBe(1);
  });

  it('reads the cost model as-of the window start, not today', async () => {
    const { practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js');
    await cockpitService.build('ORG1', { since: '2026-03-01', until: '2026-04-01' });
    expect(practiceCostModelRepository.asOf).toHaveBeenCalledWith('ORG1', '2026-03-01');
  });
});

describe('cockpit revenue.month block', () => {
  it('derives today, MTD, projection and daily target', async () => {
    const out = await cockpitService.build('ORG1', WIN);
    const m = out.revenue.month;
    expect(m.todayPence).toBe(490000);
    expect(m.todayDate).toBe('2026-07-15');
    expect(m.mtdPence).toBe(490000);
    expect(m.workingDaysElapsed).toBe(1);
    // projection = mtd/elapsed x workingDaysPerMonth = 490000/1 x 20
    expect(m.projectedPence).toBe(9800000);
    // daily target = 16000000/20 = 800000 (£8,000)
    expect(m.dailyTargetPence).toBe(800000);
  });

  it('returns a null projection rather than dividing by zero when nothing traded', async () => {
    const { cockpitRepository } = await import('../src/repositories/cockpit.repository.js');
    cockpitRepository.cashupRollup.mockImplementation(async () => []);
    const out = await cockpitService.build('ORG1', WIN);
    expect(out.revenue.month.projectedPence).toBeNull();
    expect(out.revenue.month.todayPence).toBeNull();
  });
});
