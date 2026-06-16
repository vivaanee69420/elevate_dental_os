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
  it('occupancy from the MANUAL grid; no grid -> zero/blank (no 80% fallback); rolls up group', async () => {
    // p1 has manual grid rows -> occupancy = booked/available; p2 has none -> blank.
    supaRec.resultProvider = (q) =>
      q.table === 'chair_utilisation'
        ? { data: [
            { practice_id: 'p1', booked_minutes: 4790, available_minutes: 7200 }, // 66.5% -> 66.5
          ], error: null }
        : { data: [
            { id: 'p1', name: 'Rochester', chairs: 6, assumed_util_pct: 84 },
            { id: 'p2', name: 'Barnet', chairs: 5, assumed_util_pct: null },
          ], error: null };
    supaRec.rpcProvider = (fn) =>
      fn === 'settled_revenue_by_practice'
        ? { data: [{ practice_id: 'p1', pence: 231_840_000 }], error: null }
        : { data: [], error: null };

    const r = await svc.chairAnalytics(ORG, { scope: 'all', recoverPctPoints: 10, now });

    expect(r.applicable).toBe(true);
    const p1 = r.practices.find((x) => x.id === 'p1');
    const p2 = r.practices.find((x) => x.id === 'p2');
    // p1: manual grid 4790/7200 = 66.5% -> source 'manual', not assumed
    expect(p1.occupancySource).toBe('manual');
    expect(p1.utilAssumed).toBe(false);
    expect(p1.occupancyPct).toBe(66.5);
    expect(p1.capHrsYr).toBe(11040);          // 6*8*230
    // p2: no grid -> blank (no 80% assumption, zero capacity/occupancy/cost)
    expect(p2.occupancySource).toBe('none');
    expect(p2.utilAssumed).toBe(false);
    expect(p2.occupancyPct).toBe(0);
    expect(p2.capHrsYr).toBe(0);
    expect(p2.chairs).toBe(0);
    expect(p2.lostPotentialYrPence).toBe(0);

    // Group rolls up p1 only (p2 contributes nothing until its grid is filled).
    expect(r.group.capHrsYr).toBe(11040);
    expect(r.group.chairs).toBe(6);
    expect(r.ocpspd).toBeNull();
  });

  it('academy/lab scope -> not applicable, no crash', async () => {
    supaRec.resultProvider = () => ({ data: [{ id: 'acad', name: 'Academy', kind: 'academy' }], error: null });
    const r = await svc.chairAnalytics(ORG, { scope: 'academy', now });
    expect(r.applicable).toBe(false);
    expect(r.scope).toBe('academy');
  });
});
