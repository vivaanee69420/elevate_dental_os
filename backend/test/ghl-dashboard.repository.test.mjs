import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { ghlDashboardRepository } = await import('../src/repositories/ghl-dashboard.repository.js');

beforeEach(() => {
  supaRec.rpcProvider = undefined;
  supaRec.rpcCalls = [];
});

describe('aggregate', () => {
  it('calls the RPC with org/window/practice args and returns rows', async () => {
    supaRec.rpcProvider = (fn) =>
      fn === 'ghl_dashboard_aggregate'
        ? { data: [{ practice_id: 'p1', contacts_total: 5 }], error: null }
        : { data: null, error: { message: 'wrong fn' } };

    const rows = await ghlDashboardRepository.aggregate('org-1', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', null);

    expect(rows).toEqual([{ practice_id: 'p1', contacts_total: 5 }]);
    expect(supaRec.rpcCalls[0]).toEqual({
      fn: 'ghl_dashboard_aggregate',
      params: { p_org: 'org-1', p_since: '2026-01-01T00:00:00Z', p_until: '2026-02-01T00:00:00Z', p_practice: null },
    });
  });

  it('returns [] when the RPC returns null data', async () => {
    supaRec.rpcProvider = () => ({ data: null, error: null });
    expect(await ghlDashboardRepository.aggregate('org-1', 's', 'u', null)).toEqual([]);
  });

  it('throws on RPC error', async () => {
    supaRec.rpcProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(ghlDashboardRepository.aggregate('org-1', 's', 'u', null)).rejects.toThrow('boom');
  });
});
