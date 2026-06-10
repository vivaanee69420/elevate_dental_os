// meta-reach — live per-window reach/frequency for Meta accounts, cached in
// ad_reach_cache with a TTL. Cache hit within TTL avoids the Graph API; a miss
// queries Meta (level=account, exact window) and upserts the result.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { getByProvider: vi.fn() },
}));

const { fetchPeriodReach, isFresh } = await import('../src/lib/integrations/meta-reach.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

const FROM = '2026-06-01', TO = '2026-06-10';
const NOW = new Date('2026-06-10T12:00:00Z');
const now = () => NOW;

describe('isFresh', () => {
    it('is true within the TTL and false past it', () => {
        const ttl = 6 * 3600_000;
        expect(isFresh('2026-06-10T11:00:00Z', NOW.getTime(), ttl)).toBe(true);  // 1h old
        expect(isFresh('2026-06-10T05:00:00Z', NOW.getTime(), ttl)).toBe(false); // 7h old
        expect(isFresh(null, NOW.getTime(), ttl)).toBe(false);
    });
});

describe('fetchPeriodReach', () => {
    beforeEach(() => {
        integrationRepository.getByProvider.mockReset();
        global.fetch = vi.fn();
    });

    it('returns the empty map without touching the DB or Meta when no accounts given', async () => {
        const m = await fetchPeriodReach('org-1', [], FROM, TO, { now });
        expect(m.size).toBe(0);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('serves a fresh cache hit without calling Meta', async () => {
        supaRec.resultProvider = (q) => {
            if (q.table === 'ad_reach_cache' && q.op === 'select') {
                return { data: [{ customer_id: '111', reach: 82839, frequency: 2.87, impressions: 237991, fetched_at: '2026-06-10T11:00:00Z' }], error: null };
            }
            return { data: [], error: null };
        };
        const m = await fetchPeriodReach('org-1', ['111'], FROM, TO, { now });
        expect(global.fetch).not.toHaveBeenCalled();
        expect(m.get('meta_ads::111')).toEqual({
            period_reach: 82839, period_frequency: 2.87, period_window_start: FROM, period_window_end: TO,
        });
    });

    it('queries Meta for the exact window on a cache miss and upserts the result', async () => {
        const queries = [];
        supaRec.resultProvider = (q) => { queries.push(q); return { data: [], error: null }; }; // empty cache
        integrationRepository.getByProvider.mockResolvedValue({ secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })) });
        global.fetch = vi.fn(async (url) => {
            expect(String(url)).toContain('level=account');
            expect(String(url)).not.toContain('time_increment');
            return { ok: true, status: 200, json: async () => ({ data: [{ reach: '82839', frequency: '2.87', impressions: '237991', clicks: '3138', spend: '2731.36' }] }) };
        });

        const m = await fetchPeriodReach('org-1', ['111'], FROM, TO, { now });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const up = queries.find((q) => q.table === 'ad_reach_cache' && q.op === 'upsert');
        expect(up.upsertVals).toMatchObject({ organisation_id: 'org-1', provider: 'meta_ads', customer_id: '111', window_start: FROM, window_end: TO, reach: 82839 });
        expect(m.get('meta_ads::111')).toMatchObject({ period_reach: 82839, period_frequency: 2.87, period_window_start: FROM, period_window_end: TO });
    });

    it('skips Meta (and yields no entry) when the org has no stored credentials', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        integrationRepository.getByProvider.mockResolvedValue({ secrets: null });
        const m = await fetchPeriodReach('org-1', ['111'], FROM, TO, { now });
        expect(global.fetch).not.toHaveBeenCalled();
        expect(m.has('meta_ads::111')).toBe(false);
    });
});
