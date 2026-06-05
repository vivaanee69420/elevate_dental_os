// ============================================================================
// chairAnalytics service — joins practicesFull (chairs + assumed_util_pct) with
// real trailing-12mo settled revenue per practice, runs the chair formulas, and
// rolls up to a group + recovery projection. Academy/Lab scope -> not applicable.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-aaaaaaaa';
const now = () => new Date(Date.UTC(2026, 4, 15));

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('chairAnalytics', () => {
  it('joins chairs + assumed_util_pct + real revenue; flags assumed util; rolls up group', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { id: 'p1', name: 'Rochester', chairs: 6, assumed_util_pct: 84 },
        { id: 'p2', name: 'Barnet', chairs: 5, assumed_util_pct: null }, // -> default 80, flagged
      ],
      error: null,
    });
    supaRec.rpcProvider = (fn) =>
      fn === 'settled_revenue_by_practice'
        ? { data: [{ practice_id: 'p1', pence: 231_840_000 }], error: null } // p2 has no revenue row -> 0
        : { data: [], error: null };

    const r = await svc.chairAnalytics(ORG, { scope: 'all', recoverPctPoints: 10, now });

    expect(r.applicable).toBe(true);
    const p1 = r.practices.find((x) => x.id === 'p1');
    const p2 = r.practices.find((x) => x.id === 'p2');
    expect(p1.utilAssumed).toBe(false);
    expect(p1.capHrsYr).toBe(11040);          // 6*8*230
    expect(p1.revPerBookedHrPence).toBe(25000); // 231.84M / 9273.6h
    expect(p2.utilAssumed).toBe(true);          // null -> default 80
    expect(p2.occupancyPct).toBe(80);

    // group capacity = 11040 + (5*8*230=9200) = 20240
    expect(r.group.capHrsYr).toBe(20240);
    expect(r.group.chairs).toBe(11);
    expect(r.recovery.recoveryHrsYr).toBe(2024); // 10% of 20240
    expect(r.ocpspd).toBeNull();                 // deferred, honestly flagged
  });

  it('academy/lab scope -> not applicable, no crash', async () => {
    supaRec.resultProvider = () => ({ data: [{ id: 'acad', name: 'Academy', kind: 'academy' }], error: null });
    const r = await svc.chairAnalytics(ORG, { scope: 'academy', now });
    expect(r.applicable).toBe(false);
    expect(r.scope).toBe('academy');
  });
});
