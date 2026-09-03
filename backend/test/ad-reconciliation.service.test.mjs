// Reconciliation. The owner's acceptance criterion is that our numbers tally
// with the platform's, so the tally is a product surface, not a manual check.
//
// RULING B: the brief's original draft called a `marketingRepository
// .spendByCampaign(orgId, { since, until, provider })` that does not exist,
// and even if it did, the real campaignSpend() bounds its window with
// `.lt(until)` (EXCLUSIVE) while ad_grain_rollup uses `<= p_until`
// (INCLUSIVE) — reusing it would drop the final day's campaign spend from
// one side of every comparison and report a permanent false gap on the very
// feature built to prove the numbers tally. So this mocks the real method,
// `campaignSpendByProvider(orgId, since, until, provider)`, which reads
// ad_metrics with matching inclusive bounds.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { rollup: vi.fn() },
}));
vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: {
        campaignSpendByProvider: vi.fn(),
        adAccountsForProvider: vi.fn(),
    },
}));

const { adReconciliationService } = await import('../src/services/ad-reconciliation.service.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const RANGE = { since: '2026-06-01', until: '2026-08-31' };

beforeEach(() => {
    marketingRepository.campaignSpendByProvider.mockReset();
    marketingRepository.adAccountsForProvider.mockReset();
    marketingRepository.campaignSpendByProvider.mockResolvedValue([
        { id: 'r1', spend_pence: 30000 },
        { id: 'r2', spend_pence: 14800 },
    ]);   // £448.00 of campaign spend
    // One healthy, fully covered account by default.
    marketingRepository.adAccountsForProvider.mockResolvedValue([
        { customer_id: 'C1', name: 'Main', currency: 'GBP', status: null, is_selected: true },
    ]);
});

describe('google reconciliation', () => {
    it('reports ad groups as exact and keywords as an expected shortfall', async () => {
        adGrainRepository.rollup.mockImplementation(async (_o, grain) => (
            grain === 'google_adgroup' ? [{ spend_pence: 44800 }]
          : grain === 'google_ad'      ? [{ spend_pence: 44800 }]
          : [{ spend_pence: 41200 }]   // keywords fall short — unkeyworded traffic
        ));

        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        const byGrain = Object.fromEntries(out.levels.map((l) => [l.grain, l]));

        expect(byGrain.google_adgroup.gapPence).toBe(0);
        expect(byGrain.google_keyword.spendPence).toBe(41200);
        expect(byGrain.google_keyword.gapPence).toBe(3600);
        expect(byGrain.google_keyword.gapPct).toBeCloseTo(8.04, 1);
        // The keyword gap is expected, so it must be explained, not flagged.
        expect(byGrain.google_keyword.note).toMatch(/no keyword/i);
        expect(byGrain.google_adgroup.note).toBeNull();
    });

    it('calls the real repository method with plain date strings, positionally, per provider', async () => {
        adGrainRepository.rollup.mockResolvedValue([{ spend_pence: 0 }]);
        await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        expect(marketingRepository.campaignSpendByProvider).toHaveBeenCalledWith(
            ORG, RANGE.since, RANGE.until, 'google_ads', ['C1'],
        );
    });

    // gapPence is zeroed under a £1.00 tolerance; gapPct used to be derived
    // from the RAW gap, so a 50p difference rendered as "Reconciles" beside
    // "0.11%" — two figures disagreeing inside one payload.
    it('derives gapPct from the gap it actually reports, not the raw one', async () => {
        adGrainRepository.rollup.mockResolvedValue([{ spend_pence: 44750 }]);  // 50p short
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        for (const level of out.levels) {
            expect(level.gapPence).toBe(0);
            expect(level.gapPct).toBe(0);
        }
    });
});

// The campaign side is ad_metrics, which keeps 92 days of history for an
// account long after the deep pull stops covering it. Comparing every
// ad_metrics row against a deep total that can only ever hold the covered
// accounts turns that account's whole spend into a permanent unexplained red
// gap — on the one screen built to prove the numbers tally.
describe('account coverage', () => {
    beforeEach(() => {
        adGrainRepository.rollup.mockResolvedValue([{ spend_pence: 44800 }]);
    });

    it('narrows the campaign side to the accounts the deep pull covers', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'C1', name: 'Main', currency: 'GBP', status: null, is_selected: true },
            { customer_id: 'C2', name: 'Old', currency: 'GBP', status: 'not_enabled', is_selected: true },
            { customer_id: 'C3', name: 'US', currency: 'USD', status: null, is_selected: true },
            { customer_id: 'C4', name: 'Paused', currency: 'GBP', status: null, is_selected: false },
        ]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        expect(marketingRepository.campaignSpendByProvider).toHaveBeenCalledWith(
            ORG, RANGE.since, RANGE.until, 'google_ads', ['C1'],
        );
        expect(out.coveredAccountCount).toBe(1);
        expect(out.coversAllAccounts).toBe(false);
        expect(out.excludedAccounts.map((a) => [a.customerId, a.reason])).toEqual([
            ['C2', 'not_enabled'],
            ['C3', 'unsupported_currency'],
            ['C4', 'not_selected'],
        ]);
    });

    // The currency guard's whole justification for treating a MISSING currency
    // as sterling is that the accounts it affects are named on screen. That
    // only holds if the exclusion list is actually rendered — before this it
    // was computed in both syncs and then dropped.
    it('describes each exclusion in calm prose, naming the currency', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'C1', name: 'Main', currency: 'GBP', status: null, is_selected: true },
            { customer_id: 'C3', name: 'US Account', currency: 'USD', status: null, is_selected: true },
        ]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        expect(out.excludedAccounts[0].description)
            .toBe('US Account: billed in a currency we do not convert (USD).');
        // Honest about what the totals above it cover.
        expect(out.excludedNote).toMatch(/cover 1 of 2 connected Google accounts/);
    });

    it('says so plainly when every connected account is covered', async () => {
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        expect(out.coversAllAccounts).toBe(true);
        expect(out.excludedAccounts).toEqual([]);
        expect(out.excludedNote).toBeNull();
    });

    // A missing currency is deliberately treated as GBP (three live Google
    // accounts have none recorded) — dropping their real spend would be the
    // worse error. They must NOT be excluded.
    it('covers an account with no recorded currency rather than dropping its spend', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'C1', name: 'No currency', currency: null, status: null, is_selected: true },
        ]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        expect(out.coversAllAccounts).toBe(true);
        expect(marketingRepository.campaignSpendByProvider).toHaveBeenCalledWith(
            ORG, RANGE.since, RANGE.until, 'google_ads', ['C1'],
        );
    });

    // No account dimension at all is NOT "no account is covered". Filtering to
    // an empty set there would zero the campaign side and make every level
    // "reconcile" at nothing — a wrong answer that looks right.
    it('applies no account filter when the org has no ad_accounts rows yet', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        expect(marketingRepository.campaignSpendByProvider).toHaveBeenCalledWith(
            ORG, RANGE.since, RANGE.until, 'google_ads', null,
        );
        expect(out.coversAllAccounts).toBe(true);
    });

    it('reads the account dimension for the provider being reconciled', async () => {
        await adReconciliationService.build(ORG, { ...RANGE, provider: 'meta_ads' });
        expect(marketingRepository.adAccountsForProvider).toHaveBeenCalledWith(ORG, 'meta_ads');
    });
});

describe('meta reconciliation', () => {
    it('marks reach non-additive and expects ad sets and ads to tie', async () => {
        adGrainRepository.rollup.mockResolvedValue([{ spend_pence: 44800 }]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'meta_ads' });
        const byGrain = Object.fromEntries(out.levels.map((l) => [l.grain, l]));

        expect(byGrain.meta_adset.gapPence).toBe(0);
        expect(byGrain.meta_ad.gapPence).toBe(0);
        expect(byGrain.meta_adset.additive).toBe(true);
        expect(out.reachNote).toMatch(/unique people/i);
    });

    it('surfaces a real discrepancy rather than hiding it', async () => {
        adGrainRepository.rollup.mockResolvedValue([{ spend_pence: 40000 }]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'meta_ads' });
        const adset = out.levels.find((l) => l.grain === 'meta_adset');
        expect(adset.gapPence).toBe(4800);
        expect(adset.note).toMatch(/does not reconcile/i);
    });
});

describe('empty data', () => {
    it('reports a zero campaign total without dividing by zero', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        adGrainRepository.rollup.mockResolvedValue([]);
        const out = await adReconciliationService.build(ORG, { ...RANGE, provider: 'google_ads' });
        expect(out.levels.every((l) => l.gapPct === null)).toBe(true);
    });
});

describe('unknown provider', () => {
    it('rejects a provider that is neither google_ads nor meta_ads', async () => {
        await expect(adReconciliationService.build(ORG, { ...RANGE, provider: 'tiktok_ads' }))
            .rejects.toThrow(/unknown provider/i);
    });
});
