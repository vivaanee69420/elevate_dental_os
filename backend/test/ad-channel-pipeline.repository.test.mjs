// Repository tests run the REAL repository against the fake Supabase client in
// test/setup.js, which records { table, op, eqs, upsertVals } on supaRec.last.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { adChannelPipelineRepository } from '../src/repositories/ad-channel-pipeline.repository.js';

const ORG = 'org-aaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('list', () => {
  it('reads ad_channel_pipelines scoped to the org', async () => {
    await adChannelPipelineRepository.list(ORG);
    expect(supaRec.last.table).toBe('ad_channel_pipelines');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
  });
});

describe('channelMap', () => {
  it('keys by accountId|pipelineId', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { integration_account_id: 'acc1', ghl_pipeline_id: 'p1', channel: 'google_ads' },
        { integration_account_id: 'acc2', ghl_pipeline_id: 'p1', channel: 'meta_ads' },
      ],
      error: null,
    });
    const map = await adChannelPipelineRepository.channelMap(ORG);
    // The same pipeline id in two subaccounts must stay independent — pipeline
    // ids are only unique within a GHL Location.
    expect(map.get('acc1|p1')).toBe('google_ads');
    expect(map.get('acc2|p1')).toBe('meta_ads');
  });

  it('returns an empty map when nothing is mapped', async () => {
    const map = await adChannelPipelineRepository.channelMap(ORG);
    expect(map.size).toBe(0);
  });
});

describe('setChannel', () => {
  it('upserts the row with the org stamped on it', async () => {
    await adChannelPipelineRepository.setChannel(ORG, 'acc1', 'p1', 'Open Day', 'google_ads');
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG);
    expect(supaRec.last.upsertVals.channel).toBe('google_ads');
    expect(supaRec.last.upsertVals.pipeline_name).toBe('Open Day');
  });

  it('writes an explicit null-channel row when cleared, rather than deleting', async () => {
    // This USED to delete, and deleting was right while a human was the only
    // writer: absence meant unassigned and nothing could disagree. Automatic
    // detection (migration 000180) fills pipelines that have NO row, so a
    // deleted row would be re-detected and reassigned on the next sync — the
    // owner's decision undone by morning, silently. The null row IS the
    // decision, and detection skips any pipeline that carries a row.
    await adChannelPipelineRepository.setChannel(ORG, 'acc1', 'p1', 'Open Day', null);
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG);
    expect(supaRec.last.upsertVals.channel).toBeNull();
    // 'owner' is what makes it stick: detection never touches a human's row.
    expect(supaRec.last.upsertVals.source).toBe('owner');
  });

  it('marks a channel the owner chose as theirs, not a detection', async () => {
    await adChannelPipelineRepository.setChannel(ORG, 'acc1', 'p1', 'Open Day', 'meta_ads');
    expect(supaRec.last.upsertVals.source).toBe('owner');
    // A previous automatic guess's evidence must not survive a human overruling
    // it — a share of 0.92 beside a channel nobody detected is a lie.
    expect(supaRec.last.upsertVals.detected_leads).toBeNull();
    expect(supaRec.last.upsertVals.detected_share).toBeNull();
  });
});
