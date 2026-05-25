import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const repo = (await import('../src/repositories/payment.repository.js')).paymentRepository;
const ORG_A = 'org-aaaaaaaa';
const PRACTICE_1 = 'prac-11111111';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null, count: 0 });
});

describe('payment repository — practice filter', () => {
  it('list adds practice_id eq when provided', async () => {
    await repo.list(ORG_A, { practice_id: PRACTICE_1 });
    expect(supaRec.last.table).toBe('payments');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG_A });
    expect(supaRec.last.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE_1 });
  });

  it('list omits practice_id eq when absent', async () => {
    await repo.list(ORG_A, {});
    expect(supaRec.last.eqs.some((e) => e.col === 'practice_id')).toBe(false);
  });

  it('list filters by processed_at (the real payment date), not created_at', async () => {
    await repo.list(ORG_A, { status: 'pending', since: '2026-01-01', until: '2026-03-31' });
    expect(supaRec.last.eqs).toContainEqual({ col: 'status', val: 'pending' });
    expect(supaRec.last.gtes).toContainEqual({ col: 'processed_at', val: '2026-01-01' });
    expect(supaRec.last.ltes).toContainEqual({ col: 'processed_at', val: '2026-03-31' });
  });

  it('summary calls the payment_summary RPC with practice + date range', async () => {
    supaRec.rpcProvider = (fn) =>
      fn === 'payment_summary'
        ? { data: [{ received_pence: 5000, outstanding_pence: 1000, refunded_pence: 0, txn_count: 3 }], error: null }
        : { data: null, error: { message: 'x' } };
    supaRec.rpcCalls = [];
    const out = await repo.summary(ORG_A, { practiceId: PRACTICE_1, since: '2026-01-01', until: '2026-03-31' });
    expect(out).toEqual({ received: 5000, outstanding: 1000, refunded: 0, count: 3 });
    const call = supaRec.rpcCalls.find((c) => c.fn === 'payment_summary');
    expect(call.params).toMatchObject({ p_org: ORG_A, p_practice: PRACTICE_1, p_since: '2026-01-01', p_until: '2026-03-31' });
  });

  it('summary passes nulls when no filters', async () => {
    supaRec.rpcProvider = () => ({ data: [{ received_pence: 0, outstanding_pence: 0, refunded_pence: 0, txn_count: 0 }], error: null });
    supaRec.rpcCalls = [];
    await repo.summary(ORG_A);
    const call = supaRec.rpcCalls.find((c) => c.fn === 'payment_summary');
    expect(call.params).toMatchObject({ p_org: ORG_A, p_practice: null, p_since: null, p_until: null });
  });
});
