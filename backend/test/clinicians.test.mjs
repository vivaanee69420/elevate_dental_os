// ============================================================================
// clinicians service (Clinicians, GM Intelligence OS T2). Per-clinician
// production, pay splits and NHS/UDA from REAL data: associate roster +
// associate_production RPC (treatment_plans) + associate_appointment_stats +
// owner-entered NHS contract. Honest data walls — no revenue-share fabrication.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-clclclcl';
const now = () => new Date(Date.UTC(2026, 4, 15)); // 2026-05-15

const ROSTER = [
  { id: 'a1', full_name: 'Dr Rao', pay_pct: 4500, lab_split_pct: 5000, active: true, primary_practice_id: 'p1', specialty: 'Implant Lead', practice: { name: 'Rochester' } },
  { id: 'a2', full_name: 'Dr Singh', pay_pct: 4300, lab_split_pct: 5000, active: true, primary_practice_id: 'p2', specialty: null, practice: { name: 'Barnet' } },
];
const NHS = [
  { id: 'p1', name: 'Rochester', nhs_contract_uda: 5000, nhs_uda_rate_pence: 2850 },
  { id: 'p2', name: 'Barnet', nhs_contract_uda: 0, nhs_uda_rate_pence: 2850 },
];

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.rpcCalls = [];
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

function stub({ roster = ROSTER, prod = [], appts = [], nhs = NHS } = {}) {
  supaRec.resultProvider = (q) => {
    if (q.table === 'associates') return { data: roster, error: null };
    if (q.table === 'practices') return { data: nhs, error: null };
    return { data: [], error: null };
  };
  supaRec.rpcProvider = (fn) => {
    if (fn === 'associate_production') return { data: prod, error: null };
    if (fn === 'associate_appointment_stats') return { data: appts, error: null };
    return { data: [], error: null };
  };
}

describe('clinicians', () => {
  it('builds the roster with real production, fees and pay splits', async () => {
    stub({
      prod: [{ associate_id: 'a1', production_pence: 1000000 }, { associate_id: 'a2', production_pence: 600000 }],
      appts: [{ associate_id: 'a1', total: 50, completed: 45, no_shows: 3 }],
    });
    const r = await svc.clinicians(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });

    expect(r.applicable).toBe(true);
    expect(r.productionAvailable).toBe(true);
    expect(r.appointmentsAvailable).toBe(true);

    // Sorted by production desc → Dr Rao first.
    const a1 = r.clinicians[0];
    expect(a1).toMatchObject({ id: 'a1', name: 'Dr Rao', payPct: 45, labSplitPct: 50, productionPence: 1000000 });
    expect(a1.feesPence).toBe(450000);             // 45% of 1,000,000
    expect(a1.netToPracticePence).toBe(550000);
    expect(a1.appointments).toBe(50);
    expect(a1.role).toBe('Implant Lead');

    expect(r.totalProductionPence).toBe(1600000);
    expect(r.totalFeesPence).toBe(450000 + Math.round(600000 * 43 / 100));
  });

  it('NHS section uses real owner-entered contract; completed UDA flagged unavailable', async () => {
    stub({ prod: [{ associate_id: 'a1', production_pence: 1000000 }] });
    const r = await svc.clinicians(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.nhs.available).toBe(true);
    expect(r.nhs.completedAvailable).toBe(false);
    // Only p1 carries a contract (p2 has 0 UDA → filtered out).
    expect(r.nhs.practices.map((p) => p.id)).toEqual(['p1']);
    expect(r.nhs.practices[0]).toMatchObject({ contractUda: 5000, udaRatePence: 2850 });
  });

  it('no treatment_plans → productionAvailable false + honest insight, roster still listed', async () => {
    stub({ prod: [] });
    const r = await svc.clinicians(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.productionAvailable).toBe(false);
    expect(r.clinicians.length).toBe(2);
    expect(r.clinicians.every((c) => c.productionPence === 0)).toBe(true);
    expect(r.insights.some((i) => /Production £ not yet available/.test(i.title))).toBe(true);
  });

  it('entity scope narrows the roster to that practice', async () => {
    stub({ prod: [{ associate_id: 'a2', production_pence: 600000 }] });
    const r = await svc.clinicians(ORG, { scope: 'p2', period: 'month', periodKey: '2026-05', now });
    expect(r.clinicians.map((c) => c.id)).toEqual(['a2']);
  });

  it('academy/lab scope → not applicable', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'practices' ? { data: [{ id: 'ac', name: 'Academy', kind: 'academy' }], error: null } : { data: [], error: null };
    const r = await svc.clinicians(ORG, { scope: 'academy', now });
    expect(r.applicable).toBe(false);
    expect(r.scope).toBe('academy');
  });

  it('production RPC receives the period window', async () => {
    stub({ prod: [{ associate_id: 'a1', production_pence: 1000000 }] });
    await svc.clinicians(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    const call = supaRec.rpcCalls.find((c) => c.fn === 'associate_production');
    expect(call.params.p_start).toBe('2026-05-01T00:00:00.000Z');
    expect(call.params.p_end).toBe('2026-06-01T00:00:00.000Z');
  });
});
