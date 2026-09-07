// ============================================================================
// campaignSpend pages ad_metrics with .range(). Without an ORDER BY, Postgres
// is free to return rows in ANY order — and it does not have to pick the same
// order twice within one paged scan. A row can therefore appear on two pages
// (counted twice) while another appears on none (lost), and the result is a
// spend total that is silently wrong and changes between calls.
//
// Measured live: Marketing > Overview reported GBP 129,054.92 of ad spend for
// Jun-Aug 2026 against GBP 122,649.08 actually present in ad_metrics for that
// window — GBP 6,405.84 of rows counted twice, on a read of ~4,000 rows over
// five pages. Every cost-per-lead and cost-per-patient figure on that page
// divided by that inflated number.
//
// This is the same class as the documented PostgREST truncation trap: a paged
// read must be ordered on something unique, or paging is not paging.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { marketingRepository } = await import('../src/repositories/marketing.repository.js');

const SINCE = '2026-05-31T23:00:00.000Z';
const UNTIL = '2026-08-31T23:00:00.000Z';

let queries;
beforeEach(() => {
    queries = [];
    supaRec.resultProvider = (q) => {
        if (q.table === 'ad_metrics') { queries.push(q); return { data: [], error: null }; }
        return { data: [], error: null };
    };
});

describe('campaignSpend paging', () => {
    it('orders the paged read on a unique column, so no row is counted twice or lost', async () => {
        await marketingRepository.campaignSpend('org-1', SINCE, UNTIL);

        const q = queries[0];
        expect(q, 'ad_metrics must be read').toBeDefined();
        const orders = (q.orders ?? []).map((o) => o.col);
        expect(orders, 'a .range() read with no .order() pages an undefined order').toContain('id');
    });

    it('still resolves the window to LONDON calendar dates, not a slice', async () => {
        // The scope bar emits 2026-05-31T23:00:00Z for the start of June under
        // BST. Slicing that string would read 31 May and drag in a day of the
        // previous month's spend at one end while dropping the last day at the
        // other.
        await marketingRepository.campaignSpend('org-1', SINCE, UNTIL);

        const q = queries[0];
        expect((q.gtes ?? []).find((g) => g.col === 'metric_date')?.val).toBe('2026-06-01');
        expect((q.lts ?? []).find((l) => l.col === 'metric_date')?.val).toBe('2026-09-01');
    });
});
