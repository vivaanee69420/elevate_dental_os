import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/lead-attribution.service.js', () => ({
  leadAttributionService: { channelBreakdown: vi.fn(async () => ({ channels: [], group: {}, groupChannels: {} })) },
  classifyChannel: () => null,
  matchAcceptedValue: () => null,
  buildAcceptedByKey: () => ({ acceptedByKey: new Map(), nameByPractice: new Map() }),
}));
vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    cashupRollup: vi.fn(async () => []),
    monthlyPl: vi.fn(async () => []),
    latestMonthlyPl: vi.fn(async () => ({ periodMonth: null, rows: [] })),
    acceptedContactsInWindow: vi.fn(async () => []),
    activePractices: vi.fn(async () => []),
    costModelAsOf: vi.fn(async () => []),
    revenueByLine: vi.fn(async () => [
      { practice_id: 'P1', treatment_name: 'Implants', fee_pence: 10764300, item_count: 20 },
      { practice_id: 'P2', treatment_name: 'Implants', fee_pence: 0, item_count: 0 },
      { practice_id: 'P1', treatment_name: 'Restorative', fee_pence: 5493100, item_count: 40 },
      { practice_id: 'P2', treatment_name: 'Orthodontics', fee_pence: 774400, item_count: 5 },
    ]),
  },
}));

let cockpitService;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ cockpitService } = await import('../src/services/cockpit.service.js'));
});

describe('cockpit revenueByLine', () => {
  it('sums fee by treatment name across practices, largest-first, with share', async () => {
    const out = await cockpitService.build('ORG1', { since: '2026-06-10', until: '2026-07-18' });
    // total = 10764300 + 5493100 + 774400 = 17031800
    expect(out.revenueByLine).toEqual([
      { name: 'Implants',      amountPence: 10764300, sharePct: 63.2 },
      { name: 'Restorative',   amountPence: 5493100,  sharePct: 32.3 },
      { name: 'Orthodontics',  amountPence: 774400,   sharePct: 4.5 },
    ]);
  });

  it('drops zero-fee lines rather than rendering them as £0 rows', async () => {
    const out = await cockpitService.build('ORG1', { since: '2026-06-10', until: '2026-07-18' });
    expect(out.revenueByLine.some(l => l.amountPence === 0)).toBe(false);
  });

  it('returns an empty list, not a crash, when the window predates invoice_items', async () => {
    const { cockpitRepository } = await import('../src/repositories/cockpit.repository.js');
    cockpitRepository.revenueByLine.mockImplementation(async () => []);
    const out = await cockpitService.build('ORG1', { since: '2026-01-01', until: '2026-02-01' });
    expect(out.revenueByLine).toEqual([]);
  });
});
