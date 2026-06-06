// ============================================================================
// treatmentMatrix service — appointment VOLUME by type x practice for the
// selected scope + period. Builds the heat matrix (columns = practices, rows =
// types top-12 + Other), maxCell for intensity, and volume-framed insight
// cards. Academy/Lab scope -> not applicable. No money (Dentally data wall).
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-mmmmmmmm';
const now = () => new Date(Date.UTC(2026, 4, 15)); // 2026-05-15

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.rpcCalls = [];
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

// Two practices, three treatment types, via the treatment_mix_matrix RPC.
function stubMatrix() {
  supaRec.resultProvider = (q) =>
    q.table === 'practices'
      ? { data: [
          { id: 'p1', name: 'Rochester', chairs: 6, assumed_util_pct: 84 },
          { id: 'p2', name: 'Barnet', chairs: 5, assumed_util_pct: null },
        ], error: null }
      : { data: [], error: null };
  supaRec.rpcProvider = (fn) =>
    fn === 'treatment_mix_matrix'
      ? { data: [
          { practice_id: 'p1', appointment_type: 'Checkup', volume: 40 },
          { practice_id: 'p2', appointment_type: 'Checkup', volume: 10 },
          { practice_id: 'p1', appointment_type: 'Filling', volume: 20 },
          { practice_id: 'p1', appointment_type: 'Whitening', volume: 30 }, // p1-only
        ], error: null }
      : { data: [], error: null };
}

describe('treatmentMatrix', () => {
  it('builds columns, rows, totals, shares and maxCell from the RPC', async () => {
    stubMatrix();
    const r = await svc.treatmentMatrix(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

    expect(r.applicable).toBe(true);
    expect(r.grandTotal).toBe(100);
    expect(r.distinctTypes).toBe(3);

    // Columns sorted by practice volume desc: p1 (90) before p2 (10).
    expect(r.practices.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(r.practices[0]).toMatchObject({ id: 'p1', name: 'Rochester', total: 90 });
    expect(r.practices[1]).toMatchObject({ id: 'p2', name: 'Barnet', total: 10 });

    // Rows sorted by type volume desc: Checkup(50), Whitening(30), Filling(20).
    expect(r.types.map((t) => t.type)).toEqual(['Checkup', 'Whitening', 'Filling']);
    const checkup = r.types.find((t) => t.type === 'Checkup');
    expect(checkup.total).toBe(50);
    expect(checkup.sharePct).toBe(50);
    // cells align to the practices column order [p1, p2].
    expect(checkup.cells).toEqual([40, 10]);
    const whitening = r.types.find((t) => t.type === 'Whitening');
    expect(whitening.cells).toEqual([30, 0]); // p1-only

    // maxCell = biggest single cell (Checkup @ p1 = 40).
    expect(r.maxCell).toBe(40);

    // RPC received org + the May 2026 window.
    const call = supaRec.rpcCalls.find((c) => c.fn === 'treatment_mix_matrix');
    expect(call.params.p_org).toBe(ORG);
    expect(call.params.p_since).toBe('2026-05-01T00:00:00.000Z');
    expect(call.params.p_until).toBe('2026-06-01T00:00:00.000Z');
  });

  it('emits volume-framed insight cards (no money)', async () => {
    stubMatrix();
    const r = await svc.treatmentMatrix(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    const titles = r.insights.map((i) => i.title);
    // Top treatment + busiest site + Pareto breadth always present here.
    expect(titles.some((t) => /Checkup leads the mix/.test(t))).toBe(true);
    expect(titles.some((t) => /Rochester is the busiest site/.test(t))).toBe(true);
    expect(titles.some((t) => /Mix breadth/.test(t))).toBe(true);
    // Whitening is 100% at p1 -> single-site concentration warning.
    expect(titles.some((t) => /concentrated at one site/.test(t))).toBe(true);
    // No card text contains a currency symbol.
    for (const c of r.insights) {
      expect(`${c.title} ${c.body}`).not.toMatch(/£/);
    }
  });

  it('day period -> single-day window', async () => {
    stubMatrix();
    const r = await svc.treatmentMatrix(ORG, { scope: 'all', period: 'day', periodKey: '2026-05-15', now });
    const call = supaRec.rpcCalls.find((c) => c.fn === 'treatment_mix_matrix');
    expect(call.params.p_since).toBe('2026-05-15T00:00:00.000Z');
    expect(call.params.p_until).toBe('2026-05-16T00:00:00.000Z');
    expect(r.window.label).toBe('15 May 2026');
  });

  it('entity scope filters columns to the one practice', async () => {
    stubMatrix();
    const r = await svc.treatmentMatrix(ORG, { scope: 'p2', period: 'month', periodKey: '2026-05', now });
    expect(r.practices.map((p) => p.id)).toEqual(['p2']);
    // Only p2's Checkup row survives the scope filter.
    expect(r.grandTotal).toBe(10);
    expect(r.types.map((t) => t.type)).toEqual(['Checkup']);
    expect(r.types[0].cells).toEqual([10]);
  });

  it('rolls the long tail (>12 types) into one Other row, excluded from maxCell', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices'
        ? { data: [{ id: 'p1', name: 'Rochester', chairs: 6, assumed_util_pct: 84 }], error: null }
        : { data: [], error: null };
    // 14 distinct types: ranks 1..12 kept, 13+14 -> 'Other'.
    const data = [];
    for (let i = 0; i < 14; i++) data.push({ practice_id: 'p1', appointment_type: `T${i}`, volume: 100 - i });
    supaRec.rpcProvider = (fn) => (fn === 'treatment_mix_matrix' ? { data, error: null } : { data: [], error: null });

    const r = await svc.treatmentMatrix(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.distinctTypes).toBe(14);
    const other = r.types.find((t) => t.type === 'Other treatment types');
    expect(other).toBeTruthy();
    expect(other.isOther).toBe(true);
    expect(other.total).toBe((100 - 12) + (100 - 13)); // T12 + T13 = 88 + 87
    // 13 visible rows: 12 named + Other.
    expect(r.types.length).toBe(13);
    // maxCell ignores Other (so the biggest single-type cell, T0=100, wins).
    expect(r.maxCell).toBe(100);
  });

  it('revenue matrix: real fees by treatment name x practice, money insights', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices'
        ? { data: [
            { id: 'p1', name: 'Rochester', chairs: 6, assumed_util_pct: 84 },
            { id: 'p2', name: 'Barnet', chairs: 5, assumed_util_pct: null },
          ], error: null }
        : { data: [], error: null };
    supaRec.rpcProvider = (fn) =>
      fn === 'treatment_revenue_matrix'
        ? { data: [
            { practice_id: 'p1', treatment_name: 'Single Implant', fee_pence: 410000, item_count: 2 },
            { practice_id: 'p2', treatment_name: 'Single Implant', fee_pence: 205000, item_count: 1 },
            { practice_id: 'p1', treatment_name: 'Whitening', fee_pence: 80000, item_count: 4 },
          ], error: null }
        : { data: [], error: null };

    const r = await svc.treatmentRevenueMatrix(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.applicable).toBe(true);
    expect(r.basis).toBe('invoice_items');
    expect(r.hasData).toBe(true);
    expect(r.grandTotal).toBe(695000); // pence
    // Single Implant is the top earner (615000), cells aligned to [p1, p2].
    const si = r.types.find((t) => t.type === 'Single Implant');
    expect(si.total).toBe(615000);
    expect(si.cells).toEqual([410000, 205000]);
    expect(r.maxCell).toBe(410000);
    // Money-framed insight present (contains a £ amount).
    expect(r.insights.some((i) => /earns the most/.test(i.title))).toBe(true);
    expect(r.insights.some((i) => /£/.test(`${i.title} ${i.body}`))).toBe(true);
    const call = supaRec.rpcCalls.find((c) => c.fn === 'treatment_revenue_matrix');
    expect(call.params.p_org).toBe(ORG);
  });

  it('revenue matrix: empty invoice_items -> hasData false, no insights', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices'
        ? { data: [{ id: 'p1', name: 'Rochester', chairs: 6, assumed_util_pct: 84 }], error: null }
        : { data: [], error: null };
    supaRec.rpcProvider = () => ({ data: [], error: null });
    const r = await svc.treatmentRevenueMatrix(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.applicable).toBe(true);
    expect(r.hasData).toBe(false);
    expect(r.grandTotal).toBe(0);
    expect(r.insights).toEqual([]);
  });

  it('revenue matrix: academy/lab scope -> not applicable', async () => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    const r = await svc.treatmentRevenueMatrix(ORG, { scope: 'lab', now });
    expect(r.applicable).toBe(false);
    expect(r.scope).toBe('lab');
  });

  it('academy/lab scope -> not applicable', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices'
        ? { data: [{ id: 'acad', name: 'Academy', kind: 'academy' }], error: null }
        : { data: [], error: null };
    const r = await svc.treatmentMatrix(ORG, { scope: 'academy', now });
    expect(r.applicable).toBe(false);
    expect(r.scope).toBe('academy');
  });

  it('falls back to a paginated appointment scan when the RPC is absent', async () => {
    supaRec.rpcProvider = () => ({ data: null, error: { message: 'rpc missing' } });
    supaRec.resultProvider = (q) => {
      if (q.table === 'practices')
        return { data: [{ id: 'p1', name: 'Rochester', chairs: 6, assumed_util_pct: 84 }], error: null };
      if (q.table === 'appointments')
        return { data: [
          { practice_id: 'p1', appointment_type: 'Checkup' },
          { practice_id: 'p1', appointment_type: 'Checkup' },
          { practice_id: 'p1', appointment_type: null },
        ], error: null };
      return { data: [], error: null };
    };
    const r = await svc.treatmentMatrix(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.grandTotal).toBe(3);
    const checkup = r.types.find((t) => t.type === 'Checkup');
    expect(checkup.cells).toEqual([2]);
    // NULL appointment_type collapses to 'Unspecified'.
    expect(r.types.find((t) => t.type === 'Unspecified').cells).toEqual([1]);
    // Fallback scan is org-scoped and bounded by the window (.lt on starts_at).
    expect(supaRec.last.eqs.find((e) => e.col === 'organisation_id')).toEqual({ col: 'organisation_id', val: ORG });
    expect((supaRec.last.lts ?? []).some((l) => l.col === 'starts_at')).toBe(true);
  });
});
