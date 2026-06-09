// backend/test/ai-assemble-window.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const PRACTICES = [{ id: 'p1', name: 'Rochester', kind: 'practice', chairs: 6, assumed_util_pct: 84, nhs_contract_uda: 0, nhs_uda_rate_pence: 2850 }];
const FIN = [
  { practice_id: 'p1', period: '2026-03', dental_bucket: 'revenue', amount_pence: 500000, source: 'xero' },
  { practice_id: 'p1', period: '2026-05', dental_bucket: 'revenue', amount_pence: 900000, source: 'xero' },
];

beforeEach(() => {
  supaRec.last = undefined; supaRec.rpcCalls = [];
  supaRec.resultProvider = (q) => {
    if (q.table === 'monthly_financials') return { data: FIN, error: null };
    if (q.table === 'practices') return { data: PRACTICES, error: null };
    return { data: [], error: null };
  };
  supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('assembleLiveContext window/scope', () => {
  it('accepts a legacy period string (back-compat)', async () => {
    const out = await svc.assembleLiveContext('org-1', '2026-05');
    expect(out).toHaveProperty('pl');
    expect(out).toHaveProperty('practices');
  });
  it('accepts an options object with period', async () => {
    const out = await svc.assembleLiveContext('org-1', { period: '2026-03' });
    expect(out).toHaveProperty('pl');
  });
  it('accepts an explicit since/until window', async () => {
    const out = await svc.assembleLiveContext('org-1', { since: '2026-03-01', until: '2026-06-01' });
    expect(out).toHaveProperty('pl');
    expect(out).toHaveProperty('practices');
  });
});
