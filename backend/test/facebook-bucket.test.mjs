// ============================================================================
// Facebook report — the always-on / open-days page filter.
//
// The owner asked for open days and regular campaigns to be separable
// EVERYWHERE on the Facebook page, not only in the split rows under the cards.
// One `bucket` parameter does it, applied server-side so the partition rule
// lives in ONE place (lib/marketing/open-days.js) rather than being
// re-implemented in five components free to drift apart.
//
// The load-bearing tests here are the PARTITION ones: for every surface,
// alwaysOn + openDays must equal all, metric for metric. That identity is what
// makes the filter trustworthy — a bucket that quietly loses rows would look
// exactly like a bucket that correctly has none.
//
// THE TWO SIDES BUCKET DIFFERENTLY, ON PURPOSE, and one test pins it:
// spend's event comes from its META CAMPAIGN (ad_open_day_campaigns), a lead's
// from its GOHIGHLEVEL PIPELINE (ad_open_day_pipelines). That is the rule
// splitByOpenDay has used since 000171; deriving one from the other is what
// would put a lead in the wrong bucket.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: {
        adAccountsForProvider: vi.fn(),
        adSpendByPractice: vi.fn(),
        metaLeadLedger: vi.fn(),
        metaFunnel: vi.fn(),
        hasProviderMetrics: vi.fn(),
        hasGrainMetrics: vi.fn(),
        campaignSpendByProvider: vi.fn(() => Promise.resolve([])),
        uncategorisedLeadCounts: vi.fn(() => Promise.resolve({ leads: 0, attributed: 0 })),
    },
}));
vi.mock('../src/repositories/open-day.repository.js', () => ({
    openDayRepository: { list: vi.fn(), mappings: vi.fn() },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad'],
    adGrainRepository: { rollup: vi.fn(() => Promise.resolve([])) },
}));

const { facebookReportService, invalidateMetaLeadPerformanceCache, invalidateFunnelCache } =
    await import('../src/services/facebook-report.service.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');
const { openDayRepository } = await import('../src/repositories/open-day.repository.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');
const { AD_BUCKETS, campaignBucketFilter, leadBucketFilter } =
    await import('../src/lib/marketing/open-days.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '99999999-9999-9999-9999-999999999999';
const P1 = 'aaaaaaaa-1111-1111-1111-111111111111';
const P2 = 'bbbbbbbb-2222-2222-2222-222222222222';
const WIN = { since: '2026-06-01', until: '2026-08-31' };
const EVENT = { id: 'e-july', name: 'July 26', eventDate: '2026-07-15' };

const CONNECTED = [
    { customer_id: 'act_1', practice_id: P1, currency_code: 'GBP', name: 'Meta 1' },
    { customer_id: 'act_2', practice_id: P2, currency_code: 'GBP', name: 'Meta 2' },
];

const ledgerRow = (over) => ({
    contact_id: 'c', practice_id: P1, practice_name: 'Rochester',
    campaign_id: 'cmp-open', campaign_name: 'Open day July', ad_set_id: 'as1', ad_id: 'ad1',
    lead_at: '2026-06-10T09:00:00Z', name: 'A B', email: 'a@b.dev', treatment: null,
    booked: false, accepted: false, is_new_patient: true, paid_pence: 0,
    open_day_id: null, meta_attributed: true,
    ...over,
});

// ad_metrics campaign x day rows, as campaignSpendByProvider returns them.
const spendDay = (campaignId, over = {}) => ({
    id: `${campaignId}-1`, customer_id: 'act_1', campaign_id: campaignId,
    campaign_name: `Campaign ${campaignId}`, campaign_status: 'ACTIVE',
    metric_date: '2026-06-10', practice_id: P1,
    impressions: 100, clicks: 10, spend_pence: 1000, conversions: 0,
    ...over,
});

const grainRow = (entityId, campaignId, over = {}) => ({
    entity_id: entityId, entity_name: `Entity ${entityId}`, parent_id: campaignId,
    campaign_id: campaignId, campaign_name: `Campaign ${campaignId}`, entity_status: 'ACTIVE',
    spend_pence: 1000, impressions: 100, clicks: 10, conversions: 0,
    ...over,
});

const funnelRow = (over = {}) => ({
    campaign_id: 'cmp-open', ad_set_id: 'as1', ad_id: 'ad1', practice_id: P1,
    leads: 1, booked: 0, attended: 0, patients: 0, new_patients: 0,
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    invalidateMetaLeadPerformanceCache();
    invalidateFunnelCache();
    marketingRepository.adAccountsForProvider.mockResolvedValue(CONNECTED);
    marketingRepository.hasProviderMetrics.mockResolvedValue(true);
    marketingRepository.hasGrainMetrics.mockResolvedValue(true);
    marketingRepository.adSpendByPractice.mockResolvedValue([]);
    marketingRepository.metaLeadLedger.mockResolvedValue([]);
    marketingRepository.metaFunnel.mockResolvedValue([]);
    marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
    adGrainRepository.rollup.mockResolvedValue([]);
    openDayRepository.list.mockResolvedValue([]);
    openDayRepository.mappings.mockResolvedValue([]);
});

// One event, one mapped campaign ('cmp-open'), one unmapped ('cmp-always').
function withOneOpenDay() {
    openDayRepository.list.mockResolvedValue([EVENT]);
    openDayRepository.mappings.mockResolvedValue([
        { campaignId: 'cmp-open', customerId: 'act_1', openDayId: EVENT.id },
    ]);
}

describe('bucket predicates', () => {
    it('offers exactly the three buckets the page can ask for', () => {
        expect(AD_BUCKETS).toEqual(['all', 'alwaysOn', 'openDays']);
    });

    it('treats a campaign with no event as always-on — that IS the definition', () => {
        const byCampaign = new Map([['cmp-open', EVENT]]);
        expect(campaignBucketFilter('openDays', byCampaign)('cmp-open')).toBe(true);
        expect(campaignBucketFilter('openDays', byCampaign)('cmp-always')).toBe(false);
        expect(campaignBucketFilter('alwaysOn', byCampaign)('cmp-always')).toBe(true);
        expect(campaignBucketFilter('alwaysOn', byCampaign)('cmp-open')).toBe(false);
    });

    it('keeps a null campaign id in always-on rather than dropping it', () => {
        // A lead Meta cannot account for still exists and still cost money to
        // acquire. Dropping it from BOTH buckets would break the partition.
        const f = campaignBucketFilter('alwaysOn', new Map([['cmp-open', EVENT]]));
        expect(f(null)).toBe(true);
        expect(campaignBucketFilter('openDays', new Map())(null)).toBe(false);
    });

    it('lets everything through for the "all" bucket, and for an unknown value', () => {
        for (const b of ['all', undefined, null, 'nonsense']) {
            expect(campaignBucketFilter(b, new Map())('anything')).toBe(true);
            expect(leadBucketFilter(b, new Set())({ open_day_id: 'e-july' })).toBe(true);
        }
    });

    it('counts a lead whose event no longer exists as always-on', () => {
        // Matches splitByOpenDay's own `byEvent.has(id)` guard: an event that
        // has been deleted must not silently take leads out of both buckets.
        const live = new Set([EVENT.id]);
        expect(leadBucketFilter('alwaysOn', live)({ open_day_id: 'e-deleted' })).toBe(true);
        expect(leadBucketFilter('openDays', live)({ open_day_id: 'e-deleted' })).toBe(false);
        expect(leadBucketFilter('openDays', live)({ open_day_id: EVENT.id })).toBe(true);
    });
});

describe('leadPerformance bucket', () => {
    beforeEach(() => {
        withOneOpenDay();
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 30000, impressions: 900, clicks: 90 },
        ]);
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            spendDay('cmp-open', { spend_pence: 20000, impressions: 600, clicks: 60 }),
            spendDay('cmp-always', { spend_pence: 10000, impressions: 300, clicks: 30 }),
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([
            // Open-day pipeline, booked and paid.
            ledgerRow({ open_day_id: EVENT.id, booked: true, accepted: true, paid_pence: 15000 }),
            ledgerRow({ open_day_id: EVENT.id }),
            // Always-on.
            ledgerRow({ campaign_id: 'cmp-always', booked: true }),
            ledgerRow({ campaign_id: 'cmp-always' }),
        ]);
    });

    const call = (bucket) => facebookReportService.leadPerformance(ORG, { ...WIN, bucket });

    it('partitions the totals: always-on plus open days equals all, metric for metric', async () => {
        const [all, on, od] = [await call('all'), await call('alwaysOn'), await call('openDays')];
        for (const k of ['spendPence', 'impressions', 'clicks', 'leads', 'booked', 'accepted']) {
            expect(`${k}=${on.total[k] + od.total[k]}`).toBe(`${k}=${all.total[k]}`);
        }
    });

    it('partitions the per-practice rows too, so the breakdown reconciles to the cards', async () => {
        const [all, on, od] = [await call('all'), await call('alwaysOn'), await call('openDays')];
        const spendOf = (out) => (out.practices.find((p) => p.practiceId === P1)?.spendPence ?? 0);
        expect(spendOf(on) + spendOf(od)).toBe(spendOf(all));
        const leadsOf = (out) => (out.practices.find((p) => p.practiceId === P1)?.leads ?? 0);
        expect(leadsOf(on) + leadsOf(od)).toBe(leadsOf(all));
    });

    it('keeps the practice NAME when a bucket is selected', async () => {
        // Bucketed practice spend is rebuilt from campaign-grain rows, which
        // carry no practice_name. A nameless row renders as a blank heading.
        const od = await call('openDays');
        expect(od.practices.find((p) => p.practiceId === P1)?.practiceName).toBe('Rochester');
    });

    it('buckets SPEND by campaign and LEADS by pipeline — they are different questions', async () => {
        // This lead sits in an open-day pipeline but Meta attributed it to the
        // always-on campaign. It is an open-day lead; its spend is not.
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ campaign_id: 'cmp-always', open_day_id: EVENT.id }),
        ]);
        invalidateMetaLeadPerformanceCache();
        const od = await call('openDays');
        expect(od.total.leads).toBe(1);
        expect(od.total.spendPence).toBe(20000);   // cmp-open only
    });

    it('returns null costs, never £0.00, for a bucket with no spend', async () => {
        openDayRepository.mappings.mockResolvedValue([]);   // nothing mapped
        invalidateMetaLeadPerformanceCache();
        const od = await call('openDays');
        expect(od.total?.spendPence ?? 0).toBe(0);
        expect(od.total?.cplPence ?? null).toBeNull();
        expect(od.total?.cpaPence ?? null).toBeNull();
    });

    it('leaves an org with no open days identical between all and alwaysOn', async () => {
        openDayRepository.list.mockResolvedValue([]);
        openDayRepository.mappings.mockResolvedValue([]);
        invalidateMetaLeadPerformanceCache();
        const [all, on] = [await call('all'), await call('alwaysOn')];
        expect(on.total).toEqual(all.total);
        expect(on.campaigns).toEqual(all.campaigns);
        expect(on.leads.length).toBe(all.leads.length);
    });

    it('filters the lead drill-down to the bucket, and names the event on each row', async () => {
        const od = await call('openDays');
        expect(od.leads).toHaveLength(2);
        expect(od.leads.every((l) => l.open_day_id === EVENT.id)).toBe(true);
        expect(od.leads[0].open_day_name).toBe('July 26');
        const on = await call('alwaysOn');
        expect(on.leads).toHaveLength(2);
        expect(on.leads.every((l) => l.open_day_id === null)).toBe(true);
    });

    it('does not call a full window empty just because the bucket is', async () => {
        // The window has spend AND leads; the open-days bucket has neither
        // because nothing is mapped to the event yet. Reporting the
        // never_synced/no_spend_in_window family here would blame the sync
        // for a filter — the same false alarm the tabs guard against.
        openDayRepository.mappings.mockResolvedValue([]);
        marketingRepository.metaLeadLedger.mockResolvedValue([ledgerRow({ campaign_id: 'cmp-always' })]);
        invalidateMetaLeadPerformanceCache();
        const od = await call('openDays');
        expect(od.state).toBe('ok');
        expect(od.total.leads).toBe(0);
        expect(marketingRepository.hasProviderMetrics).not.toHaveBeenCalled();
    });

    it('decides "the window is empty" from the WINDOW, never from the filtered rows', async () => {
        // No spend rows at all, but the window does hold a lead — an
        // always-on one. Asking for open days must not make the whole payload
        // collapse into the not-connected/never-synced shape, which drops the
        // per-practice rows and the campaign table with it. The emptiness
        // test has to read the unfiltered window or the bucket decides it.
        marketingRepository.adSpendByPractice.mockResolvedValue([]);
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        marketingRepository.metaLeadLedger.mockResolvedValue([ledgerRow({ campaign_id: 'cmp-always' })]);
        invalidateMetaLeadPerformanceCache();
        const od = await call('openDays');
        expect(od.state).toBe('ok');
        expect(marketingRepository.hasProviderMetrics).not.toHaveBeenCalled();
    });

    it('reads only the caller\'s organisation whatever the bucket', async () => {
        await facebookReportService.leadPerformance(ORG, { ...WIN, bucket: 'openDays' });
        for (const fn of [openDayRepository.list, openDayRepository.mappings]) {
            for (const c of fn.mock.calls) expect(c[0]).toBe(ORG);
        }
        expect(marketingRepository.metaLeadLedger.mock.calls.every((c) => c[0] === ORG)).toBe(true);
        expect(marketingRepository.campaignSpendByProvider.mock.calls.every((c) => c[0] === ORG)).toBe(true);
        expect(JSON.stringify(marketingRepository.metaLeadLedger.mock.calls)).not.toContain(OTHER_ORG);
    });
});

describe('tab buckets', () => {
    beforeEach(() => {
        withOneOpenDay();
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            spendDay('cmp-open', { spend_pence: 20000 }),
            spendDay('cmp-always', { spend_pence: 10000 }),
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([
            funnelRow({ campaign_id: 'cmp-open', leads: 3, booked: 1 }),
            funnelRow({ campaign_id: 'cmp-always', ad_set_id: 'as2', ad_id: 'ad2', leads: 2 }),
        ]);
        adGrainRepository.rollup.mockResolvedValue([
            grainRow('as1', 'cmp-open', { spend_pence: 20000 }),
            grainRow('as2', 'cmp-always', { spend_pence: 10000 }),
        ]);
    });

    it('splits the Campaigns tab, and the two buckets sum to the unfiltered total', async () => {
        const all = await facebookReportService.campaigns(ORG, { ...WIN, bucket: 'all' });
        const on = await facebookReportService.campaigns(ORG, { ...WIN, bucket: 'alwaysOn' });
        const od = await facebookReportService.campaigns(ORG, { ...WIN, bucket: 'openDays' });
        expect(od.rows.map((r) => r.id)).toEqual(['cmp-open']);
        expect(on.rows.map((r) => r.id)).toEqual(['cmp-always']);
        expect(on.totals.spendPence + od.totals.spendPence).toBe(all.totals.spendPence);
        expect(on.totals.leads + od.totals.leads).toBe(all.totals.leads);
    });

    it('splits the Ad sets tab by the campaign each ad set belongs to', async () => {
        const od = await facebookReportService.adSets(ORG, { ...WIN, bucket: 'openDays' });
        expect(od.rows.map((r) => r.id)).toEqual(['as1']);
        const on = await facebookReportService.adSets(ORG, { ...WIN, bucket: 'alwaysOn' });
        expect(on.rows.map((r) => r.id)).toEqual(['as2']);
    });

    it('splits the Ads tab the same way', async () => {
        const od = await facebookReportService.ads(ORG, { ...WIN, bucket: 'openDays' });
        expect(od.rows.map((r) => r.id)).toEqual(['as1']);
        const on = await facebookReportService.ads(ORG, { ...WIN, bucket: 'alwaysOn' });
        expect(on.rows.map((r) => r.id)).toEqual(['as2']);
    });

    it('does not ask for open-day mappings at all on the default unfiltered path', async () => {
        // A round trip that can only ever be discarded. The tabs are the
        // page's hot path; 'all' must cost exactly what it costs today.
        await facebookReportService.campaigns(ORG, { ...WIN });
        expect(openDayRepository.mappings).not.toHaveBeenCalled();
    });

    it('says the BUCKET is empty, never that the sync is broken', async () => {
        // The tenant syncs fine and has spend in the window — it is the
        // filter that emptied the table. Falling through to emptyWindowState
        // here would tell them "no Meta spend in the selected period" beside
        // a period that plainly has some, or worse, on the deep-grain tabs,
        // that their ad-set sync has never run. Both are false alarms about
        // infrastructure, raised by a filter the reader chose.
        marketingRepository.campaignSpendByProvider.mockResolvedValue([spendDay('cmp-always')]);
        adGrainRepository.rollup.mockResolvedValue([grainRow('as2', 'cmp-always')]);
        invalidateFunnelCache();
        for (const out of [
            await facebookReportService.campaigns(ORG, { ...WIN, bucket: 'openDays' }),
            await facebookReportService.adSets(ORG, { ...WIN, bucket: 'openDays' }),
            await facebookReportService.ads(ORG, { ...WIN, bucket: 'openDays' }),
        ]) {
            expect(out.state).toBe('empty_bucket');
            expect(out.rows).toEqual([]);
        }
        expect(marketingRepository.hasProviderMetrics).not.toHaveBeenCalled();
        expect(marketingRepository.hasGrainMetrics).not.toHaveBeenCalled();
    });

    it('still reports a genuinely unsynced tenant honestly under a bucket', async () => {
        // The other side of the same coin: when there is nothing in the
        // window AT ALL, the bucket is not the reason and must not be blamed.
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        adGrainRepository.rollup.mockResolvedValue([]);
        marketingRepository.hasProviderMetrics.mockResolvedValue(false);
        invalidateFunnelCache();
        const out = await facebookReportService.campaigns(ORG, { ...WIN, bucket: 'openDays' });
        expect(out.state).toBe('never_synced');
    });

    it('scopes the leads that fall outside the bucket to that bucket too', async () => {
        // unmatchedLeads is a statement about THIS view's coverage. Left
        // unfiltered it would report the other bucket's leads as missing from
        // a table that was never supposed to show them.
        marketingRepository.campaignSpendByProvider.mockResolvedValue([spendDay('cmp-open', { spend_pence: 20000 })]);
        invalidateFunnelCache();
        const od = await facebookReportService.campaigns(ORG, { ...WIN, bucket: 'openDays' });
        expect(od.unmatchedLeads).toBeNull();
    });
});
