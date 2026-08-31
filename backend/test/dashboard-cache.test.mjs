// Durable (Postgres) tier of the dashboard payload cache. The in-process tier
// is lost on every deploy and is per-instance; this one survives both. Every
// read and write is org-scoped — a cache must never become a cross-tenant
// read path.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { readDashboardCache, writeDashboardCache, purgeDashboardCache } =
  await import('../src/lib/dashboard-cache.js');

const ORG = 'org-a';

beforeEach(() => { supaRec.resultProvider = () => ({ data: null, error: null }); });

describe('readDashboardCache', () => {
  it('scopes the read to the org AND the key', async () => {
    supaRec.resultProvider = () => ({
      data: { payload: { hello: 'world' }, expires_at: new Date(Date.now() + 60_000).toISOString() },
      error: null,
    });
    expect(await readDashboardCache(ORG, 'k1')).toEqual({ hello: 'world' });
    expect(supaRec.last.table).toBe('dashboard_cache');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([
      { col: 'organisation_id', val: ORG },
      { col: 'cache_key', val: 'k1' },
    ]));
  });

  it('treats an expired row as a miss', async () => {
    supaRec.resultProvider = () => ({
      data: { payload: { stale: true }, expires_at: new Date(Date.now() - 1000).toISOString() },
      error: null,
    });
    expect(await readDashboardCache(ORG, 'k1')).toBeUndefined();
  });

  it('returns undefined on a miss', async () => {
    expect(await readDashboardCache(ORG, 'k1')).toBeUndefined();
  });

  it('never throws on a lookup error — a cache failure must not break the page', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(readDashboardCache(ORG, 'k1')).resolves.toBeUndefined();
  });
});

describe('writeDashboardCache', () => {
  it('upserts an org-stamped row and returns the payload unchanged', async () => {
    const payload = { n: 1 };
    expect(await writeDashboardCache(ORG, 'k1', payload, 60_000)).toBe(payload);
    expect(supaRec.last.table).toBe('dashboard_cache');
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals).toEqual(expect.objectContaining({
      organisation_id: ORG, cache_key: 'k1', payload,
    }));
    expect(supaRec.last.upsertOpts).toEqual({ onConflict: 'organisation_id,cache_key' });
  });

  it('swallows write errors — caching is best-effort', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(writeDashboardCache(ORG, 'k1', { n: 1 }, 60_000)).resolves.toEqual({ n: 1 });
  });
});

describe('purgeDashboardCache', () => {
  it('deletes only the calling org rows', async () => {
    await purgeDashboardCache(ORG);
    expect(supaRec.last.table).toBe('dashboard_cache');
    expect(supaRec.last.op).toBe('delete');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'organisation_id', val: ORG }]));
  });
});
