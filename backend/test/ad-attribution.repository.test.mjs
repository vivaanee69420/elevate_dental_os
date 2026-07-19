import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { adAttributionRepository } from '../src/repositories/ad-attribution.repository.js';

const ORG = 'org-aaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('ghlAccounts', () => {
  it('scopes by org and provider, and flattens config.pipelines', async () => {
    supaRec.resultProvider = () => ({
      data: [{
        id: 'acc1', label: 'Ashford', external_account_id: 'LOC1',
        practice_id: 'p1', status: 'active',
        config: { pipelines: [{ id: 'pl1', name: 'Open Day' }] },
      }],
      error: null,
    });
    const rows = await adAttributionRepository.ghlAccounts(ORG);
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'provider', val: 'gohighlevel' });
    expect(rows[0].pipelines).toEqual([{ id: 'pl1', name: 'Open Day' }]);
  });

  it('yields an empty pipeline list when config has none', async () => {
    supaRec.resultProvider = () => ({
      data: [{ id: 'acc1', label: 'X', config: null }], error: null,
    });
    const rows = await adAttributionRepository.ghlAccounts(ORG);
    expect(rows[0].pipelines).toEqual([]);
  });
});

describe('setAdAccountPractice', () => {
  it('updates ad_accounts scoped by org AND id', async () => {
    await adAttributionRepository.setAdAccountPractice(ORG, 'ad1', 'p1');
    expect(supaRec.last.table).toBe('ad_accounts');
    expect(supaRec.last.op).toBe('update');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'id', val: 'ad1' });
  });
});

describe('adSpend', () => {
  it('scopes by org and the date window', async () => {
    await adAttributionRepository.adSpend(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.table).toBe('ad_metrics');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
  });
});
