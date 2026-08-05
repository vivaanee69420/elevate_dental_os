// Sheet repository (Call Reporting v2) — tenant isolation (rule 3: explicit
// organisation_id on EVERY query), per-source scoping, upsert conflict
// targets, and RPC params for the 10-card dashboard.
import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-000000000002';
const SOURCE = '00000000-0000-0000-0000-0000000000aa';

let repo;
beforeEach(async () => {
  supaRec.resultProvider = () => ({ data: [], error: null });
  supaRec.rpcCalls = [];
  supaRec.rpcProvider = null;
  ({ sheetRepository: repo } = await import('../src/repositories/sheet.repository.js'));
});

describe('sheet_sources', () => {
  it('listSources + getSourceById filter by organisation_id (rule 3)', async () => {
    await repo.listSources(ORG);
    expect(supaRec.last.table).toBe('sheet_sources');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    supaRec.resultProvider = () => ({ data: null, error: null });
    await repo.getSourceById(ORG, SOURCE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: SOURCE });
  });
  it('createSource upserts on (organisation_id, spreadsheet_id) with the label', async () => {
    supaRec.resultProvider = () => ({ data: { id: SOURCE }, error: null });
    await repo.createSource(ORG, { spreadsheet_id: 'abc123', title: 'T', practice_label: 'Barnet' });
    expect(supaRec.last.upsertOpts.onConflict).toBe('organisation_id,spreadsheet_id');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG);
    expect(supaRec.last.upsertVals.practice_label).toBe('Barnet');
    expect(supaRec.last.upsertVals.status).toBe('pending');
  });
  it('updateSource + deleteSource scope to org AND source id', async () => {
    await repo.updateSource(ORG, SOURCE, { status: 'active' });
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: SOURCE });
    await repo.deleteSource(ORG, SOURCE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: SOURCE });
  });
  it('deleteAllSources deletes ONLY the given org', async () => {
    await repo.deleteAllSources(ORG);
    expect(supaRec.last.table).toBe('sheet_sources');
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).not.toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
  });
});

describe('sheet_leads', () => {
  it('leadHashesBySource scopes to org + source (rule 3)', async () => {
    supaRec.resultProvider = () => ({ data: [{ sheet_row_index: 2, row_hash: 'h' }], error: null });
    const map = await repo.leadHashesBySource(ORG, SOURCE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'source_id', val: SOURCE });
    expect(map.get(2)).toBe('h');
  });
  it('upsertLeads targets (source_id, sheet_row_index) and stores the v2 fields only', async () => {
    await repo.upsertLeads(ORG, SOURCE, [{
      sheet_row_index: 2, row_hash: 'h', created_at: '2026-08-01T08:00:00.000Z',
      called_3m: true, called_10m: false, pipeline_name: 'Facebook Ads',
    }]);
    expect(supaRec.last.upsertOpts.onConflict).toBe('source_id,sheet_row_index');
    const row = supaRec.last.upsertVals[0];
    expect(row.organisation_id).toBe(ORG);
    expect(row.source_id).toBe(SOURCE);
    expect(row.called_3m).toBe(true);
    expect(row.called_10m).toBe(false);
    expect(row.pipeline_name).toBe('Facebook Ads');
    expect(row).not.toHaveProperty('practice_id');
    expect(row).not.toHaveProperty('first_call_at');
    expect(row).not.toHaveProperty('lead_source');
  });
  it('deleteLeadsBySource + deleteAllLeads scope to the org (cross-org isolation)', async () => {
    await repo.deleteLeadsBySource(ORG, SOURCE);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'source_id', val: SOURCE });
    await repo.deleteAllLeads(ORG);
    expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).not.toContainEqual({ col: 'organisation_id', val: OTHER_ORG });
  });
});

describe('aggregates (RPC)', () => {
  it('dashboard calls sheet_leads_dashboard with org/date/source/tz', async () => {
    supaRec.rpcProvider = () => ({ data: [{ total: 6, called_3m: 2, office_time: 3 }], error: null });
    const row = await repo.dashboard(ORG, { date: '2026-07-31', sourceId: SOURCE });
    const call = supaRec.rpcCalls.at(-1);
    expect(call.fn).toBe('sheet_leads_dashboard');
    expect(call.params).toMatchObject({ p_org: ORG, p_date: '2026-07-31', p_source: SOURCE, p_tz: 'Europe/London' });
    expect(row.total).toBe(6);
    expect(row.office_time).toBe(3);
  });
  it('dashboard passes p_source null for the all-practices view', async () => {
    supaRec.rpcProvider = () => ({ data: [{ total: 0 }], error: null });
    await repo.dashboard(ORG, { date: '2026-07-31' });
    expect(supaRec.rpcCalls.at(-1).params.p_source).toBeNull();
  });
});
