import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const repo = (await import('../src/repositories/debt.repository.js')).debtRepository;
const ORG_A = 'org-aaaaaaaa';
const PRACTICE_1 = 'prac-11111111';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('debt repository — listUnpaid', () => {
  it('queries invoices scoped to the org with outstanding > 0', async () => {
    await repo.listUnpaid(ORG_A, {});
    expect(supaRec.last.table).toBe('invoices');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG_A });
    expect(supaRec.last.gtes).toContainEqual({ col: 'amount_outstanding_pence', val: 1 });
  });

  it('adds practice_id eq when provided', async () => {
    await repo.listUnpaid(ORG_A, { practiceId: PRACTICE_1 });
    expect(supaRec.last.eqs).toContainEqual({ col: 'practice_id', val: PRACTICE_1 });
  });

  it('omits practice_id eq when absent', async () => {
    await repo.listUnpaid(ORG_A, {});
    expect(supaRec.last.eqs.some((e) => e.col === 'practice_id')).toBe(false);
  });
});
