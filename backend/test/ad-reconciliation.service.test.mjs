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
    marketingRepository: { campaignSpendByProvider: vi.fn() },
}));

const { adReconciliationService } = await import('../src/services/ad-reconciliation.service.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const RANGE = { since: '2026-06-01', until: '2026-08-31' };

beforeEach(() => {
    marketingRepository.campaignSpendByProvider.mockResolvedValue([
        { id: 'r1', spend_pence: 30000 },
        { id: 'r2', spend_pence: 14800 },
    ]);   // £448.00 of campaign spend
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
            ORG, RANGE.since, RANGE.until, 'google_ads',
        );
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
