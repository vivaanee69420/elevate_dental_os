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

  it('deletes the row when channel is null, scoped by org', async () => {
    // Unassigned is the ABSENCE of a row, so clearing must delete rather than
    // write a sentinel value.
    await adChannelPipelineRepository.setChannel(ORG, 'acc1', 'p1', 'Open Day', null);
    expect(supaRec.last.op).toBe('delete');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.eqs).toContainEqual({ col: 'integration_account_id', val: 'acc1' });
    expect(supaRec.last.eqs).toContainEqual({ col: 'ghl_pipeline_id', val: 'p1' });
  });
});
