// ============================================================================
// "Leads" must mean enquiries, and its parts must sum to its total.
//
// The card used to sum `ad_metrics.conversions` — platform-reported conversions,
// which are any optimised action rather than an enquiry, and which Meta reports
// per action type so roll-ups and their components both get counted. Live for
// 1-6 Sep 2026 it read 1,391 while the CRM took 303 enquiries and our own
// Facebook report attributed 187 of them to Meta: one product, two answers,
// 5.6x apart on the same window.
//
// Leads is now the CRM total, split by the channel that bought them using the
// SAME structural test the Facebook report uses. The attributed channels come
// from the database; the remainder is derived here so the parts always add up
// to the total on screen.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;
const ORG = 'org-leadsrc';
const WINDOW = { since: '2026-08-31T23:00:00.000Z', until: '2026-09-06T23:00:00.000Z' };
const NOW = () => new Date('2026-09-06T16:00:00.000Z');

beforeEach(() => {
    svc.invalidateBusinessHub();
    supaRec.resultProvider = (q) => (
        q.table === 'practices' ? { data: [{ id: 'p1', name: 'Alpha', chairs: 4 }], error: null }
            : q.table === 'business_health' ? { data: { baseline: {} }, error: null }
                : { data: [], error: null }
    );
    supaRec.rpcProvider = (fn) => {
        if (fn === 'leads_rollup_by_practice')   // the CRM total: 303 enquiries
            return { data: [{ practice_id: 'p1', total: 303, converted: 40 }], error: null };
        if (fn === 'lead_counts_by_channel')
            return { data: [{ channel: 'meta_ads', leads: 187 }, { channel: 'google_ads', leads: 14 }], error: null };
        if (fn === 'ad_leads_by_provider')       // platform conversions — NOT leads
            return { data: [{ provider: 'meta_ads', conversions: 1047, spend_pence: 100 },
                             { provider: 'google_ads', conversions: 41, spend_pence: 50 }], error: null };
        return { data: [], error: null };
    };
});

describe('businessHub — Leads means enquiries', () => {
    it('counts the CRM total, not platform conversions', async () => {
        const { group } = await svc.businessHub(ORG, { ...WINDOW, now: NOW });
        expect(group.leads).toBe(303);
    });

    it('splits by the channel that bought them, with a remainder that balances', async () => {
        const { group } = await svc.businessHub(ORG, { ...WINDOW, now: NOW });
        const by = Object.fromEntries(group.leadsBySource.map((s) => [s.source, s.leads]));

        expect(by['Meta Ads']).toBe(187);
        expect(by['Google Ads']).toBe(14);
        expect(by['Direct / other']).toBe(303 - 187 - 14);
        // The parts are shown under the total, so they must add up to it.
        expect(group.leadsBySource.reduce((s, x) => s + x.leads, 0)).toBe(group.leads);
    });

    it('keeps platform conversions, clearly separated from leads', async () => {
        // Not discarded — they are the only lead-ish figure an org with no CRM
        // has. They just must not be called leads.
        const { group } = await svc.businessHub(ORG, { ...WINDOW, now: NOW });

        expect(group.adPlatformConversions).toBe(1047 + 41);
        expect(group.adPlatformConversions).not.toBe(group.leads);
    });

    it('never shows a negative remainder when attribution exceeds the CRM total', async () => {
        // Attribution counts a lead per resolved campaign and the CRM total is
        // its own query; they can disagree. A negative "Direct / other" would be
        // nonsense on screen, so it floors at zero.
        supaRec.rpcProvider = (fn) => {
            if (fn === 'leads_rollup_by_practice') return { data: [{ practice_id: 'p1', total: 10, converted: 0 }], error: null };
            if (fn === 'lead_counts_by_channel') return { data: [{ channel: 'meta_ads', leads: 40 }], error: null };
            return { data: [], error: null };
        };
        const { group } = await svc.businessHub(ORG, { ...WINDOW, now: NOW });
        const other = group.leadsBySource.find((s) => s.source === 'Direct / other');

        expect(other.leads).toBe(0);
    });
});
