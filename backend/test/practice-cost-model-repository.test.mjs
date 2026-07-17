// practice_cost_model data access — the as-of read (latest model in force at a
// date) and the historised upsert. Verifies org-scoping, since serviceClient
// bypasses RLS and the .eq('organisation_id') filter is the only isolation.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { practiceCostModelRepository } = await import('../src/repositories/practice-cost-model.repository.js');

beforeEach(() => {
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('practiceCostModelRepository.asOf', () => {
  it('filters by organisation_id — serviceClient has no automatic isolation', async () => {
    await practiceCostModelRepository.asOf('ORG1', '2026-07-01');
    expect(supaRec.last.table).toBe('practice_cost_model');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: 'ORG1' });
  });

  it('bounds effective_from with lte so a future model never leaks into a past window', async () => {
    await practiceCostModelRepository.asOf('ORG1', '2026-03-31');
    expect(supaRec.last.ltes).toContainEqual({ col: 'effective_from', val: '2026-03-31' });
    expect(supaRec.last.order).toEqual({ col: 'effective_from', opts: { ascending: false } });
  });

  it('keeps only the latest effective_from per practice', async () => {
    supaRec.resultProvider = () => ({
      data: [
        // Newest-first, as the real ordered query returns them.
        { practice_id: 'P1', effective_from: '2026-07-01', fixed_cost_pence_month: 3300000, working_days_per_month: 20 },
        { practice_id: 'P1', effective_from: '2026-01-01', fixed_cost_pence_month: 3100000, working_days_per_month: 20 },
        { practice_id: 'P2', effective_from: '2026-03-01', fixed_cost_pence_month: 2000000, working_days_per_month: 22 },
      ],
      error: null,
    });
    const rows = await practiceCostModelRepository.asOf('ORG1', '2026-07-15');
    expect(rows).toHaveLength(2);
    // July's model wins over January's — a rent rise must not rewrite the past,
    // but it must apply to the present.
    expect(rows.find((r) => r.practice_id === 'P1').fixed_cost_pence_month).toBe(3300000);
    expect(rows.find((r) => r.practice_id === 'P2').working_days_per_month).toBe(22);
  });

  it('throws with the table name when the query errors', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(practiceCostModelRepository.asOf('ORG1', '2026-07-01')).rejects.toThrow(/practice_cost_model asOf: boom/);
  });
});

describe('practiceCostModelRepository.upsert', () => {
  it('upserts on practice_id,effective_from so two edits in one day update one row', async () => {
    let captured;
    // .upsert(...).select().single() flips q.op to 'select' before settle, so
    // key off the recorded upsertVals rather than q.op.
    supaRec.resultProvider = (q) => {
      if (q.upsertVals !== undefined) captured = q;
      return { data: { practice_id: 'P1' }, error: null };
    };
    await practiceCostModelRepository.upsert('ORG1', 'P1', '2026-07-17', { fixed_cost_pence_month: 3100000 });

    expect(captured.table).toBe('practice_cost_model');
    expect(captured.upsertOpts).toEqual({ onConflict: 'practice_id,effective_from' });
    expect(captured.upsertVals).toEqual({
      organisation_id: 'ORG1',
      practice_id: 'P1',
      effective_from: '2026-07-17',
      fixed_cost_pence_month: 3100000,
    });
  });

  it('stamps organisation_id on every written row', async () => {
    let captured;
    supaRec.resultProvider = (q) => {
      if (q.upsertVals !== undefined) captured = q;
      return { data: {}, error: null };
    };
    await practiceCostModelRepository.upsert('ORG1', 'P1', '2026-07-17', { revenue_target_pence_month: 40000000 });
    expect(captured.upsertVals.organisation_id).toBe('ORG1');
  });
});
