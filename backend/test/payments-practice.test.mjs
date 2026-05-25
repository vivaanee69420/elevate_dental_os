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

  it('summary adds practice_id eq when provided', async () => {
    await repo.summary(ORG_A, PRACTICE_1);
    expect(supaRec.last.table).toBe('payments');
    expect(supaRec.last.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE_1 });
  });

  it('summary omits practice_id eq when absent', async () => {
    await repo.summary(ORG_A);
    expect(supaRec.last.eqs.some((e) => e.col === 'practice_id')).toBe(false);
  });
});
