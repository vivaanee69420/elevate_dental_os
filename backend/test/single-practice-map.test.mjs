// Auto-mapping an organisation that has exactly one practice.
//
// Everything practice-scoped reads a practice_id stamped from an ACCOUNT's
// mapping — ad spend from the ad account, a GHL lead from the subaccount that
// fetched it — so an unmapped account makes a practice filter return 0 beside
// spend that is plainly real. With one practice there is nothing to choose;
// with two there is, and this must not choose.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/repositories/ad-attribution.repository.js', () => ({
  adAttributionRepository: { restampAdMetricsPractices: vi.fn(async () => 7) },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
  adGrainRepository: { restampPractices: vi.fn(async () => 11) },
}));

const { singlePracticeMapService } = await import('../src/services/single-practice-map.service.js');
const { adAttributionRepository } = await import('../src/repositories/ad-attribution.repository.js');

const ORG = 'org-1';
const ORG_B = 'org-2';
const PRACTICE = 'practice-1';

// One practice row, then two "update ... select" calls returning the stamped
// rows, then the GHL restamp RPC.
function harness({ practices, adStamped = [], iaStamped = [] }) {
  const calls = [];
  let updates = 0;
  supaRec.resultProvider = (q) => {
    calls.push(q);
    if (q.table === 'practices') return { data: practices, error: null };
    // `update(...).select('id')` records op:'select' — the trailing select
    // overwrites it — so an update is identified by updateVals, not by op.
    if (q.updateVals) {
      updates += 1;
      return { data: q.table === 'ad_accounts' ? adStamped : iaStamped, error: null };
    }
    return { data: [], error: null };
  };
  supaRec.rpcProvider = () => ({ data: [{ contacts_updated: 3, leads_updated: 5 }], error: null });
  return { calls, updates: () => updates };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('singlePracticeMapService', () => {
  it('maps unmapped accounts to the only practice and restamps the stored rows', async () => {
    const h = harness({
      practices: [{ id: PRACTICE }],
      adStamped: [{ id: 'ad-1' }],
      iaStamped: [{ id: 'ia-1' }],
    });
    const r = await singlePracticeMapService.run(ORG);

    expect(r.mapped).toBe(true);
    expect(r.adAccounts).toBe(1);
    expect(r.subaccounts).toBe(1);
    // A mapping that only applied to rows fetched afterwards would leave the
    // stored ones null for ever — nothing re-fetches history.
    expect(adAttributionRepository.restampAdMetricsPractices).toHaveBeenCalledWith(ORG);
    expect(r.restamped.ghl).toBe(8);   // 3 contacts + 5 leads

    const updates = h.calls.filter((q) => q.updateVals);
    // Every write is org-scoped — the isolation is the explicit filter, since
    // these repositories run on the service client (rules.md rule 1).
    for (const u of updates) {
      expect(u.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
      expect(u.eqs).not.toContainEqual({ col: 'organisation_id', val: ORG_B });
    }
  });

  // The whole safety argument: a wrong practice is worse than no practice,
  // because it moves money onto another site's report and looks authoritative.
  it('does NOTHING when the organisation has two or more practices', async () => {
    const h = harness({ practices: [{ id: 'p1' }, { id: 'p2' }] });
    const r = await singlePracticeMapService.run(ORG);
    expect(r.mapped).toBe(false);
    expect(h.updates()).toBe(0);
    expect(adAttributionRepository.restampAdMetricsPractices).not.toHaveBeenCalled();
  });

  it('does nothing when the organisation has no practices at all', async () => {
    const h = harness({ practices: [] });
    expect((await singlePracticeMapService.run(ORG)).mapped).toBe(false);
    expect(h.updates()).toBe(0);
  });

  // Never overwrite: only null practice_id is stamped, so a deliberate mapping
  // survives, and neither does an account the owner excluded get one.
  it('only touches unmapped rows, and only SELECTED ad accounts', async () => {
    const h = harness({ practices: [{ id: PRACTICE }], adStamped: [{ id: 'ad-1' }] });
    await singlePracticeMapService.run(ORG);
    const adUpdate = h.calls.find((q) => q.updateVals && q.table === 'ad_accounts');
    // `.is('practice_id', null)` — a deliberate mapping is never rewritten.
    expect(adUpdate.iss).toContainEqual({ col: 'practice_id', val: null });
    // An account the owner unticked is not theirs to report on, so stamping it
    // would map spend they have said not to count.
    expect(adUpdate.eqs).toContainEqual({ col: 'is_selected', val: true });
  });

  it('reports "already mapped" without restamping when there is nothing to do', async () => {
    harness({ practices: [{ id: PRACTICE }] });
    const r = await singlePracticeMapService.run(ORG);
    expect(r.mapped).toBe(false);
    expect(r.reason).toMatch(/already mapped/);
    expect(adAttributionRepository.restampAdMetricsPractices).not.toHaveBeenCalled();
  });

  // A convenience on top of a sync that already succeeded must never be able
  // to record that sync as failed.
  it('runQuietly swallows a failure and reports it', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    const r = await singlePracticeMapService.runQuietly(ORG, 'test');
    expect(r.mapped).toBe(false);
    expect(r.error).toMatch(/boom/);
  });
});
