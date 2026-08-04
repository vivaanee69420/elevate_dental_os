// Sheet repository (Call Reporting) — tenant isolation (rule 3: explicit
// organisation_id on EVERY query), upsert conflict targets, practice-map
// discovery semantics, and RPC params for the dashboard + restamp.
import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-000000000002';
const SOURCE = '00000000-0000-0000-0000-0000000000aa';
const PRACTICE = '00000000-0000-0000-0000-0000000000bb';

let repo;
beforeEach(async () => {
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcCalls = [];
  supaRec.rpcProvider = null;
  ({ sheetRepository: repo } = await import('../src/repositories/sheet.repository.js'));
});

describe('sheet_sources', () => {
  it('getSource filters by organisation_id (rule 3)', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await repo.getSource(ORG);
    expect(supaRec.last.table).toBe('sheet_sources');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
  });
  it('createSource upserts on organisation_id (one source per org)', async () => {
    supaRec.resultProvider = () => ({ data: { id: SOURCE }, error: null });
    await repo.createSource(ORG, { spreadsheet_id: 'abc123', title: 'T' });
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG);
    expect(supaRec.last.upsertVals.status).toBe('pending');
  });
  it('updateSource + deleteSource scope to the org', async () => {
    await repo.updateSource(ORG, { status: 'active' });
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    await repo.deleteSource(ORG);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
  });
});

describe('sheet_practice_map', () => {
  it('discover never clobbers existing mappings (ignoreDuplicates)', async () => {
    await repo.discoverPracticeValues(ORG, ['Rochester', 'rochester ', 'Gillingham', '']);
    expect(supaRec.last.table).toBe('sheet_practice_map');
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,sheet_value');
    expect(supaRec.last.upsertOpts.ignoreDuplicates).toBe(true);
    // dedup is case-insensitive and blanks are dropped
    expect(supaRec.last.upsertVals).toHaveLength(2);
    expect(supaRec.last.upsertVals.every((r) => r.organisation_id === ORG)).toBe(true);
  });
  it('setPracticeMapping upserts the trimmed value for the org', async () => {
    await repo.setPracticeMapping(ORG, '  Rochester ', PRACTICE);
    expect(supaRec.last.upsertVals.sheet_value).toBe('Rochester');
    expect(supaRec.last.upsertVals.practice_id).toBe(PRACTICE);
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG);
  });
  it('practiceResolutionMap keys on lower(trim())', async () => {
    supaRec.resultProvider = () => ({
      data: [{ sheet_value: ' Rochester ', practice_id: PRACTICE }, { sheet_value: 'Academy', practice_id: null }],
      error: null,
    });
    const map = await repo.practiceResolutionMap(ORG);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(map.get('rochester')).toBe(PRACTICE);
    expect(map.has('academy')).toBe(true);   // explicit unmapped row is present
    expect(map.get('academy')).toBeNull();
  });
});

describe('sheet_leads', () => {
  it('leadHashesBySource scopes to org + source (rule 3)', async () => {
    supaRec.resultProvider = () => ({ data: [{ sheet_row_index: 2, row_hash: 'h' }], error: null });
    const map = await repo.leadHashesBySource(ORG, SOURCE);
    expect(supaRec.last.table).toBe('sheet_leads');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'source_id', val: SOURCE });
    expect(map.get(2)).toBe('h');
  });
  it('upsertLeads targets (source_id, sheet_row_index) and stamps the org', async () => {
    await repo.upsertLeads(ORG, SOURCE, [{
      sheet_row_index: 2, row_hash: 'h', created_at: '2026-08-01T08:00:00.000Z',
      practice_id: PRACTICE, practice_value: 'Rochester',
    }]);
    expect(supaRec.last.upsertOpts.onConflict).toBe('source_id,sheet_row_index');
    expect(supaRec.last.upsertVals[0].organisation_id).toBe(ORG);
    expect(supaRec.last.upsertVals[0].source_id).toBe(SOURCE);
  });
  it('deleteAllLeads deletes ONLY the given org (cross-org isolation)', async () => {
    await repo.deleteAllLeads(ORG);
    expect(supaRec.last.table).toBe('sheet_leads');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).not.toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
  });
});

describe('aggregates (RPC)', () => {
  it('dashboard calls sheet_leads_dashboard with org/date/practice/tz', async () => {
    supaRec.rpcProvider = () => ({ data: [{ total: 14, called_3m: 2 }], error: null });
    const row = await repo.dashboard(ORG, { date: '2026-08-01', practiceId: PRACTICE });
    const call = supaRec.rpcCalls.at(-1);
    expect(call.fn).toBe('sheet_leads_dashboard');
    expect(call.params).toMatchObject({ p_org: ORG, p_date: '2026-08-01', p_practice: PRACTICE, p_tz: 'Europe/London' });
    expect(row.total).toBe(14);
  });
  it('restampPractices calls the restamp RPC bound to the org', async () => {
    supaRec.rpcProvider = () => ({ data: 5, error: null });
    const n = await repo.restampPractices(ORG);
    const call = supaRec.rpcCalls.at(-1);
    expect(call.fn).toBe('restamp_sheet_lead_practices');
    expect(call.params).toEqual({ p_org: ORG });
    expect(n).toBe(5);
  });
});
