import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const ORG = '00000000-0000-0000-0000-000000000001';
let cashupRepo, plRepo;
beforeEach(async () => {
  supaRec.resultProvider = () => ({ data: [{ id: 'x' }], error: null });
  ({ emergentDailyCashupRepository: cashupRepo } = await import('../src/repositories/emergent-daily-cashup.repository.js'));
  ({ emergentMonthlyPlRepository: plRepo } = await import('../src/repositories/emergent-monthly-pl.repository.js'));
});

describe('emergent daily cash-up repo', () => {
  it('upserts on (organisation_id, business_id, cashup_date)', async () => {
    supaRec.resultProvider = () => ({ data: { id: 'x' }, error: null });
    await cashupRepo.upsert({ organisation_id: ORG, business_id: 'b', cashup_date: '2026-08-20' });
    expect(supaRec.last.table).toBe('emergent_daily_cashup');
    expect(supaRec.last.upsertVals).toBeDefined();
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,business_id,cashup_date');
  });
  it('listByOrg filters by organisation_id (rule 3)', async () => {
    await cashupRepo.listByOrg(ORG, { since: '2026-08-01', until: '2026-08-31' });
    expect(supaRec.last.table).toBe('emergent_daily_cashup');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
  });
});

describe('emergent monthly P&L repo', () => {
  it('upserts on (organisation_id, business_id, period_month)', async () => {
    supaRec.resultProvider = () => ({ data: { id: 'x' }, error: null });
    await plRepo.upsert({ organisation_id: ORG, business_id: 'b', period_month: '2026-08-01' });
    expect(supaRec.last.table).toBe('emergent_monthly_pl');
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,business_id,period_month');
  });
  it('listByOrg filters by organisation_id (rule 3)', async () => {
    await plRepo.listByOrg(ORG, {});
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
  });
});
