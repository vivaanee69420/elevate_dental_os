// ============================================================================
// cashByDay service (Day — Cash Collected, GM Intelligence OS T9). Real settled
// receipts banked by working day across the month in scope, with a composite
// collection index (each day vs the average working day = 100). Cash receipts
// by processed_at date — NOT billed production. Scope/period-driven.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-dddddddd';
const now = () => new Date(Date.UTC(2026, 4, 15)); // 2026-05-15

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.rpcCalls = [];
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

// Two cash days in May 2026 (04 = Mon, 05 = Tue) via settled_receipts_by_day.
function stubReceipts() {
  supaRec.rpcProvider = (fn) =>
    fn === 'settled_receipts_by_day'
      ? { data: [
          { day: '2026-05-04', pence: 100000 },
          { day: '2026-05-05', pence: 300000 },
        ], error: null }
      : { data: [], error: null };
}

describe('cashByDay', () => {
  it('builds the month by-day series, totals, avg and composite index', async () => {
    stubReceipts();
    const r = await svc.cashByDay(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

    expect(r.applicable).toBe(true);
    expect(r.basis).toBe('settled_receipts');
    expect(r.hasData).toBe(true);
    expect(r.totalPence).toBe(400000);
    // May 2026 has 26 Mon–Sat days (5 Sundays: 3,10,17,24,31).
    expect(r.workingDays).toBe(26);
    expect(r.avgPerDayPence).toBe(Math.round(400000 / 26));
    // Empty Sundays are excluded; only the 26 working days appear (none banked Sun).
    expect(r.days.length).toBe(26);

    const tue = r.days.find((d) => d.date === '2026-05-05');
    expect(tue.pence).toBe(300000);
    expect(tue.label).toBe('Tue 5 May');
    // index = pence / avg * 100, 1dp.
    expect(tue.index).toBe(Math.round((300000 / r.avgPerDayPence) * 1000) / 10);

    // Peak = the biggest single day (Tue 5 May).
    expect(r.peak.date).toBe('2026-05-05');
  });

  it('emits a peak-day Decision Lens card from real data', async () => {
    stubReceipts();
    const r = await svc.cashByDay(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.insights.some((i) => /Peak collection/.test(i.title))).toBe(true);
    // Peak card carries a £ value tag.
    expect(r.insights.some((i) => /£/.test(`${i.body} ${i.value ?? ''}`))).toBe(true);
  });

  it('day period highlights the selected day but still returns the whole month', async () => {
    stubReceipts();
    const r = await svc.cashByDay(ORG, { scope: 'all', period: 'day', periodKey: '2026-05-05', now });
    expect(r.days.length).toBe(26); // whole month
    expect(r.selected.date).toBe('2026-05-05');
    expect(r.selected.pence).toBe(300000);
  });

  it('whole-group scope queries the org (no practice filter)', async () => {
    stubReceipts();
    await svc.cashByDay(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    const call = supaRec.rpcCalls.find((c) => c.fn === 'settled_receipts_by_day');
    expect(call.params.p_org).toBe(ORG);
    expect(call.params.p_practice).toBe(null);
    expect(call.params.p_since).toBe('2026-05-01T00:00:00.000Z');
    expect(call.params.p_until).toBe('2026-06-01T00:00:00.000Z');
  });

  it('entity scope filters receipts to the one practice', async () => {
    stubReceipts();
    await svc.cashByDay(ORG, { scope: 'p7', period: 'month', periodKey: '2026-05', now });
    const call = supaRec.rpcCalls.find((c) => c.fn === 'settled_receipts_by_day');
    expect(call.params.p_practice).toBe('p7');
  });

  it('no receipts -> hasData false, zero totals, no insights', async () => {
    supaRec.rpcProvider = () => ({ data: [], error: null });
    const r = await svc.cashByDay(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.hasData).toBe(false);
    expect(r.totalPence).toBe(0);
    expect(r.insights).toEqual([]);
  });
});
