// ============================================================================
// GET /api/cockpit with no window must not 500.
//
// since/until are optional in cockpitQuerySchema, but several reads
// interpolated them straight into a filter, so a call without a window sent the
// literal string 'undefined' as a date, and the revenue-by-line RPC 404'd
// because the supabase client strips undefined keys, leaving a 1-arg call
// against a 3-arg function. The ScopePeriod bar always sends a window, so only
// an API caller could reach it — but a 500 is the wrong answer to a legal
// request, and it would have taken the whole page down if the bar ever failed
// to initialise.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cockpitQuerySchema } from '../src/models/cockpit.model.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('the schema really does allow an absent window', () => {
  it('accepts a request with no since/until', () => {
    const q = cockpitQuerySchema.parse({});
    expect(q.since).toBeUndefined();
    expect(q.until).toBeUndefined();
  });
});

describe('the service defaults the window rather than passing undefined on', () => {
  const svc = readFileSync(join(SRC, 'services', 'cockpit.service.js'), 'utf8');

  it('fills an absent window from the month the cards are anchored to', () => {
    expect(svc).toMatch(/if \(!since\) since = month\.start;/);
    expect(svc).toMatch(/if \(!until\) until = month\.endExclusive;/);
  });

  it('defaults BEFORE the reads that would interpolate the value', () => {
    const defaultAt = svc.indexOf('if (!since) since = month.start;');
    const firstRead = svc.indexOf('cockpitRepository.cashupRollup');
    expect(defaultAt).toBeGreaterThan(0);
    expect(defaultAt).toBeLessThan(firstRead);
  });
});

describe('the revenue-by-line RPC sends nulls, never undefined', () => {
  const repo = readFileSync(join(SRC, 'repositories', 'cockpit.repository.js'), 'utf8');

  // The client strips undefined keys, so a raw undefined turns a 3-arg call
  // into a 1-arg one and PostgREST cannot resolve the function.
  it('coalesces the window to null', () => {
    expect(repo).toMatch(/p_since: since \?\? null, p_until: until \?\? null/);
  });
});
