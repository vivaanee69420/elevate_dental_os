// ============================================================================
// CROSS-ORG ISOLATION for the ad-attribution tables.
//
// These repositories run on serviceClient, which BYPASSES RLS. The ONLY
// app-layer tenant guard is the explicit .eq('organisation_id', orgId) chained
// on every query (see CLAUDE.md rule 3). These tests prove that filter.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { adChannelPipelineRepository } from '../src/repositories/ad-channel-pipeline.repository.js';
import { adAttributionRepository } from '../src/repositories/ad-attribution.repository.js';

const ORG_A = 'org-aaaaaaaa';
const ORG_B = 'org-bbbbbbbb';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('every ad-attribution read pins organisation_id', () => {
  const reads = [
    ['list', () => adChannelPipelineRepository.list(ORG_A)],
    ['ghlAccounts', () => adAttributionRepository.ghlAccounts(ORG_A)],
    ['practiceOptions', () => adAttributionRepository.practiceOptions(ORG_A)],
    ['adAccounts', () => adAttributionRepository.adAccounts(ORG_A)],
    ['adSpend', () => adAttributionRepository.adSpend(ORG_A, '2026-07-01', '2026-08-01')],
    ['acceptedForMatching', () => adAttributionRepository.acceptedForMatching(ORG_A, '2026-07-01', '2026-08-01')],
    ['leadsInWindow', () => adAttributionRepository.leadsInWindow(ORG_A, '2026-07-01', '2026-08-01')],
    ['leadCountsByPipeline', () => adAttributionRepository.leadCountsByPipeline(ORG_A)],
  ];

  for (const [name, run] of reads) {
    it(`${name} filters on the caller org and never another`, async () => {
      await run();
      expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG_A });
      expect(supaRec.last.eqs.some((e) => e.col === 'organisation_id' && e.val === ORG_B)).toBe(false);
    });
  }
});

describe('every ad-attribution write pins organisation_id', () => {
  it('setChannel stamps the caller org on the upserted row', async () => {
    await adChannelPipelineRepository.setChannel(ORG_A, 'acc1', 'p1', 'Open Day', 'google_ads');
    expect(supaRec.last.upsertVals.organisation_id).toBe(ORG_A);
    expect(supaRec.last.upsertVals.organisation_id).not.toBe(ORG_B);
  });

  it('setChannel(null) deletes scoped by org, so it cannot clear a foreign row', async () => {
    await adChannelPipelineRepository.setChannel(ORG_A, 'acc1', 'p1', null, null);
    expect(supaRec.last.op).toBe('delete');
    expect(orgFilter(supaRec.last).val).toBe(ORG_A);
  });

  it('setAdAccountPractice constrains by org AND id', async () => {
    // Both must constrain: an org-A request can never remap an org-B ad account
    // even if it knows that account's id.
    await adAttributionRepository.setAdAccountPractice(ORG_A, 'ad-in-B', 'p1');
    expect(orgFilter(supaRec.last).val).toBe(ORG_A);
    expect(supaRec.last.eqs.map((e) => e.col).sort()).toEqual(['id', 'organisation_id']);
  });
});
