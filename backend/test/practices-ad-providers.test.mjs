// ============================================================================
// GET /api/practices — the scope-picker's data source.
//
// The Marketing pages filter this list down to the practices that actually
// have an account for THAT provider: /marketing-google must not offer a
// practice with no Google Ads account, because selecting it renders a
// confident £0 that reads as "we spent nothing here" rather than "this
// practice is not connected". (Live: Plan4growth's Bexleyheath has a Meta
// account and no Google one; Warwick Lodge is the reverse.)
//
// So each practice carries the providers it is mapped to. The org scoping of
// that join is the part worth pinning — a practice must never pick up another
// tenant's ad account.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const router = (await import('../src/routes/practices.routes.js')).default;

const ORG = 'org-aaaaaaaa';
const OTHER_ORG = 'org-bbbbbbbb';

// The GET / handler, invoked directly (same idiom as agency.routes.test.mjs).
const listHandler = router.stack
  .filter((l) => l.route && l.route.path === '/' && l.route.methods.get)
  .map((l) => l.route.stack[l.route.stack.length - 1].handle)[0];

function run(orgId = ORG) {
  const req = { user: { id: 'u1', organisation_id: orgId }, params: {}, body: {}, query: {} };
  return new Promise((resolve, reject) => {
    const res = { json: resolve, status: () => res };
    Promise.resolve(listHandler(req, res, reject)).catch(reject);
  });
}

const PRACTICES = [
  { id: 'p-rochester', name: 'Rochester', chairs: 4, postcode: 'ME1', pms_site_id: '1' },
  { id: 'p-bexley', name: 'Bexleyheath', chairs: 3, postcode: 'DA6', pms_site_id: '2' },
  { id: 'p-warwick', name: 'Warwick Lodge', chairs: 2, postcode: 'CV34', pms_site_id: '3' },
];

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('GET /api/practices — ad_providers', () => {
  const withAccounts = (accounts, reads = []) => {
    supaRec.resultProvider = (q) => {
      reads.push(q);
      if (q.table === 'practices') return { data: PRACTICES, error: null };
      if (q.table === 'ad_accounts') return { data: accounts, error: null };
      return { data: [], error: null };
    };
    return reads;
  };

  it('reports the providers each practice is actually mapped to', async () => {
    withAccounts([
      { practice_id: 'p-rochester', provider: 'google_ads' },
      { practice_id: 'p-rochester', provider: 'meta_ads' },
      { practice_id: 'p-bexley', provider: 'meta_ads' },
      { practice_id: 'p-warwick', provider: 'google_ads' },
    ]);
    const { practices } = await run();
    const byId = Object.fromEntries(practices.map((p) => [p.id, p.ad_providers]));
    expect(byId['p-rochester'].slice().sort()).toEqual(['google_ads', 'meta_ads']);
    expect(byId['p-bexley']).toEqual(['meta_ads']);      // no Google -> off /marketing-google
    expect(byId['p-warwick']).toEqual(['google_ads']);   // no Meta   -> off /marketing-facebook
  });

  it('gives a practice with no ad account an empty list, never undefined', async () => {
    withAccounts([{ practice_id: 'p-rochester', provider: 'google_ads' }]);
    const { practices } = await run();
    // An absent field would read as "unknown" at the call site and be rendered
    // anyway; an empty list is a definite "connected to nothing".
    for (const p of practices) expect(Array.isArray(p.ad_providers)).toBe(true);
    expect(practices.find((p) => p.id === 'p-bexley').ad_providers).toEqual([]);
  });

  it('collapses several accounts on the same provider to one entry', async () => {
    withAccounts([
      { practice_id: 'p-rochester', provider: 'google_ads' },
      { practice_id: 'p-rochester', provider: 'google_ads' },
    ]);
    const { practices } = await run();
    expect(practices.find((p) => p.id === 'p-rochester').ad_providers).toEqual(['google_ads']);
  });

  it('ignores an unmapped account rather than crashing on its null practice', async () => {
    withAccounts([
      { practice_id: null, provider: 'google_ads' },
      { practice_id: 'p-rochester', provider: 'google_ads' },
    ]);
    const { practices } = await run();
    expect(practices.find((p) => p.id === 'p-rochester').ad_providers).toEqual(['google_ads']);
    expect(practices.find((p) => p.id === 'p-bexley').ad_providers).toEqual([]);
  });

  it('scopes the ad-account read to the caller org, so no tenant borrows another\'s accounts', async () => {
    const reads = withAccounts([{ practice_id: 'p-rochester', provider: 'google_ads' }]);
    await run(OTHER_ORG);
    const accountRead = reads.find((q) => q.table === 'ad_accounts');
    expect(accountRead).toBeDefined();
    expect(accountRead.eqs).toEqual(
      expect.arrayContaining([{ col: 'organisation_id', val: OTHER_ORG }]),
    );
    // And the practice list itself stays scoped, as it always was.
    const practiceRead = reads.find((q) => q.table === 'practices');
    expect(practiceRead.eqs).toEqual(
      expect.arrayContaining([{ col: 'organisation_id', val: OTHER_ORG }]),
    );
  });

  it('still returns the fields the picker already relied on', async () => {
    withAccounts([]);
    const { practices } = await run();
    expect(practices[0]).toMatchObject({
      id: 'p-rochester', name: 'Rochester', chairs: 4, postcode: 'ME1', pms_site_id: '1',
    });
  });
});
