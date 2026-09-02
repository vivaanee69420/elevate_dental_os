// serviceClient bypasses RLS (rule 3): isolation here is the explicit
// organisation_id argument on every call, and nothing else. These tests pin
// that the org reaches the database on every marketing read path.
//
// The booking stage added three new joins to ad_lead_conversions, and every
// join is a place an organisation_id predicate can be forgotten. Measured on
// live data, dropping it from the matcher moved `booked` from 236 to 240 — a
// silent cross-tenant read of patient records.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { marketingRepository } from '../src/repositories/marketing.repository.js';

const SINCE = '2026-05-31T23:00:00.000Z';
const UNTIL = '2026-08-31T23:00:00.000Z';

beforeEach(() => {
    supaRec.rpcCalls = [];
    // One empty page ends the repository's paging loop immediately.
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('marketing reads are org-scoped', () => {
    it('sends p_org on the funnel aggregate', async () => {
        await marketingRepository.campaignFunnel('org-A', SINCE, UNTIL, null);
        expect(supaRec.rpcCalls[0]).toMatchObject({
            fn: 'ad_campaign_funnel', params: { p_org: 'org-A' },
        });
    });

    it('sends p_org on the per-person function', async () => {
        await marketingRepository.leadsByCampaign('org-B', SINCE, UNTIL, null);
        expect(supaRec.rpcCalls[0]).toMatchObject({
            fn: 'ad_lead_conversions', params: { p_org: 'org-B' },
        });
    });

    it('never calls a marketing RPC without an org', async () => {
        await marketingRepository.campaignFunnel('org-C', SINCE, UNTIL, 'prac-1');
        await marketingRepository.leadsByCampaign('org-C', SINCE, UNTIL, 'prac-1');
        expect(supaRec.rpcCalls.length).toBeGreaterThan(0);
        for (const call of supaRec.rpcCalls) {
            expect(call.params.p_org).toBeTruthy();
        }
    });

    it('one org cannot ask for another org rows by passing a practice', async () => {
        // p_practice narrows WITHIN an org; it must never widen across orgs.
        await marketingRepository.campaignFunnel('org-D', SINCE, UNTIL, 'prac-belonging-elsewhere');
        expect(supaRec.rpcCalls[0].params.p_org).toBe('org-D');
    });
});
