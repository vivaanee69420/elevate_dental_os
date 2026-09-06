// ============================================================================
// How far the invoice data actually reaches.
//
// Invoices, invoice_items and treatment_items arrive ONLY in the nightly pull —
// Dentally's webhooks deliver contacts, appointments and payments live but never
// those three (measured: 32 contacts / 1 appointment / 1 payment written since
// the 03:01 sync, and 0 invoices). So on one row of cards Takings is live while
// every invoice figure is frozen at 3am, under a single date heading claiming
// both cover the same days.
//
// An owner checking at 4pm therefore sees a shortfall against Dentally that is
// not an arithmetic error, and has no way to tell that from a real one. The card
// states the days it actually covers instead.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-coverage';
// A window running to 6 Sep, with the last nightly sync at 03:01 on the 6th:
// everything invoiced during the 6th is still missing.
const WINDOW = { since: '2026-08-31T23:00:00.000Z', until: '2026-09-06T23:00:00.000Z' };
const NOW = () => new Date('2026-09-06T16:00:00.000Z');

const withSync = (lastSyncAt) => (q) => (
    q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
        : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
            : q.table === 'integrations'
                // .maybeSingle() — one object, not an array.
                ? { data: { last_sync_at: lastSyncAt }, error: null }
                : { data: [], error: null }
);

beforeEach(() => {
    svc.invalidateBusinessHub();
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('businessHub — invoice data coverage', () => {
    it('reports coverage ending the day before the nightly sync, not the window end', async () => {
        supaRec.resultProvider = withSync('2026-09-06T03:01:14.095Z');
        const { group } = await svc.businessHub(ORG, { ...WINDOW, now: NOW });

        expect(group.invoiceCoverage.complete).toBe(false);
        expect(group.invoiceCoverage.throughYmd).toBe('2026-09-05');
        expect(group.invoiceCoverage.label).toBe('1–5 Sep 2026');
    });

    it('reports the window complete once the sync has moved past it', async () => {
        // Same window, but synced on the 8th: the 6th is fully covered and the
        // card must NOT understate itself.
        supaRec.resultProvider = withSync('2026-09-08T03:01:00.000Z');
        const { group } = await svc.businessHub(ORG, { ...WINDOW, now: () => new Date('2026-09-08T09:00:00.000Z') });

        expect(group.invoiceCoverage.complete).toBe(true);
        expect(group.invoiceCoverage.label).toBe('1–6 Sep 2026');
    });

    it('says nothing rather than guessing when the PMS has never synced', async () => {
        // No integration row at all: claiming a coverage date we cannot support
        // would be worse than showing none.
        supaRec.resultProvider = (q) => (
            q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
                : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
                    : { data: [], error: null }
        );
        const { group } = await svc.businessHub(ORG, { ...WINDOW, now: NOW });

        expect(group.invoiceCoverage.throughYmd).toBeNull();
        expect(group.invoiceCoverage.complete).toBe(true); // no claim => no warning shown
    });
});
