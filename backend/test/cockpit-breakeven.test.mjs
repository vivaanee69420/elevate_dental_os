import './setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const DEFAULT_MODEL = [
  { practice_id: 'P1', effective_from: '2026-01-01', fixed_cost_pence_month: 3100000,
    breakeven_low_pence: 8100000, breakeven_high_pence: 8600000,
    working_days_per_month: 20, revenue_target_pence_month: 16000000 },
  // P9 (Warwick Lodge) deliberately has no model.
];

let cockpitService;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ cockpitService } = await import('../src/services/cockpit.service.js'));

  // vi.clearAllMocks() clears CALL HISTORY only — a plain .mockImplementation(...)
  // set by an earlier test (as opposed to .mockImplementationOnce) sticks as the
  // mock's implementation for every test that runs after it, which made this
  // file's outcome depend on execution order under --shuffle. Re-assert each
  // ad-hoc-overridden mock's default here, every test, so order never matters —
  // any test that needs different behaviour still overrides it locally
  // (preferably via .mockImplementationOnce, consumed by its own call(s)).
  const { cockpitRepository } = await import('../src/repositories/cockpit.repository.js');
  const { practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js');
  cockpitRepository.cashupRollup.mockImplementation(async () => CASHUP);
  cockpitRepository.acceptedContactsInWindow.mockImplementation(async () => []);
  practiceCostModelRepository.asOf.mockImplementation(async () => DEFAULT_MODEL);
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

  it('gives a non-reporting practice a null mtdPence, not £0, matching breakeven.rows', async () => {
    // Warwick Lodge has no cash-up in-window OR in-month by default fixture.
    // Restore the default fixture explicitly — a prior test in this file
    // (mockImplementation persists across vi.clearAllMocks()) may have left
    // cashupRollup returning [].
    const { cockpitRepository } = await import('../src/repositories/cockpit.repository.js');
    cockpitRepository.cashupRollup.mockImplementation(async () => CASHUP);
    const out = await cockpitService.build('ORG1', WIN);
    const warwick = out.revenue.month.byPractice.find((r) => r.practiceId === 'P9');
    expect(warwick.mtdPence).toBeNull();
    expect(warwick.projectedPence).toBeNull();
    // The group total still sums real cash-up cash regardless.
    expect(out.revenue.month.mtdPence).toBe(490000);
  });
});

describe('cockpit breakeven — Critical 1 (cash-up-only revenue source)', () => {
  it('reports a practice with an accepted treatment but NO cash-up as not_reporting, never £0', async () => {
    const { cockpitRepository } = await import('../src/repositories/cockpit.repository.js');
    // Restore the default cash-up fixture explicitly (mockImplementation
    // persists across vi.clearAllMocks(); an earlier test in this file may
    // have left cashupRollup returning []).
    cockpitRepository.cashupRollup.mockImplementation(async () => CASHUP);
    // Warwick Lodge (P9) has one accepted treatment but no cash-up row at all —
    // this must NOT be folded into byPractice as collectedPence: 0 and read
    // back as a reporting £0 revenue practice.
    cockpitRepository.acceptedContactsInWindow.mockImplementation(async () => [
      { practice_id: 'P9', value_pence: 250000 },
    ]);
    const out = await cockpitService.build('ORG1', WIN);
    const warwick = out.breakeven.rows.find((r) => r.practiceId === 'P9');
    expect(warwick.status).toBe('not_reporting');
    expect(warwick.revenuePence).toBeNull();
    expect(warwick.profitPence).toBeNull();
    expect(out.breakeven.group.excludedCount).toBeGreaterThanOrEqual(1);
    expect(out.breakeven.group.status).not.toBe('not_set');
    // Ashford (the only real cash-up practice) still carries the group.
    expect(out.breakeven.group.profitPence).toBe(26916);
  });
});

describe('cockpit breakeven — Important 4 (group money nulls when nothing counted)', () => {
  it('returns null for every group money field when no practice has a usable model', async () => {
    const { practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js');
    // mockImplementationOnce, NOT mockImplementation — a plain
    // mockImplementation call persists across vi.clearAllMocks() in
    // beforeEach (that only clears call history, not a previously-set
    // implementation), which made this file order-dependent under --shuffle:
    // whichever test ran after this one inherited the empty-array override
    // instead of the module's default fixture. Once consumes exactly the
    // next asOf() call (the §6 as-of-window-start read) and self-clears.
    practiceCostModelRepository.asOf.mockImplementationOnce(async () => []); // no models at all
    const out = await cockpitService.build('ORG1', WIN);
    expect(out.breakeven.group.revenuePence).toBeNull();
    expect(out.breakeven.group.contributionPence).toBeNull();
    expect(out.breakeven.group.fixedPence).toBeNull();
    expect(out.breakeven.group.breakevenPence).toBeNull();
    expect(out.breakeven.group.profitPence).toBeNull();
    expect(out.breakeven.group.status).toBe('not_set');
  });
});

describe('cockpit — Critical 2 & 3 (London-local window dates)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('anchors revenue.month.periodMonth to December, not January, for a GMT month-end exclusive boundary (window entirely in the past)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-15T12:00:00.000Z'));
    const out = await cockpitService.build('ORG1', {
      since: '2026-12-01T00:00:00.000Z',
      until: '2027-01-01T00:00:00.000Z',
    });
    expect(out.revenue.month.periodMonth).toBe('2026-12-01');
  });

  it('reads the cost model as-of the London-local window start, not the UTC-truncated date, for a BST window', async () => {
    const { practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js');
    await cockpitService.build('ORG1', {
      since: '2026-06-30T23:00:00.000Z',
      until: '2026-07-31T23:00:00.000Z',
    });
    expect(practiceCostModelRepository.asOf).toHaveBeenCalledWith('ORG1', '2026-07-01');
  });
});

describe('cockpit — Important 3 (month anchor clamps to today, never a future month)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('"This year" (until = next 1 Jan) anchors to the CURRENT month, not December, when today is earlier in the year', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
    const out = await cockpitService.build('ORG1', {
      since: '2026-01-01T00:00:00.000Z',
      until: '2027-01-01T00:00:00.000Z',
    });
    // Not '2026-12-01' — December hasn't happened yet relative to "today".
    expect(out.revenue.month.periodMonth).toBe('2026-07-01');
  });

  it('a window ending in the past still anchors to the window\'s own last month (no clamp needed)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
    const out = await cockpitService.build('ORG1', {
      // London-wall-clock midnight of 1 April in BST is 23:00 UTC on the 31st
      // — the same convention the scope bar uses (see the July/BST test above).
      since: '2026-02-28T00:00:00.000Z',
      until: '2026-03-31T23:00:00.000Z',
    });
    expect(out.revenue.month.periodMonth).toBe('2026-03-01');
  });

  it('a bare YYYY-MM-DD `until` is treated as a plain date, not round-tripped through an instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
    const out = await cockpitService.build('ORG1', { since: '2026-07-01', until: '2026-08-01' });
    // A bug once resolved this to August (the exclusive boundary itself)
    // because `until`'s UTC-midnight instant minus 1ms still lands inside
    // BST's +1h offset and doesn't cross local midnight.
    expect(out.revenue.month.periodMonth).toBe('2026-07-01');
  });
});

describe('cockpit — Important 1 (§1 daily target/working-days read as-of TODAY, not the window start)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a target saved today still shows on revenue.month even when the window starts earlier in the month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
    const { practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js');
    // Window start (1st) has NO model at all; today's model (read separately)
    // carries a target. Before the fix, revenue.month reused the window-start
    // read and this target was invisible — a successful save appeared to do
    // nothing.
    practiceCostModelRepository.asOf.mockImplementationOnce(async () => []); // window-start read: nothing
    practiceCostModelRepository.asOf.mockImplementationOnce(async () => [ // today's read: a target exists
      { practice_id: 'P1', effective_from: '2026-07-17', fixed_cost_pence_month: null,
        breakeven_low_pence: null, breakeven_high_pence: null,
        working_days_per_month: 22, revenue_target_pence_month: 22000000 },
    ]);
    const out = await cockpitService.build('ORG1', { since: '2026-07-01', until: '2026-07-31' });
    const ashford = out.revenue.month.byPractice.find((r) => r.practiceId === 'P1');
    expect(ashford.dailyTargetPence).toBe(1000000); // 22,000,000 / 22
  });
});
