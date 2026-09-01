// Marketing repository: org scoping and — the sharp edge — the spend window.
//
// ad_metrics.metric_date is a DATE; the scope window arrives as an ISO INSTANT
// built in London wall-clock time. Under BST the start of August is
// 2026-07-31T23:00:00Z, so anything that treats the instant as UTC (a
// `.slice(0, 10)`) reads it as 31 July: August's spend then picks up a day of
// July and drops 31 August, while ad_lead_conversions uses correct timestamptz
// bounds. Spend and leads would be measured over different days and every
// cost-per-lead figure would be wrong.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { marketingRepository } from '../src/repositories/marketing.repository.js';

const ORG = 'org-mkt-1';
// August 2026 as the scope bar emits it: London-local midnight, in BST (UTC+1).
const AUG_SINCE = '2026-07-31T23:00:00.000Z';
const AUG_UNTIL = '2026-08-31T23:00:00.000Z';

const gte = (col) => supaRec.last.gtes.find((x) => x.col === col)?.val;
const lt = (col) => supaRec.last.lts.find((x) => x.col === col)?.val;

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('campaignSpend window', () => {
    it('resolves the London calendar date, not the UTC date, of each bound', async () => {
        await marketingRepository.campaignSpend(ORG, AUG_SINCE, AUG_UNTIL);
        expect(gte('metric_date')).toBe('2026-08-01');
        expect(lt('metric_date')).toBe('2026-09-01');
    });

    it('includes 31 August and excludes 31 July — the BST boundary', async () => {
        await marketingRepository.campaignSpend(ORG, AUG_SINCE, AUG_UNTIL);
        // Half-open [gte, lt): 31 August is inside, 31 July is not.
        expect('2026-08-31' >= gte('metric_date')).toBe(true);
        expect('2026-08-31' < lt('metric_date')).toBe(true);
        expect('2026-07-31' >= gte('metric_date')).toBe(false);
    });

    it('a single-day BST range asks for that day, not the day before', async () => {
        await marketingRepository.campaignSpend(
            ORG, '2026-08-11T23:00:00.000Z', '2026-08-12T23:00:00.000Z');
        expect(gte('metric_date')).toBe('2026-08-12');
        expect(lt('metric_date')).toBe('2026-08-13');
    });

    it('GMT (winter) instants are unaffected — midnight UTC is midnight London', async () => {
        await marketingRepository.campaignSpend(
            ORG, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
        expect(gte('metric_date')).toBe('2026-01-01');
        expect(lt('metric_date')).toBe('2026-02-01');
    });

    it('keeps the half-open comparison (gte/lt), never lte', async () => {
        await marketingRepository.campaignSpend(ORG, AUG_SINCE, AUG_UNTIL);
        expect(supaRec.last.lts.some((x) => x.col === 'metric_date')).toBe(true);
        expect(supaRec.last.ltes ?? []).toEqual([]);
    });

    it('scopes to the organisation and, when given, the practice', async () => {
        await marketingRepository.campaignSpend(ORG, AUG_SINCE, AUG_UNTIL, 'prac-1');
        expect(supaRec.last.table).toBe('ad_metrics');
        expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
        expect(supaRec.last.eqs).toContainEqual({ col: 'practice_id', val: 'prac-1' });
    });

    it('collapses campaign x day rows into one row per campaign', async () => {
        supaRec.resultProvider = () => ({
            data: [
                { provider: 'meta_ads', customer_id: 'act_1', campaign_id: 'c1', campaign_name: null, spend_pence: 1000, impressions: 10, clicks: 2, conversions: 1 },
                { provider: 'meta_ads', customer_id: 'act_1', campaign_id: 'c1', campaign_name: 'Implants', spend_pence: 2350, impressions: 5, clicks: 1, conversions: 0 },
            ],
            error: null,
        });
        const rows = await marketingRepository.campaignSpend(ORG, AUG_SINCE, AUG_UNTIL);
        expect(rows).toHaveLength(1);
        expect(rows[0].spend_pence).toBe(3350);       // integer pence, summed
        expect(rows[0].campaign_name).toBe('Implants'); // a later name fills a null
    });
});

describe('leadsByCampaign', () => {
    it('passes the raw timestamptz bounds through to the RPC, org-scoped', async () => {
        supaRec.rpcCalls = [];
        supaRec.rpcProvider = () => ({ data: [], error: null });
        await marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(supaRec.rpcCalls[0].fn).toBe('ad_lead_conversions');
        // The RPC compares timestamptz, so the instants are NOT date-reduced here
        // — that is precisely why campaignSpend must resolve the same London days.
        expect(supaRec.rpcCalls[0].params).toEqual({
            p_org: ORG, p_since: AUG_SINCE, p_until: AUG_UNTIL, p_practice: null,
        });
    });

    // The bug this pins: PostgREST caps a set-returning FUNCTION at 1000 rows
    // just as it caps a table. An unpaginated .rpc() returned Plan4growth's
    // first 1000 August leads out of 1,222 and the screen read "Leads 1,000"
    // with 44 patients instead of 122 — no error, just a wrong round number.
    function pagedLeads(total) {
        const all = Array.from({ length: total }, (_, i) => ({
            contact_id: `c-${String(i).padStart(5, '0')}`,
            ad_campaign_id: 'camp-1',
            attribution_source: 'facebook',
            converted: i % 10 === 0,
        }));
        const CAP = 1000;   // what the server enforces, whatever we ask for
        return (_fn, _params, mods) => {
            const from = mods.range?.from ?? 0;
            const to = mods.range?.to ?? all.length - 1;
            return { data: all.slice(from, Math.min(to + 1, from + CAP)), error: null };
        };
    }

    it('pages past the 1000-row cap instead of silently truncating', async () => {
        supaRec.rpcCalls = [];
        supaRec.rpcProvider = pagedLeads(1222);
        const rows = await marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows).toHaveLength(1222);
        expect(new Set(rows.map((r) => r.contact_id)).size).toBe(1222);
        expect(rows.filter((r) => r.converted)).toHaveLength(123);
    });

    it('orders by a unique key so paging cannot duplicate or skip a lead', async () => {
        supaRec.rpcCalls = [];
        supaRec.rpcProvider = pagedLeads(1222);
        await marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null);
        // Every page must carry the same deterministic order.
        for (const call of supaRec.rpcCalls) {
            expect(call.mods.order).toEqual({ col: 'contact_id', opts: { ascending: true } });
            expect(call.mods.range).toBeDefined();
        }
    });

    it('stops on an empty page, not a short one — a lower server cap still pages', async () => {
        supaRec.rpcCalls = [];
        // A server capping at 400 returns short pages forever; breaking on a
        // short page would truncate at 400 and look exactly like the old bug.
        const all = Array.from({ length: 950 }, (_, i) => ({
            contact_id: `c-${String(i).padStart(5, '0')}`,
            ad_campaign_id: null, attribution_source: null, converted: false,
        }));
        supaRec.rpcProvider = (_fn, _params, mods) => {
            const from = mods.range?.from ?? 0;
            return { data: all.slice(from, from + 400), error: null };
        };
        const rows = await marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows).toHaveLength(950);
    });

    it('surfaces an RPC error rather than returning a short result', async () => {
        supaRec.rpcCalls = [];
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'statement timeout' } });
        await expect(marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null))
            .rejects.toThrow(/statement timeout/);
    });
});
