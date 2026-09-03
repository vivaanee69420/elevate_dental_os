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
        const { campaigns } = await marketingRepository.campaignSpend(ORG, AUG_SINCE, AUG_UNTIL);
        expect(campaigns).toHaveLength(1);
        expect(campaigns[0].spend_pence).toBe(3350);       // integer pence, summed
        expect(campaigns[0].campaign_name).toBe('Implants'); // a later name fills a null
    });

    // The trend and the tiles are built from ONE read of the same rows, so they
    // cannot drift apart the way two separate queries would.
    it('returns a per-day series that sums to the same total as the campaigns', async () => {
        supaRec.resultProvider = () => ({
            data: [
                { provider: 'meta_ads', customer_id: 'act_1', campaign_id: 'c1', campaign_name: 'A', practice_id: 'p1', metric_date: '2026-08-02', spend_pence: 1000, impressions: 0, clicks: 0, conversions: 0 },
                { provider: 'meta_ads', customer_id: 'act_1', campaign_id: 'c2', campaign_name: 'B', practice_id: 'p1', metric_date: '2026-08-01', spend_pence: 2350, impressions: 0, clicks: 0, conversions: 0 },
                { provider: 'google_ads', customer_id: 'g_1', campaign_id: 'c3', campaign_name: 'C', practice_id: 'p1', metric_date: '2026-08-01', spend_pence: 500, impressions: 0, clicks: 0, conversions: 0 },
            ],
            error: null,
        });
        const { campaigns, series } = await marketingRepository.campaignSpend(ORG, AUG_SINCE, AUG_UNTIL);
        expect(series.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-02']);  // chronological
        expect(series[0].spendPence).toBe(2850);
        expect(series[0].meta_ads).toBe(2350);
        expect(series[0].google_ads).toBe(500);
        const seriesTotal = series.reduce((n, d) => n + d.spendPence, 0);
        const campaignTotal = campaigns.reduce((n, c) => n + c.spend_pence, 0);
        expect(seriesTotal).toBe(campaignTotal);
    });

    // A practice reading £0.00 is ambiguous — "spent nothing" or "no ad account
    // is mapped to it". The screen can only tell those apart if the read
    // reports how much spend belongs to no practice at all.
    it('reports spend sitting on accounts with no practice mapping', async () => {
        supaRec.resultProvider = () => ({
            data: [
                { provider: 'meta_ads', customer_id: 'a', campaign_id: 'c1', campaign_name: 'A', practice_id: 'p1', metric_date: '2026-08-01', spend_pence: 1000, impressions: 0, clicks: 0, conversions: 0 },
                { provider: 'meta_ads', customer_id: 'b', campaign_id: 'c2', campaign_name: 'B', practice_id: null, metric_date: '2026-08-01', spend_pence: 700, impressions: 0, clicks: 0, conversions: 0 },
            ],
            error: null,
        });
        const { unmappedSpendPence } = await marketingRepository.campaignSpend(ORG, AUG_SINCE, AUG_UNTIL);
        expect(unmappedSpendPence).toBe(700);
    });
});

// campaignSpendByProvider feeds the reconciliation service, which compares it
// directly against ad_grain_rollup — a plpgsql RPC that filters
// `metric_date >= p_since AND metric_date <= p_until` on PLAIN date strings.
// Any divergence from that (a London-resolved date, or a half-open bound)
// reintroduces the false permanent gap RULING B exists to prevent.
describe('campaignSpendByProvider', () => {
    const lte = (col) => supaRec.last.ltes.find((x) => x.col === col)?.val;

    it('takes since/until as plain strings, verbatim — no londonYmd resolution', async () => {
        await marketingRepository.campaignSpendByProvider(ORG, '2026-08-01', '2026-08-31', 'google_ads');
        expect(gte('metric_date')).toBe('2026-08-01');
        expect(lte('metric_date')).toBe('2026-08-31');
    });

    it('bounds INCLUSIVE on both ends (gte/lte), matching ad_grain_rollup — never lt', async () => {
        await marketingRepository.campaignSpendByProvider(ORG, '2026-08-01', '2026-08-31', 'google_ads');
        expect(supaRec.last.ltes?.some((x) => x.col === 'metric_date')).toBe(true);
        expect(supaRec.last.lts ?? []).toEqual([]);
    });

    it('scopes to the organisation and the requested provider', async () => {
        await marketingRepository.campaignSpendByProvider(ORG, '2026-08-01', '2026-08-31', 'meta_ads');
        expect(supaRec.last.table).toBe('ad_metrics');
        expect(supaRec.last.eqs).toContainEqual({ col: 'organisation_id', val: ORG });
        expect(supaRec.last.eqs).toContainEqual({ col: 'provider', val: 'meta_ads' });
    });

    it('returns rows carrying spend_pence for the caller to sum', async () => {
        supaRec.resultProvider = () => ({
            data: [{ id: 'a', spend_pence: 1200 }, { id: 'b', spend_pence: 3400 }],
            error: null,
        });
        const rows = await marketingRepository.campaignSpendByProvider(ORG, '2026-08-01', '2026-08-31', 'google_ads');
        expect(rows.reduce((n, r) => n + r.spend_pence, 0)).toBe(4600);
    });

    // The bug this pins: PostgREST caps a table read at 1000 rows server-side
    // and says nothing about it (see allForOrg in monthlyFinancial.repository.js).
    it('returns EVERY row when the window exceeds one page, not just the first 1000', async () => {
        supaRec.resultProvider = () => ({
            data: Array.from({ length: 1064 }, (_, i) => ({ id: `r${i}`, spend_pence: 100 })),
            error: null,
        });
        const rows = await marketingRepository.campaignSpendByProvider(ORG, '2026-08-01', '2026-08-31', 'google_ads');
        expect(rows).toHaveLength(1064);
    });

    it('does not stop on a SHORT page, only an empty one', async () => {
        // The server's cap is its own setting; treating a short page as the
        // last would reintroduce the truncation at whatever number that is.
        supaRec.resultProvider = () => ({
            data: Array.from({ length: 700 }, (_, i) => ({ id: `r${i}`, spend_pence: 1 })),
            error: null,
        });
        const rows = await marketingRepository.campaignSpendByProvider(ORG, '2026-08-01', '2026-08-31', 'google_ads');
        expect(rows).toHaveLength(700);
    });

    it('orders by id, the table\'s unique key, so OFFSET paging cannot duplicate or skip a row', async () => {
        await marketingRepository.campaignSpendByProvider(ORG, '2026-08-01', '2026-08-31', 'google_ads');
        expect(supaRec.last.orders?.some((o) => o.col === 'id')).toBe(true);
    });

    it('surfaces a read error rather than returning a short result', async () => {
        supaRec.resultProvider = () => ({ data: null, error: { message: 'statement timeout' } });
        await expect(marketingRepository.campaignSpendByProvider(ORG, '2026-08-01', '2026-08-31', 'google_ads'))
            .rejects.toThrow(/statement timeout/);
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

// The repository pages: it calls the RPC until a page comes back EMPTY. Serve
// the pages in order, ending with [] so the loop terminates.
function servePages(...pages) {
    let call = 0;
    supaRec.rpcProvider = () => ({ data: pages[call++] ?? [], error: null });
}

describe('campaignFunnel', () => {
    beforeEach(() => { supaRec.rpcCalls = []; });

    it('maps snake_case RPC columns to numbers, defaulting missing counts to 0', async () => {
        servePages([
            { ad_campaign_id: 'c1', attribution_source: 'Paid Social', practice_id: 'p1',
              leads: '12', booked: '3', attended: '1', patients: '2', new_patients: '2' },
            { ad_campaign_id: null, attribution_source: null, practice_id: null, leads: '5' },
        ], []);
        const rows = await marketingRepository.campaignFunnel(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows[0]).toEqual({
            ad_campaign_id: 'c1', attribution_source: 'Paid Social', practice_id: 'p1',
            leads: 12, booked: 3, attended: 1, patients: 2, newPatients: 2,
        });
        // A group the RPC returned without every count must not become NaN.
        expect(rows[1]).toEqual({
            ad_campaign_id: null, attribution_source: null, practice_id: null,
            leads: 5, booked: 0, attended: 0, patients: 0, newPatients: 0,
        });
    });

    it('passes the org through as p_org — there is no automatic isolation', async () => {
        servePages([]);
        await marketingRepository.campaignFunnel('org-9', AUG_SINCE, AUG_UNTIL, 'prac-2');
        expect(supaRec.rpcCalls[0]).toMatchObject({
            fn: 'ad_campaign_funnel',
            params: { p_org: 'org-9', p_since: AUG_SINCE, p_until: AUG_UNTIL, p_practice: 'prac-2' },
        });
    });

    it('stops on an EMPTY page, not a short one', async () => {
        // A short page must not be treated as the last: the server's cap is its
        // own setting and could sit below PAGE, which would reintroduce the
        // truncation this paging exists to prevent.
        const short = new Array(700).fill(0).map((_, i) => ({ ad_campaign_id: `c${i}`, leads: '1' }));
        servePages(short, []);
        const rows = await marketingRepository.campaignFunnel(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows).toHaveLength(700);
        expect(supaRec.rpcCalls).toHaveLength(2);
    });

    it('orders by the full (ad_campaign_id, attribution_source, practice_id) group key', async () => {
        // The RPC's GROUP BY is the three-column tuple, not ad_campaign_id
        // alone — real data ties on it (every unattributed group shares
        // ad_campaign_id = NULL across several practices/sources). Sorting by
        // one column only would let a page boundary fall inside a tie and
        // duplicate one row while dropping another. Assert all three keys
        // were requested, in order — `mods.order` only ever holds the LAST
        // .order() call, so this reads the accumulated `mods.orders` array.
        servePages([]);
        await marketingRepository.campaignFunnel(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(supaRec.rpcCalls[0].mods.orders).toEqual([
            { col: 'ad_campaign_id', opts: { ascending: true, nullsFirst: true } },
            { col: 'attribution_source', opts: { ascending: true, nullsFirst: true } },
            { col: 'practice_id', opts: { ascending: true, nullsFirst: true } },
        ]);
    });
});

describe('leadsByCampaign booking fields', () => {
    beforeEach(() => { supaRec.rpcCalls = []; });

    it('carries booked_at and attended through to the caller', async () => {
        servePages([{ contact_id: 'x1', booked_at: '2026-07-02T09:00:00Z', attended: true }], []);
        const rows = await marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows[0].booked_at).toBe('2026-07-02T09:00:00Z');
        expect(rows[0].attended).toBe(true);
    });

    it('defaults a missing booked_at to null and attended to false', async () => {
        servePages([{ contact_id: 'x2' }], []);
        const rows = await marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows[0].booked_at).toBeNull();
        expect(rows[0].attended).toBe(false);
    });
});
