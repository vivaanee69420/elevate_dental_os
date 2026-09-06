// ============================================================================
// The Business Hub payload cache must not outlive the payload's SHAPE.
//
// `businessHub` has a Postgres second tier (`dashboard_cache`) that survives
// deploys and is shared across instances — 10 minutes for a live window, SIX
// HOURS for a closed one. It is keyed by org + window only, so a payload
// written by the previous release is served to the next one, and any field
// added in that release reads `undefined`.
//
// This is not hypothetical: the live table was observed holding entries with
// `has_compare: false` beside fresh ones with `has_compare: true`, and a card
// rendered "213.2% vs undefined" off exactly that mismatch. Every field this
// service has ever added is one deploy away from the same bug.
//
// Including a shape version in the key makes a release that changes the payload
// miss the old entry instead of trusting it.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const { HUB_PAYLOAD_VERSION } = await import('../src/services/analytics.service.js');

const ORG = 'org-cacheshape';

beforeEach(() => {
    svc.invalidateBusinessHub();
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('Business Hub payload cache key', () => {
    it('declares a payload shape version', () => {
        expect(HUB_PAYLOAD_VERSION).toBeTruthy();
    });

    it('carries that version in the Postgres cache key', async () => {
        // Without the version, an entry written before a field was added is
        // indistinguishable from one written after, and gets served for hours.
        const keys = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'dashboard_cache') {
                for (const e of q.eqs) if (e.col === 'cache_key') keys.push(e.val);
            }
            return { data: [], error: null };
        };
        await svc.businessHub(ORG, { since: '2026-05-31T23:00:00.000Z', until: '2026-06-30T23:00:00.000Z' });

        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) expect(k).toContain(HUB_PAYLOAD_VERSION);
    });

    it('keeps the org id first, so post-sync invalidation still matches', () => {
        // invalidateBusinessHub(orgId) drops entries by the prefix `${orgId}|`.
        // Putting the version in FRONT of the org id breaks that prefix, and the
        // failure is silent: every invalidation after a sync stops matching and
        // stale numbers stay up for the full TTL — ten minutes on a live window,
        // six hours on a closed one. Caught exactly once, by accident.
        const keys = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'dashboard_cache') {
                for (const e of q.eqs) if (e.col === 'cache_key') keys.push(e.val);
            }
            return { data: [], error: null };
        };
        return svc.businessHub(ORG, { days: 90 }).then(() => {
            expect(keys.length).toBeGreaterThan(0);
            for (const k of keys) expect(k.startsWith(`hub:${ORG}|`)).toBe(true);
        });
    });
});
