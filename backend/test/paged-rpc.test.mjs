// ============================================================================
// Paged reads for set-returning RPCs.
//
// PostgREST exposes a set-returning function as a relation, so its result is
// subject to the SAME 1000-row cap as a table read. Two RPCs behind the
// Command Centre's Turnover and Takings figures are sitting just under it on
// the live org right now:
//
//   settled_receipts_by_day   947 rows (one per day), +~81 per 90 days
//   treatment_revenue_matrix  901 rows (practice x treatment_name)
//
// and the date picker reaches back to 2020. Nothing was broken when this was
// written; both would have crossed the line within a couple of months and the
// figures would have started drifting DOWNWARD on their own, with no error and
// nothing to point at. That is the whole hazard: a capped read is
// indistinguishable from a complete one.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchAllRpc, RPC_PAGE_SIZE, RPC_MAX_PAGES } from '../src/lib/paged-rpc.js';

// A client that honours .range(), the way PostgREST does.
function clientOver(rows) {
  const calls = [];
  return {
    calls,
    rpc(fn, params) {
      const state = { fn, params, order: null, range: null };
      const builder = {
        order(col, opts) { state.order = { col, opts }; return builder; },
        range(from, to) {
          state.range = { from, to };
          calls.push({ ...state });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
        then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return builder;
    },
  };
}

const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ i }));

beforeEach(() => vi.restoreAllMocks());

describe('a result larger than the cap is read in full', () => {
  it('reads past 1000 rows', async () => {
    const c = clientOver(makeRows(2400));
    const { data, error } = await fetchAllRpc(c, 'f', { p_org: 'o' }, { orderBy: 'i' });
    expect(error).toBeNull();
    expect(data).toHaveLength(2400);
  });

  it('the live shapes that were about to break read correctly', async () => {
    for (const n of [947, 1000, 1001, 1500]) {
      const c = clientOver(makeRows(n));
      const { data } = await fetchAllRpc(c, 'settled_receipts_by_day', {}, { orderBy: 'day' });
      expect(data).toHaveLength(n);
    }
  });

  it('rows come back in order, with no gap or repeat at a page seam', async () => {
    const c = clientOver(makeRows(2050));
    const { data } = await fetchAllRpc(c, 'f', {}, { orderBy: 'i' });
    expect(data.map((r) => r.i)).toEqual(Array.from({ length: 2050 }, (_, i) => i));
  });

  it('asks for contiguous, non-overlapping windows', async () => {
    const c = clientOver(makeRows(2400));
    await fetchAllRpc(c, 'f', {}, { orderBy: 'i' });
    expect(c.calls.map((x) => [x.range.from, x.range.to]))
      .toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('orders the read, so paging cannot skip or repeat rows', async () => {
    const c = clientOver(makeRows(10));
    await fetchAllRpc(c, 'f', {}, { orderBy: 'day', ascending: false });
    expect(c.calls[0].order).toEqual({ col: 'day', opts: { ascending: false } });
  });
});

describe('stopping', () => {
  it('a short page ends the read — one extra request, no more', async () => {
    const c = clientOver(makeRows(1200));
    await fetchAllRpc(c, 'f', {}, { orderBy: 'i' });
    expect(c.calls).toHaveLength(2);
  });

  // Stopping on a short page alone would leave the exact-multiple case to the
  // empty page; both paths must terminate.
  it('an exact multiple of the page size terminates', async () => {
    const c = clientOver(makeRows(RPC_PAGE_SIZE * 2));
    const { data } = await fetchAllRpc(c, 'f', {}, { orderBy: 'i' });
    expect(data).toHaveLength(RPC_PAGE_SIZE * 2);
    expect(c.calls).toHaveLength(3); // third page comes back empty
  });

  it('an empty result is not an error', async () => {
    const c = clientOver([]);
    const { data, error } = await fetchAllRpc(c, 'f', {}, { orderBy: 'i' });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('an RPC error is returned, not swallowed into a partial total', async () => {
    const c = {
      rpc: () => ({
        order() { return this; },
        range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      }),
    };
    const { data, error } = await fetchAllRpc(c, 'f', {}, { orderBy: 'i' });
    expect(data).toBeNull();
    expect(error.message).toBe('boom');
  });
});

describe('the loop bound is load-bearing', () => {
  // The vitest harness lets a provider ignore mods.range and hand back the same
  // fixed array forever. Without a hard cap a paged reader does not fail
  // cleanly — it hangs and then exhausts memory. This is a recorded trap.
  it('a client that ignores .range() fails fast instead of hanging', async () => {
    const full = makeRows(RPC_PAGE_SIZE);
    const ignoresRange = {
      rpc: () => ({
        order() { return this; },
        range: () => Promise.resolve({ data: full, error: null }), // never advances
      }),
    };
    const { data, error } = await fetchAllRpc(ignoresRange, 'f', {}, { orderBy: 'i', maxPages: 5 });
    expect(data).toBeNull();
    expect(error.message).toMatch(/exceeded 5 pages/);
  });

  it('refuses to return a partial result when the bound is hit', async () => {
    const c = clientOver(makeRows(10_000));
    const { data, error } = await fetchAllRpc(c, 'f', {}, { orderBy: 'i', maxPages: 2 });
    // Silently returning the first 2000 rows as if complete is the exact
    // failure this whole module exists to prevent.
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it('the default bound is high enough for any real result', () => {
    expect(RPC_MAX_PAGES * RPC_PAGE_SIZE).toBeGreaterThanOrEqual(250_000);
  });
});

describe('the two at-risk repository reads are paged', () => {
  it('settled_receipts_by_day and treatment_revenue_matrix go through the pager', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const repo = readFileSync(join(src, 'repositories', 'analytics.repository.js'), 'utf8');

    for (const fn of ['settled_receipts_by_day', 'treatment_revenue_matrix']) {
      const i = repo.indexOf(`'${fn}'`);
      expect(i).toBeGreaterThan(-1);
      // The call must be the paged form, not a bare client.rpc(...).
      expect(repo.slice(i - 120, i)).toMatch(/fetchAllRpc\(/);
    }
  });
});
