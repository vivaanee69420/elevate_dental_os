// Per-phase accumulation: setProgress keeps a `phases` map (insertion order =
// pull order) so the UI can show each resource's pull — not just the active
// phase. A pct-only tick (e.g. the opportunity link loop, or the heartbeat's
// empty patch) must NOT wipe the count established during that phase's fetch.
// 'starting'/'idle' are transient status, not resources, so they stay out.

import { describe, it, expect, beforeEach } from 'vitest';
import { setProgress, getProgress, clearProgress } from '../src/lib/integrations/sync-progress.js';

const ORG = 'org-phases';
const PROVIDER = 'gohighlevel';

describe('setProgress — per-phase breakdown', () => {
  beforeEach(() => clearProgress(ORG, PROVIDER));

  it('records one entry per phase in pull order', () => {
    setProgress(ORG, PROVIDER, { phase: 'contacts', count: 1240, pct: 49 });
    setProgress(ORG, PROVIDER, { phase: 'opportunities', count: 2639, pct: 99 });
    const { phases } = getProgress(ORG, PROVIDER);
    expect(Object.keys(phases)).toEqual(['contacts', 'opportunities']);
    expect(phases.contacts.count).toBe(1240);
    expect(phases.opportunities.count).toBe(2639);
  });

  it('a pct-only tick preserves the phase count (link loop does not reset to 0)', () => {
    setProgress(ORG, PROVIDER, { phase: 'opportunities', count: 2639, pct: 99 });
    setProgress(ORG, PROVIDER, { phase: 'opportunities', pct: 99 }); // upsert batch tick, no count
    const { phases } = getProgress(ORG, PROVIDER);
    expect(phases.opportunities.count).toBe(2639); // not wiped
  });

  it('the empty heartbeat patch leaves the phases map untouched', () => {
    setProgress(ORG, PROVIDER, { phase: 'contacts', count: 500, pct: 30 });
    setProgress(ORG, PROVIDER, {}); // heartbeat: refresh `at` only
    const { phases } = getProgress(ORG, PROVIDER);
    expect(Object.keys(phases)).toEqual(['contacts']);
    expect(phases.contacts.count).toBe(500);
  });

  it('excludes the transient starting/idle status from the breakdown', () => {
    setProgress(ORG, PROVIDER, { running: true, phase: 'starting' });
    setProgress(ORG, PROVIDER, { phase: 'contacts', count: 10, pct: 5 });
    const { phases } = getProgress(ORG, PROVIDER);
    expect(Object.keys(phases)).toEqual(['contacts']); // no 'starting' row
  });

  it('expectedPhases pre-seeds pending rows without touching the active phase', () => {
    setProgress(ORG, PROVIDER, { running: true, phase: 'starting' });
    setProgress(ORG, PROVIDER, { expectedPhases: ['contacts', 'opportunities', 'conversations'] });
    const prog = getProgress(ORG, PROVIDER);
    expect(Object.keys(prog.phases)).toEqual(['contacts', 'opportunities', 'conversations']);
    expect(prog.phases.opportunities).toMatchObject({ count: 0, pct: 0 });
    expect(prog.phase).toBe('starting'); // directive must not change the active phase
    expect(prog.expectedPhases).toBeUndefined(); // not persisted
  });

  it('expectedPhases never clobbers a phase that already has real counts', () => {
    setProgress(ORG, PROVIDER, { phase: 'contacts', count: 1240, pct: 49 });
    setProgress(ORG, PROVIDER, { expectedPhases: ['contacts', 'opportunities'] });
    const { phases } = getProgress(ORG, PROVIDER);
    expect(phases.contacts.count).toBe(1240); // preserved
    expect(phases.opportunities.count).toBe(0); // newly seeded
  });
});
