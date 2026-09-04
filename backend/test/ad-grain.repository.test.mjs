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

// The bug these pin: PostgREST caps a response at 1000 rows server-side and
// says NOTHING, and that cap applies to a set-returning RPC exactly as it does
// to a table. ad_grain_rollup collapses day rows into entity rows, but the
// ENTITY count is itself past the cap — ~5,000 keyword/ad-group pairs over 92
// days. A truncated read does not show up as missing rows on a screen: the
// reconciliation service SUMS these rows, so it renders as a fabricated 80%
// spend gap, explained to the owner as normal because the keyword grain is
// whitelisted as an expected shortfall.
//
// READ COUNT, not row total, is the assertion that discriminates. On this
// harness a `page.length < PAGE` reader and a `page.length === 0` reader
// return the SAME rows (both push a page before deciding to stop), so a
// row-count assertion cannot tell a correct pager from a broken one. What
// differs is that the correct reader makes a THIRD, confirming, empty read.
// Do not "simplify" these back to a row-count-only check — same reasoning as
// campaignSpendByProvider in marketing.repository.test.mjs.
describe('rollup paging', () => {
    // A server that caps at CAP rows regardless of the range asked for.
    function pagedRollup(total, cap = 1000) {
        const all = Array.from({ length: total }, (_, i) => ({
            entity_id: `kw-${String(i).padStart(5, '0')}`,
            parent_id: `ag-${i % 7}`,
            spend_pence: 100,
        }));
        return (_fn, _params, mods) => {
            const from = mods.range?.from ?? 0;
            const to = mods.range?.to ?? all.length - 1;
            return { data: all.slice(from, Math.min(to + 1, from + cap)), error: null };
        };
    }

    it('returns EVERY row when the window exceeds one page, making the confirming empty-page read', async () => {
        supaRec.rpcProvider = pagedRollup(1064);
        const rows = await adGrainRepository.rollup(ORG, 'google_keyword', { since: '2026-06-01', until: '2026-08-31' });
        expect(rows).toHaveLength(1064);
        expect(new Set(rows.map((r) => r.entity_id)).size).toBe(1064);
        // 1000 + 64 + a confirming empty page. A `page.length < PAGE` reader
        // stops right after the 64-row page and this reads 2, not 3.
        expect(supaRec.rpcCalls).toHaveLength(3);
    });

    it('does not mistake a short-but-nonempty first page for the last one', async () => {
        supaRec.rpcProvider = pagedRollup(700);
        const rows = await adGrainRepository.keywordRollup(ORG, { since: '2026-06-01', until: '2026-08-31' });
        expect(rows).toHaveLength(700);
        // The 700-row page plus a confirming empty one. A `page.length < PAGE`
        // reader stops after the first page and this reads 1, not 2.
        expect(supaRec.rpcCalls).toHaveLength(2);
    });

    it('keeps paging when the server caps below our page size', async () => {
        supaRec.rpcProvider = pagedRollup(1200, 400);   // every page comes back short
        const rows = await adGrainRepository.rollup(ORG, 'google_ad', { since: '2026-06-01', until: '2026-08-31' });
        expect(rows).toHaveLength(1200);
    });

    // entity_id alone is NOT unique — Google reuses a keyword's criterion id
    // across ad groups, which is exactly why parent_id is in the tables' unique
    // key and in the rollup's GROUP BY. OFFSET paging on a non-unique sort key
    // duplicates and skips rows at every page boundary.
    it('orders by entity_id AND parent_id, both ascending, on every page', async () => {
        supaRec.rpcProvider = pagedRollup(1064);
        await adGrainRepository.rollup(ORG, 'google_keyword', { since: '2026-06-01', until: '2026-08-31' });
        expect(supaRec.rpcCalls.length).toBeGreaterThan(1);
        for (const call of supaRec.rpcCalls) {
            expect(call.mods.orders).toEqual([
                { col: 'entity_id', opts: { ascending: true } },
                { col: 'parent_id', opts: { ascending: true } },
            ]);
            expect(call.mods.range).toBeDefined();
        }
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
