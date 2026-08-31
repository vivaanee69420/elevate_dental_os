// Org-scoped queries only — the AGENCY org id scopes children; feature writes
// target one explicit child org id (validated by the service, not here).
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { agencyRepository } = await import('../src/repositories/agency.repository.js');

describe('agencyRepository', () => {
  beforeEach(() => { supaRec.resultProvider = () => ({ data: [], error: null }); });

  it('childOrgs filters organisations by parent_organisation_id', async () => {
    await agencyRepository.childOrgs('agency-1');
    expect(supaRec.last.table).toBe('organisations');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'parent_organisation_id', val: 'agency-1' }]));
  });

  it('orgIntegrations short-circuits on an empty id list', async () => {
    supaRec.last = undefined;
    expect(await agencyRepository.orgIntegrations([])).toEqual([]);
    expect(supaRec.last).toBeUndefined();
  });

  it('featureRows scopes org_features to one org', async () => {
    await agencyRepository.featureRows('sub-1');
    expect(supaRec.last.table).toBe('org_features');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'organisation_id', val: 'sub-1' }]));
  });

  it('upsertFeature writes an org-scoped override row', async () => {
    await agencyRepository.upsertFeature('sub-1', 'crm', false);
    expect(supaRec.last.table).toBe('org_features');
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals).toEqual(expect.objectContaining({ organisation_id: 'sub-1', feature: 'crm', enabled: false }));
    expect(supaRec.last.upsertOpts).toEqual({ onConflict: 'organisation_id,feature' });
  });

  it('setParent stamps parent_organisation_id on exactly one org', async () => {
    await agencyRepository.setParent('sub-1', 'agency-1');
    expect(supaRec.last.table).toBe('organisations');
    expect(supaRec.last.op).toBe('update');
    expect(supaRec.last.updateVals).toEqual({ parent_organisation_id: 'agency-1' });
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'id', val: 'sub-1' }]));
  });
});
