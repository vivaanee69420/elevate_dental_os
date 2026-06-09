// Period-keyed AI context snapshot cache repo. Asserts every method scopes by
// organisation_id (manual tenant isolation — repos use serviceClient) and that
// markDirty targets the listed periods via an IN filter.
//
// NOTE: the shared recorder in test/setup.js records .eq() as { col, val }
// objects on q.eqs and .in() as { col, vals } objects on q.ins (the format the
// rest of the suite relies on). These assertions match that real recorder
// shape rather than the [field, value] / inField-inVals shape some plan drafts
// assume — setup.js is left unchanged so existing tests stay green.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { aiContextSnapshotRepository } = await import('../src/repositories/ai-context-snapshot.repository.js');

beforeEach(() => { supaRec.resultProvider = () => ({ data: null, error: null }); });

describe('get', () => {
  it('reads one row scoped by org + period_key', async () => {
    supaRec.resultProvider = () => ({ data: { organisation_id: 'org-1', period_key: '2026-06' }, error: null });
    const row = await aiContextSnapshotRepository.get('org-1', '2026-06');
    expect(supaRec.last.table).toBe('ai_context_snapshots');
    expect(supaRec.last.eqs).toEqual(
      expect.arrayContaining([
        { col: 'organisation_id', val: 'org-1' },
        { col: 'period_key', val: '2026-06' },
      ]),
    );
    expect(row.period_key).toBe('2026-06');
  });
  it('returns null when absent', async () => {
    expect(await aiContextSnapshotRepository.get('org-1', '2099-01')).toBeNull();
  });
});

describe('upsert', () => {
  it('writes the row with org + period + snapshot + is_final', async () => {
    let captured;
    supaRec.resultProvider = (q) => { if (q.upsertVals) captured = q; return { data: [], error: null }; };
    await aiContextSnapshotRepository.upsert('org-1', '2026-06', { pl: null }, false);
    expect(captured.table).toBe('ai_context_snapshots');
    expect(captured.upsertVals).toMatchObject({
      organisation_id: 'org-1', period_key: '2026-06', snapshot: { pl: null }, is_final: false,
    });
    expect(captured.upsertOpts).toMatchObject({ onConflict: 'organisation_id,period_key' });
  });
});

describe('markDirty', () => {
  it('updates computed_at to epoch and un-finalizes touched periods', async () => {
    let captured;
    supaRec.resultProvider = (q) => { if (q.op === 'update') captured = q; return { data: [], error: null }; };
    await aiContextSnapshotRepository.markDirty('org-1', ['2026-05', '2026-06']);
    expect(captured.table).toBe('ai_context_snapshots');
    expect(captured.updateVals).toMatchObject({ is_final: false });
    expect(new Date(captured.updateVals.computed_at).getTime()).toBe(0);
    expect(captured.eqs).toEqual(
      expect.arrayContaining([{ col: 'organisation_id', val: 'org-1' }]),
    );
    expect(captured.ins).toEqual([{ col: 'period_key', vals: ['2026-05', '2026-06'] }]);
  });

  it('no-ops on an empty period list', async () => {
    let touched = false;
    supaRec.resultProvider = (q) => { if (q.op === 'update') touched = true; return { data: [], error: null }; };
    await aiContextSnapshotRepository.markDirty('org-1', []);
    expect(touched).toBe(false);
  });
});

describe('finalize', () => {
  it('sets is_final true scoped by org + period_key', async () => {
    let captured;
    supaRec.resultProvider = (q) => { if (q.op === 'update') captured = q; return { data: [], error: null }; };
    await aiContextSnapshotRepository.finalize('org-1', '2026-06');
    expect(captured.table).toBe('ai_context_snapshots');
    expect(captured.updateVals).toMatchObject({ is_final: true });
    expect(captured.eqs).toEqual(
      expect.arrayContaining([
        { col: 'organisation_id', val: 'org-1' },
        { col: 'period_key', val: '2026-06' },
      ]),
    );
  });
});
