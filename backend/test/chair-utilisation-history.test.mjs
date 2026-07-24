// ============================================================================
// Chair-utilisation history (000055): any change snapshots the practice's full
// grid; an as-of read replays the grid as it was on a past date.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/chair-utilisation.service.js')).chairUtilisationService;
const ORG = 'org-chist-1';

describe('chair history capture on change', () => {
  let snapWrites;
  beforeEach(() => {
    snapWrites = [];
    supaRec.last = undefined;
    supaRec.resultProvider = (q) => {
      if (q.table === 'chair_utilisation_snapshots') {
        if (q.op === 'select') return { data: null, error: null };          // no row yet -> insert
        if (q.op === 'insert') { snapWrites.push(q.insertVals); return { data: q.insertVals, error: null }; }
        return { data: null, error: null };
      }
      if (q.table === 'chair_utilisation') {
        // .select() after .update() flips q.op to 'select'; the update chain is
        // the one carrying updateVals.
        if (q.updateVals) return { data: { id: 'cell-1', practice_id: 'prac-9' }, error: null };
        if (q.op === 'select') return { data: [
          { chair_name: 'S1', weekday: 1, slot: 'morning', booked_minutes: 90, available_minutes: 180, revenue_pence: 45000 },
        ], error: null };
      }
      return { data: [], error: null };
    };
  });

  it('update() snapshots the practice grid for today', async () => {
    await svc.update(ORG, 'cell-1', { booked_minutes: 90 });
    expect(snapWrites.length).toBe(1);
    expect(snapWrites[0].organisation_id).toBe(ORG);
    expect(snapWrites[0].practice_id).toBe('prac-9');
    // revenue_pence carries into the snapshot — it drives yield/hr on the
    // Chair Efficiency grid, so a snapshot without it replays a £0 past.
    expect(snapWrites[0].cells).toEqual([
      { chair_name: 'S1', weekday: 1, slot: 'morning', booked_minutes: 90, available_minutes: 180, revenue_pence: 45000 },
    ]);
  });
});

describe('chair grid as-of read', () => {
  beforeEach(() => { supaRec.last = undefined; });

  it('asOf + practice replays the historical snapshot instead of the live grid', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'chair_utilisation_snapshots' && q.op === 'select') {
        return { data: { cells: [
          { weekday: 1, slot: 'morning', booked_minutes: 45, available_minutes: 180 },
        ] }, error: null };
      }
      // Live grid would be 50% — prove we did NOT read it.
      if (q.table === 'chair_utilisation') return { data: [
        { weekday: 1, slot: 'morning', booked_minutes: 90, available_minutes: 180 },
      ], error: null };
      return { data: [], error: null };
    };
    const out = await svc.grid(ORG, 'prac-9', { asOf: '2026-03-31' });
    expect(out.grid[0][0].pct).toBe(25);          // 45/180 historical, not live 50
    expect(supaRec.last.table).toBe('chair_utilisation_snapshots');
  });

  it('asOf without practice falls back to the live grid', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'chair_utilisation'
        ? { data: [{ weekday: 1, slot: 'morning', booked_minutes: 90, available_minutes: 180 }], error: null }
        : { data: [], error: null };
    const out = await svc.grid(ORG, undefined, { asOf: '2026-03-31' });
    expect(out.grid[0][0].pct).toBe(50);
    expect(supaRec.last.table).toBe('chair_utilisation');
  });
});
