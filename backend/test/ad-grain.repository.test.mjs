// Deep-grain repository — RPC-only access. There is deliberately no method
// that selects from the five tables directly: PostgREST truncates at 1000
// rows in silence, and keyword grain passes that inside a single month.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { adGrainRepository, GRAINS } = await import('../src/repositories/ad-grain.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
    supaRec.rpcCalls = [];
    supaRec.rpcProvider = (fn) => ({ data: fn === 'ad_grain_replace_window' ? 7 : [], error: null });
});

describe('grain allowlist', () => {
    it('names exactly the five supported grains', () => {
        expect([...GRAINS]).toEqual(['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword']);
    });

    it('refuses an unknown grain before it reaches the database', async () => {
        await expect(adGrainRepository.rollup(ORG, 'search_term', { since: '2026-08-01', until: '2026-08-31' }))
            .rejects.toThrow(/unknown grain/i);
        expect(supaRec.rpcCalls).toHaveLength(0);
    });
});

describe('replaceWindow', () => {
    it('passes org, grain, accounts and rows through to the RPC', async () => {
        const rows = [{ entity_id: 'KW1' }];
        const n = await adGrainRepository.replaceWindow(ORG, 'google_keyword', ['C1'], rows);
        const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_grain_replace_window');
        expect(call.params).toEqual({
            p_org: ORG, p_grain: 'google_keyword', p_customer_ids: ['C1'], p_rows: rows,
        });
        expect(n).toBe(7);
    });

    it('does not call the database with an empty payload', async () => {
        const n = await adGrainRepository.replaceWindow(ORG, 'google_keyword', ['C1'], []);
        expect(supaRec.rpcCalls).toHaveLength(0);
        expect(n).toBe(0);
    });
});

describe('rollup', () => {
    it('sends nulls for absent filters rather than omitting them', async () => {
        await adGrainRepository.rollup(ORG, 'meta_ad', { since: '2026-08-01', until: '2026-08-31' });
        const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_grain_rollup');
        expect(call.params).toEqual({
            p_org: ORG, p_grain: 'meta_ad', p_since: '2026-08-01', p_until: '2026-08-31',
            p_practice: null, p_campaign: null, p_parent: null,
        });
    });

    it('surfaces an RPC error rather than returning an empty list', async () => {
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'boom' } });
        await expect(adGrainRepository.rollup(ORG, 'meta_ad', { since: '2026-08-01', until: '2026-08-31' }))
            .rejects.toThrow(/ad_grain_rollup: boom/);
    });
});

describe('keywordRollup', () => {
    it('calls the keyword-specific RPC, which carries no grain parameter', async () => {
        await adGrainRepository.keywordRollup(ORG, { since: '2026-08-01', until: '2026-08-31', campaignId: 'CMP1' });
        const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_keyword_rollup');
        expect(call.params).toEqual({
            p_org: ORG, p_since: '2026-08-01', p_until: '2026-08-31',
            p_practice: null, p_campaign: 'CMP1', p_parent: null,
        });
    });
});

// serviceClient bypasses RLS, so p_org IS the tenant boundary on this path.
// A method that forgot it would read or write every organisation's rows.
describe('cross-org isolation', () => {
    it('sends an organisation id on every call this repository makes', async () => {
        await adGrainRepository.rollup(ORG, 'meta_ad', { since: '2026-08-01', until: '2026-08-31' });
        await adGrainRepository.keywordRollup(ORG, { since: '2026-08-01', until: '2026-08-31' });
        await adGrainRepository.replaceWindow(ORG, 'meta_ad', ['act1'], [{ entity_id: 'A' }]);
        await adGrainRepository.restampPractices(ORG);

        expect(supaRec.rpcCalls).toHaveLength(4);
        for (const call of supaRec.rpcCalls) {
            expect(call.params.p_org).toBe(ORG);
        }
    });
});
