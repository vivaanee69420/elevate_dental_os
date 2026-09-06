// ============================================================================
// The ad-platform window must be London days, not a sliced UTC string.
//
// `ad_metrics.metric_date` is a DATE, so the window is handed over as
// YYYY-MM-DD. The upper bound was derived carefully (`until - 1ms`, with a
// comment explaining why a naive slice is wrong); the LOWER bound was
// `sinceISO.slice(0, 10)` — and the period pickers send London midnight, which
// through BST is 23:00Z on the PREVIOUS day. So "Sep 2026" asked the ad feed for
// 31 August onward and every BST window silently carried an extra day of spend
// and conversions.
//
// Measured on the live org: the Meta lead figure read 1,270 for "1-6 Sep"
// against 1,047 actually dated in that window — 223 conversions belonging to
// 31 August, inflating the Leads card and diluting every rate computed from it.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const ORG = 'org-adwindow';

beforeEach(() => {
    svc.invalidateBusinessHub();
    supaRec.rpcCalls = [];
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

const adCall = () => (supaRec.rpcCalls || []).find((c) => c.fn === 'ad_leads_by_provider');

describe('businessHub — ad-platform window', () => {
    it('starts on the London day the window starts, not the UTC day before', async () => {
        // London 1 Sep 2026 00:00 (BST) === 2026-08-31T23:00:00Z.
        await svc.businessHub(ORG, {
            since: '2026-08-31T23:00:00.000Z', until: '2026-09-06T23:00:00.000Z',
            now: () => new Date('2026-09-06T16:00:00.000Z'),
        });

        expect(adCall()?.params?.p_from).toBe('2026-09-01');
        expect(adCall()?.params?.p_to).toBe('2026-09-06');
    });

    it('is unaffected in GMT, where the two conventions agree', async () => {
        await svc.businessHub(ORG, {
            since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z',
            now: () => new Date('2026-03-01T09:00:00.000Z'),
        });

        expect(adCall()?.params?.p_from).toBe('2026-01-01');
        expect(adCall()?.params?.p_to).toBe('2026-01-31');
    });
});
