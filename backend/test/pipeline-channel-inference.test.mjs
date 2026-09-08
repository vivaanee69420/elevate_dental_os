// Automatic pipeline -> ad channel detection.
//
// The map decides which report a lead belongs to, so a wrong guess does not
// mislabel a few rows — it moves a whole pipeline's population onto one report
// and out of another, and takes cost per lead with it. These tests are mostly
// about what detection must REFUSE to decide.
import { describe, it, expect } from 'vitest';
import {
  inferChannel, detectMappings, MIN_LEADS, MIN_SHARE,
} from '../src/lib/marketing/pipeline-channel-inference.js';

const row = (o) => ({ integration_account_id: 'acc-1', ghl_pipeline_id: 'p1', leads: 0, meta_leads: 0, google_leads: 0, ...o });

describe('inferChannel', () => {
  // The four live pipelines that SHOULD be detected, at their real numbers.
  it('maps a pipeline whose leads are overwhelmingly Meta', () => {
    expect(inferChannel(row({ leads: 656, meta_leads: 606, google_leads: 0 })))
      .toEqual({ channel: 'meta_ads', share: 0.924, leads: 656 });
  });

  it('maps a pipeline whose leads are overwhelmingly Google', () => {
    const r = inferChannel(row({ leads: 110, meta_leads: 3, google_leads: 76 }));
    expect(r?.channel).toBe('google_ads');
  });

  // THE case the share denominator exists for. This live pipeline is 96% Meta
  // among its ATTRIBUTED leads and 4% Meta among its people — 1,336 of them,
  // the org's largest, plainly a general intake pipeline. Mapping it on the
  // attributed share would have swept all 1,336 into the Meta pool on the
  // evidence of 52.
  it('refuses a big pipeline where only a few leads carry ad ids', () => {
    expect(inferChannel(row({ leads: 1336, meta_leads: 52, google_leads: 2 }))).toBeNull();
  });

  it('refuses a pipeline too small to be evidence', () => {
    expect(inferChannel(row({ leads: MIN_LEADS - 1, meta_leads: MIN_LEADS - 1, google_leads: 0 }))).toBeNull();
    // ...and accepts the same shape one lead above the floor.
    expect(inferChannel(row({ leads: MIN_LEADS, meta_leads: MIN_LEADS, google_leads: 0 }))?.channel).toBe('meta_ads');
  });

  // A mixed intake pipeline is a real thing, and picking the larger half would
  // be a coin toss presented as a fact.
  it('refuses a pipeline that is meaningfully both channels', () => {
    expect(inferChannel(row({ leads: 200, meta_leads: 130, google_leads: 70 }))).toBeNull();
  });

  it('refuses a pipeline with no attribution at all', () => {
    expect(inferChannel(row({ leads: 500, meta_leads: 0, google_leads: 0 }))).toBeNull();
  });

  it('never divides by a zero denominator', () => {
    expect(inferChannel(row({ leads: 0, meta_leads: 0, google_leads: 0 }))).toBeNull();
    expect(inferChannel(undefined)).toBeNull();
  });

  it('holds the share threshold exactly at the boundary', () => {
    const atFloor = Math.ceil(100 * MIN_SHARE);
    expect(inferChannel(row({ leads: 100, meta_leads: atFloor, google_leads: 0 }))?.channel).toBe('meta_ads');
    expect(inferChannel(row({ leads: 100, meta_leads: atFloor - 1, google_leads: 0 }))).toBeNull();
  });
});

describe('detectMappings', () => {
  const counts = [
    row({ ghl_pipeline_id: 'meta', leads: 656, meta_leads: 606 }),
    row({ ghl_pipeline_id: 'google', leads: 110, google_leads: 76 }),
    row({ ghl_pipeline_id: 'mixed', leads: 1336, meta_leads: 52, google_leads: 2 }),
  ];

  it('fills only the pipelines it can decide, and marks them auto', () => {
    const out = detectMappings(counts, []);
    expect(out.map((r) => r.ghl_pipeline_id)).toEqual(['meta', 'google']);
    expect(out.every((r) => r.source === 'auto')).toBe(true);
    // The evidence is recorded, so the screen can show its working rather than
    // assert a channel the owner cannot check.
    expect(out[0].detected_leads).toBe(656);
    expect(out[0].detected_share).toBeCloseTo(0.924, 3);
  });

  // The reason clearing a channel writes a null row instead of deleting one.
  it("never re-decides a pipeline the owner deliberately left unassigned", () => {
    const out = detectMappings(counts, [
      { integration_account_id: 'acc-1', ghl_pipeline_id: 'meta', channel: null, source: 'owner' },
    ]);
    expect(out.map((r) => r.ghl_pipeline_id)).toEqual(['google']);
  });

  it("never overwrites a channel the owner chose", () => {
    const out = detectMappings(counts, [
      { integration_account_id: 'acc-1', ghl_pipeline_id: 'meta', channel: 'google_ads', source: 'owner' },
    ]);
    expect(out.map((r) => r.ghl_pipeline_id)).toEqual(['google']);
  });

  it('never re-decides its own earlier guess', () => {
    const out = detectMappings(counts, [
      { integration_account_id: 'acc-1', ghl_pipeline_id: 'meta', channel: 'meta_ads', source: 'auto' },
    ]);
    expect(out.map((r) => r.ghl_pipeline_id)).toEqual(['google']);
  });

  // Pipeline ids are unique only WITHIN a GoHighLevel location, so the same id
  // under two subaccounts is two different pipelines.
  it('keys on subaccount and pipeline together, not the pipeline alone', () => {
    const out = detectMappings(
      [row({ integration_account_id: 'acc-2', ghl_pipeline_id: 'meta', leads: 656, meta_leads: 606 })],
      [{ integration_account_id: 'acc-1', ghl_pipeline_id: 'meta', channel: 'meta_ads', source: 'owner' }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].integration_account_id).toBe('acc-2');
  });

  it('is empty, not broken, on an org with no leads at all', () => {
    expect(detectMappings([], [])).toEqual([]);
    expect(detectMappings(null, null)).toEqual([]);
  });
});
