// ============================================================================
// The Business Hub's marketing window was a day out, at BOTH ends.
//
//   const fromDate = since.slice(0, 10);
//   const untilD = new Date(until); untilD.setUTCDate(untilD.getUTCDate() - 1);
//   const toDate = untilD.toISOString().slice(0, 10);
//
// The scope bar emits London day bounds as UTC instants, so August 2026 arrives
// as since=2026-07-31T23:00:00Z (BST) and until=2026-08-31T23:00:00Z. Slicing
// the first reads "2026-07-31" — a day of JULY's spend pulled in — and
// subtracting a day from the second before slicing reads "2026-08-30", dropping
// 31 August entirely.
//
// Measured live (Rochester's two ad accounts, August 2026): the block reported
// GBP 8,615.58 against the GBP 8,710.96 the Facebook and Google pages show for
// the same month — GBP 95.38 out, in a figure the owner reads beside those very
// pages.
//
// This is the documented London-window trap: never slice() an instant, resolve
// it. Same rule migration 000163 exists to enforce in SQL.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { analyticsService } = await import('../src/services/analytics.service.js');
const repo = await import('../src/repositories/analytics.repository.js');
const marketing = await import('../src/repositories/marketing.repository.js');

// August 2026 exactly as the scope bar sends it, under BST.
const SINCE = '2026-07-31T23:00:00.000Z';
const UNTIL = '2026-08-31T23:00:00.000Z';

let seen;
beforeEach(() => {
    seen = null;
    supaRec.resultProvider = () => ({ data: [], error: null });
    vi.spyOn(repo.analyticsRepository, 'adMetricsInWindow').mockImplementation(
        async (_org, fromDate, toDate) => { seen = { fromDate, toDate }; return []; },
    );
    vi.spyOn(repo.analyticsRepository, 'leadsForMarketing').mockResolvedValue([]);
    vi.spyOn(repo.analyticsRepository, 'settledRevenueByPractice').mockResolvedValue([]);
    vi.spyOn(repo.analyticsRepository, 'practicesFull').mockResolvedValue([]);
    vi.spyOn(marketing.marketingRepository, 'googleLeadLedger').mockResolvedValue([]);
    vi.spyOn(marketing.marketingRepository, 'metaLeadLedger').mockResolvedValue([]);
});

describe('Business Hub marketing window', () => {
    it('reads the London calendar month the picker asked for, not a sliced instant', async () => {
        await analyticsService.marketingRoi('org-1', { since: SINCE, until: UNTIL });

        expect(seen).toEqual({ fromDate: '2026-08-01', toDate: '2026-08-31' });
    });

    it('holds under GMT too, where the instants carry no offset', async () => {
        // December: London is UTC, so the bounds arrive as midnight. The naive
        // slice happens to be right for `since` here — which is exactly why the
        // bug survived, it only misbehaves for eight months of the year.
        await analyticsService.marketingRoi('org-1', {
            since: '2026-12-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z',
        });

        expect(seen).toEqual({ fromDate: '2026-12-01', toDate: '2026-12-31' });
    });
});
