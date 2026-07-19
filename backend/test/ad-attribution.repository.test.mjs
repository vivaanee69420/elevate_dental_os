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
    expect(supaRec.last.gtes).toContainEqual({ col: 'metric_date', val: '2026-07-01' });
    expect(supaRec.last.lts).toContainEqual({ col: 'metric_date', val: '2026-08-01' });
  });

  it('orders by id (required for deterministic pagination)', async () => {
    await adAttributionRepository.adSpend(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.order).toEqual({ col: 'id', opts: { ascending: true } });
  });
});

describe('practiceOptions', () => {
  it('scopes by org, orders by name, and maps to {id, name}', async () => {
    supaRec.resultProvider = () => ({
      data: [{ id: 'p2', name: 'Bexleyheath' }, { id: 'p1', name: 'Ashford' }],
      error: null,
    });
    const rows = await adAttributionRepository.practiceOptions(ORG);
    expect(supaRec.last.table).toBe('practices');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(rows).toEqual([{ id: 'p2', name: 'Bexleyheath' }, { id: 'p1', name: 'Ashford' }]);
  });
});

describe('adAccounts', () => {
  it('scopes by org and returns the raw rows', async () => {
    supaRec.resultProvider = () => ({
      data: [{ id: 'a1', provider: 'google', customer_id: 'c1', name: 'Acc1', practice_id: 'p1' }],
      error: null,
    });
    const rows = await adAttributionRepository.adAccounts(ORG);
    expect(supaRec.last.table).toBe('ad_accounts');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(rows).toEqual([{ id: 'a1', provider: 'google', customer_id: 'c1', name: 'Acc1', practice_id: 'p1' }]);
  });
});

describe('leadsInWindow', () => {
  it('scopes by org, selects the matcher fields, and windows half-open', async () => {
    await adAttributionRepository.leadsInWindow(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.table).toBe('leads');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.gtes).toContainEqual({ col: 'created_at', val: '2026-07-01' });
    expect(supaRec.last.lts).toContainEqual({ col: 'created_at', val: '2026-08-01' });
    const selectStr = supaRec.last.selectArgs.join(' ');
    for (const field of ['phone', 'email', 'first_name', 'last_name']) {
      expect(selectStr).toContain(field);
    }
  });

  it('orders by id (required for deterministic pagination)', async () => {
    await adAttributionRepository.leadsInWindow(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.order).toEqual({ col: 'id', opts: { ascending: true } });
  });
});

describe('acceptedForMatching', () => {
  it('scopes by org and the accepted-date window', async () => {
    await adAttributionRepository.acceptedForMatching(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.table).toBe('treatment_accepted');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.gtes).toContainEqual({ col: 'accepted_date', val: '2026-07-01' });
    expect(supaRec.last.lts).toContainEqual({ col: 'accepted_date', val: '2026-08-01' });
  });

  it('orders by id (required for deterministic pagination)', async () => {
    await adAttributionRepository.acceptedForMatching(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.order).toEqual({ col: 'id', opts: { ascending: true } });
  });
});

describe('leadCountsByPipeline', () => {
  it('aggregates counts by composite accountId|pipelineId key', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { id: 'l1', integration_account_id: 'acc1', ghl_pipeline_id: 'pl1' },
        { id: 'l2', integration_account_id: 'acc1', ghl_pipeline_id: 'pl1' },
        { id: 'l3', integration_account_id: 'acc1', ghl_pipeline_id: 'pl2' },
        { id: 'l4', integration_account_id: 'acc2', ghl_pipeline_id: 'pl1' },
      ],
      error: null,
    });
    const counts = await adAttributionRepository.leadCountsByPipeline(ORG);
    expect(counts.get('acc1|pl1')).toBe(2);
    expect(counts.get('acc1|pl2')).toBe(1);
    expect(counts.get('acc2|pl1')).toBe(1);
    expect(counts.size).toBe(3);
  });

  it('skips rows with a null account id or null pipeline id rather than producing a garbage key', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { id: 'l1', integration_account_id: null, ghl_pipeline_id: 'pl1' },
        { id: 'l2', integration_account_id: 'acc1', ghl_pipeline_id: null },
        { id: 'l3', integration_account_id: null, ghl_pipeline_id: null },
        { id: 'l4', integration_account_id: 'acc1', ghl_pipeline_id: 'pl1' },
      ],
      error: null,
    });
    const counts = await adAttributionRepository.leadCountsByPipeline(ORG);
    // Only the one fully-populated row should be counted.
    expect(counts.size).toBe(1);
    expect(counts.get('acc1|pl1')).toBe(1);
  });

  it('scopes by org', async () => {
    await adAttributionRepository.leadCountsByPipeline(ORG);
    expect(supaRec.last.table).toBe('leads');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
  });

  it('orders by id (required for deterministic pagination)', async () => {
    await adAttributionRepository.leadCountsByPipeline(ORG);
    expect(supaRec.last.order).toEqual({ col: 'id', opts: { ascending: true } });
  });
});

describe('pagination', () => {
  // Proves fetchAllPages actually stitches multiple pages together, and that
  // range() advances between calls — not just that the loop compiles. Without
  // this, a single-page or unpaginated read would silently pass every other
  // test (the harness's default resultProvider always returns a tiny array).
  it('concatenates a full 1000-row first page with a second page, and advances range', async () => {
    let calls = 0;
    const ranges = [];
    supaRec.resultProvider = (q) => {
      calls += 1;
      ranges.push({ ...q.range });
      if (calls === 1) {
        const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `l${i}` }));
        return { data: page1, error: null };
      }
      return { data: [{ id: 'l1000' }, { id: 'l1001' }], error: null };
    };
    const rows = await adAttributionRepository.leadsInWindow(ORG, '2026-01-01', '2026-02-01');
    expect(calls).toBe(2);
    expect(rows.length).toBe(1002);
    expect(ranges[0]).toEqual({ from: 0, to: 999 });
    expect(ranges[1]).toEqual({ from: 1000, to: 1999 });
  });

  it('stops after a single page when fewer than 1000 rows come back', async () => {
    let calls = 0;
    supaRec.resultProvider = () => {
      calls += 1;
      return { data: [{ id: 'a1' }, { id: 'a2' }], error: null };
    };
    const rows = await adAttributionRepository.acceptedForMatching(ORG, '2026-01-01', '2026-02-01');
    expect(calls).toBe(1);
    expect(rows.length).toBe(2);
  });
});
