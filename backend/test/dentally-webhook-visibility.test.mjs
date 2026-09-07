// ============================================================================
// A dropped webhook record must leave a trace.
//
// applyWebhookEvent has two silent exits: `{ skipped: 'unmatched_practice' }`
// when invoiceRow/paymentRow cannot map site_id to one of our practices, and
// `{ ignored: resourceType }` for a type we do not handle. Neither throws, so
// the caller's try/catch never logs them, and nothing is persisted — the record
// simply never arrives and no one can tell.
//
// That is exactly the state this org is in: 38 appointment rows updated by
// webhook today and ZERO invoice rows touched, with "All events" subscribed at
// Dentally. Whether invoice events are not being sent or are being dropped on
// our side is currently unanswerable, because the drop path is invisible.
// ============================================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { supaRec } from './setup.js';

const { applyWebhookEvent } = await import('../src/lib/integrations/dentally-sync.js');

const ORG = 'org-wh-vis';
let warn;

beforeEach(() => {
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('dentally webhook — dropped records are visible', () => {
    it('warns, naming the site, when an invoice cannot be matched to a practice', async () => {
        // No practices row carries this pms_site_id, so invoiceRow returns null.
        const res = await applyWebhookEvent(ORG, 'invoice', {
            id: 999001, site_id: 4242, patient_id: 7, amount: 120.5,
            amount_outstanding: 0, dated_on: '2026-09-06', paid: true,
        });

        expect(res.skipped).toBe('unmatched_practice');
        const line = warn.mock.calls.map((c) => JSON.stringify(c)).join(' ');
        expect(line).toContain('4242');       // the site we could not map
        expect(line).toContain('invoice');    // and what was lost
    });

    it('warns when an event type arrives that we do not handle', async () => {
        const res = await applyWebhookEvent(ORG, 'lab_work', { id: 5 });

        expect(res.ignored).toBe('lab_work');
        expect(warn.mock.calls.map((c) => JSON.stringify(c)).join(' ')).toContain('lab_work');
    });
});
