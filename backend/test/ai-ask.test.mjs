// ============================================================================
// aiAsk service (AI Analyst, GM Intelligence OS). £-ranked findings aggregated
// from the REAL P&L / Marketing / Clinicians / Cash rollups for the scope+period,
// plus a natural-language answer when a question is asked (Claude). With no
// ANTHROPIC_API_KEY the question path falls back to keyword-matched findings —
// the Ask box still works. No fabrication.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-aiaiaiai';
const now = () => new Date(Date.UTC(2026, 4, 15)); // 2026-05-15

const PRACTICES = [{ id: 'p1', name: 'Rochester', kind: 'practice', chairs: 6, assumed_util_pct: 84, nhs_contract_uda: 0, nhs_uda_rate_pence: 2850 }];
const FIN = [
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 1000000, source: 'xero' },
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'staff', amount_pence: 300000, source: 'xero' },
];
const ASSOCIATES = [{ id: 'a1', full_name: 'Dr Rao', pay_pct: 4500, lab_split_pct: 5000, active: true, primary_practice_id: 'p1', specialty: 'Implant Lead', practice: { name: 'Rochester' } }];

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.rpcCalls = [];
  supaRec.resultProvider = (q) => {
    if (q.table === 'monthly_financials') return { data: FIN, error: null };
    if (q.table === 'associates') return { data: ASSOCIATES, error: null };
    if (q.table === 'practices') return { data: PRACTICES, error: null };
    return { data: [], error: null }; // ad_metrics, leads → empty
  };
  supaRec.rpcProvider = (fn) => {
    if (fn === 'settled_receipts_by_day') return { data: [{ day: '2026-05-04', pence: 250000 }], error: null };
    if (fn === 'settled_revenue_by_practice') return { data: [{ practice_id: 'p1', pence: 1500000 }], error: null };
    return { data: [], error: null }; // associate_production, associate_appointment_stats → empty
  };
});

describe('aiAsk', () => {
  it('no question → prioritised real findings, no Claude call', async () => {
    const r = await svc.aiAsk(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.answer).toBe(null);
    expect(r.basis).toBe('rollups');
    expect(r.findings.length).toBeGreaterThan(0);
    // Every finding has the Insight shape the screen renders.
    for (const f of r.findings) {
      expect(f).toHaveProperty('sev');
      expect(f).toHaveProperty('t');
      expect(f).toHaveProperty('d');
      expect(['good', 'warn', 'bad', 'info']).toContain(f.sev);
    }
    // Real headline fact: group net margin from monthly_financials (1,000,000 rev / 700,000 net = 70%).
    expect(r.findings.some((f) => /Group net margin/.test(f.t))).toBe(true);

    // Verify practice breakdown
    expect(r.practiceBreakdown).toBeDefined();
    expect(r.practiceBreakdown.length).toBe(1);
    const pb = r.practiceBreakdown[0];
    expect(pb.name).toBe('Rochester');
    expect(pb.cashPence).toBe(1500000);
    expect(pb.productionPence).toBe(0);
    expect(pb.revPence).toBe(1000000);
    expect(pb.netPence).toBe(700000);
    expect(pb.marginPct).toBe(70);
  });

  it('findings are ranked bad/warn before info and capped at 8', async () => {
    const r = await svc.aiAsk(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', now });
    expect(r.findings.length).toBeLessThanOrEqual(8);
    const rank = { bad: 0, warn: 1, good: 2, info: 3 };
    const ranks = r.findings.map((f) => rank[f.sev]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('with a question and no model key → graceful fallback with matched findings', async () => {
    const r = await svc.aiAsk(ORG, { scope: 'all', period: 'month', periodKey: '2026-05', question: 'how is our margin?', now });
    expect(r.question).toBe('how is our margin?');
    // No ANTHROPIC_API_KEY in test → fallback (basis rollups, note present, answer null).
    expect(r.basis).toBe('rollups');
    expect(r.answer).toBe(null);
    expect(Array.isArray(r.answerFindings)).toBe(true);
    expect(r.note).toMatch(/AI answer unavailable/);
  });

  it('scope is honoured (entity narrows the underlying rollups)', async () => {
    const r = await svc.aiAsk(ORG, { scope: 'p1', period: 'month', periodKey: '2026-05', now });
    expect(r.scope).toBe('p1');
    expect(r.findings.length).toBeGreaterThan(0);
  });
});
