// Primitives behind the Business Hub load fix.
//
// The endpoint fanned 16 heavy aggregate RPCs out in ONE Promise.all on every
// load. Warm, each is well under a second — but 16-way self-concurrency
// starved individual statements past Supabase's 8s statement_timeout, which
// is why panels failed with "canceling statement due to statement timeout"
// while others on the same page succeeded.
import { describe, it, expect, vi } from 'vitest';
import { createTtlCache } from '../src/lib/ttl-cache.js';
import { mapWithConcurrency } from '../src/lib/async-pool.js';

describe('createTtlCache', () => {
  it('returns a stored value and misses after the TTL', () => {
    let clock = 1_000;
    const c = createTtlCache({ ttlMs: 100, now: () => clock });
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
    clock += 101;
    expect(c.get('k')).toBeUndefined();
  });

  it('misses on an unknown key without throwing', () => {
    expect(createTtlCache({ ttlMs: 100 }).get('nope')).toBeUndefined();
  });

  it('evicts the oldest entry past max, bounding memory', () => {
    const c = createTtlCache({ ttlMs: 10_000, max: 2 });
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBeUndefined(); // oldest evicted
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  it('invalidate(prefix) drops matching keys only', () => {
    const c = createTtlCache({ ttlMs: 10_000 });
    c.set('org1:x', 1); c.set('org1:y', 2); c.set('org2:z', 3);
    c.invalidate('org1:');
    expect(c.get('org1:x')).toBeUndefined();
    expect(c.get('org1:y')).toBeUndefined();
    expect(c.get('org2:z')).toBe(3);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves result order regardless of completion order', async () => {
    const tasks = [
      () => new Promise((r) => setTimeout(() => r('slow'), 20)),
      () => Promise.resolve('fast'),
      () => new Promise((r) => setTimeout(() => r('mid'), 10)),
    ];
    expect(await mapWithConcurrency(tasks, 2)).toEqual(['slow', 'fast', 'mid']);
  });

  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, () => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return 1;
    });
    await mapWithConcurrency(tasks, 4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // still genuinely parallel
  });

  it('rejects if any task rejects, like Promise.all', async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.reject(new Error('boom'))];
    await expect(mapWithConcurrency(tasks, 2)).rejects.toThrow('boom');
  });

  it('handles an empty task list', async () => {
    expect(await mapWithConcurrency([], 4)).toEqual([]);
  });
});
