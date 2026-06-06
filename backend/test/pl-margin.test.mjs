// ============================================================================
// plMargin service (P&L & Margin, GM Intelligence OS T11). Scope/period-aware
// group P&L statement + per-entity breakdown from REAL monthly_financials
// actuals (Xero/QuickBooks override manual). Honest CoA bucket granularity:
// revenue, lab+materials, staff (incl. associate pay), other opex; tax excluded.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-pppppppp';
const now = () => new Date(Date.UTC(2026, 4, 15)); // 2026-05-15

const ENTITIES = [
  { id: 'p1', name: 'Rochester', kind: 'practice' },
  { id: 'p2', name: 'Barnet', kind: 'practice' },
  { id: 'ac', name: 'Academy', kind: 'academy' },
];

// monthly_financials rows for May 2026.
const FIN_MAY = [
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 1000000, source: 'xero' },
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'lab', amount_pence: 100000, source: 'xero' },
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'staff', amount_pence: 300000, source: 'xero' },
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'overhead', amount_pence: 200000, source: 'xero' },
  { practice_id: 'p2', period: '2026-05', dental_bucket: 'revenue', amount_pence: 500000, source: 'manual' },
  { practice_id: 'p2', period: '2026-05', dental_bucket: 'staff', amount_pence: 200000, source: 'manual' },
];

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.rpcCalls = [];
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

function stub(fin) {
  supaRec.resultProvider = (q) => {
    if (q.table === 'practices') return { data: ENTITIES, error: null };
    if (q.table === 'monthly_financials') return { data: fin, error: null };
    return { data: [], error: null };
  };
}

describe('plMargin', () => {
  it('group statement + per-entity P&L from the selected month actuals', async () => {
    stub(FIN_MAY);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

    expect(r.applicable).toBe(true);
    expect(r.hasData).toBe(true);
    expect(r.basis).toBe('actuals-month');
    expect(r.dentistStaffSeparable).toBe(false);

    // Group = p1 + p2 summed.
    expect(r.statement.revPence).toBe(1500000);
    expect(r.statement.labMaterialsPence).toBe(100000);
    expect(r.statement.grossPence).toBe(1400000);
    expect(r.statement.staffPence).toBe(500000);
    expect(r.statement.otherOpexPence).toBe(200000);
    expect(r.statement.netPence).toBe(700000);

    // Per-entity, sorted by revenue desc (p1 then p2).
    expect(r.perEntityAvailable).toBe(true);
    expect(r.entities.map((e) => e.id)).toEqual(['p1', 'p2']);
    const p1 = r.entities[0];
    expect(p1).toMatchObject({ name: 'Rochester', revPence: 1000000, netPence: 400000, marginPct: 40 });
  });

  it('entity scope filters to the one practice', async () => {
    stub(FIN_MAY);
    const r = await svc.plMargin(ORG, { scope: 'p2', period: 'month', periodKey: '2026-05', now });
    expect(r.statement.revPence).toBe(500000);
    expect(r.entities.map((e) => e.id)).toEqual(['p2']);
    expect(r.entities[0].netPence).toBe(300000);
  });

  it('falls back to trailing annual when the selected month has no actuals', async () => {
    // Data only in March; ask for May.
    const finMar = FIN_MAY.map((r) => ({ ...r, period: '2026-03' }));
    stub(finMar);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.hasData).toBe(true);
    expect(r.basis).toBe('actuals-annual');
    expect(r.statement.revPence).toBe(1500000);
  });

  it('org-level rows (null practice_id) → group statement, no per-entity', async () => {
    const orgLevel = [
      { practice_id: null, period: '2026-05', dental_bucket: 'revenue', amount_pence: 800000, source: 'xero' },
      { practice_id: null, period: '2026-05', dental_bucket: 'staff', amount_pence: 250000, source: 'xero' },
    ];
    stub(orgLevel);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.hasData).toBe(true);
    expect(r.statement.revPence).toBe(800000);
    expect(r.perEntityAvailable).toBe(false);
    expect(r.entities).toEqual([]);
  });

  it('no actuals → honest empty state (hasData false, basis none)', async () => {
    stub([]);
    const r = await svc.plMargin(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.hasData).toBe(false);
    expect(r.basis).toBe('none');
    expect(r.costsAvailable).toBe(false);
    expect(r.entities).toEqual([]);
  });
});
