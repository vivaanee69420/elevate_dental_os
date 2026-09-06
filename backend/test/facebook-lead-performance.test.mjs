// ============================================================================
// Facebook report — CPL/CPB/CPA cards on the SAME definition of an acquired
// patient as the Google report (migration 000167).
//
// Before this, the two pages disagreed. Facebook's `converted` meant "the lead
// resolved to any Dentally patient record"; Google's `accepted` meant "settled
// payments over £40, net of refunds, from the lead's own London day onward".
// Measured live for Jun-Aug 2026: 1,708 Meta leads, 230 booked, 267 patients
// under the matched rule and 33 under the paid one — the page reported MORE
// PATIENTS THAN BOOKINGS, and cost per patient was understated ~8x against the
// Google page beside it.
//
// The load-bearing test in this file is the last one: the cards and the
// per-campaign table must be two views of ONE ledger, so they cannot drift.
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

const { facebookReportService, invalidateMetaLeadPerformanceCache } =
    await import('../src/services/facebook-report.service.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');
const { openDayRepository } = await import('../src/repositories/open-day.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const P1 = 'aaaaaaaa-1111-1111-1111-111111111111';
const P2 = 'bbbbbbbb-2222-2222-2222-222222222222';
const WIN = { since: '2026-06-01', until: '2026-08-31' };

// One connected Meta account, GBP, so the report is never 'not_connected'.
const CONNECTED = [{ customer_id: 'act_1', practice_id: P1, currency_code: 'GBP', name: 'Meta 1' }];

const ledgerRow = (over) => ({
    contact_id: 'c', practice_id: P1, practice_name: 'Rochester',
    campaign_id: 'cmp1', campaign_name: 'Implants', ad_set_id: 'as1', ad_id: 'ad1',
    lead_at: '2026-06-10T09:00:00Z', name: 'A B', email: 'a@b.dev', treatment: null,
    booked: false, accepted: false, is_new_patient: true, paid_pence: 0,
    open_day_id: null, meta_attributed: true,
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    // The cards' reads are cached for a minute, keyed by org+window — and
    // every test here uses the same org and window, so without this each test
    // after the first would silently assert against the first one's rows.
    invalidateMetaLeadPerformanceCache();
    marketingRepository.adAccountsForProvider.mockResolvedValue(CONNECTED);
    marketingRepository.hasProviderMetrics.mockResolvedValue(true);
    marketingRepository.hasGrainMetrics.mockResolvedValue(true);
    marketingRepository.adSpendByPractice.mockResolvedValue([]);
    marketingRepository.metaLeadLedger.mockResolvedValue([]);
    // An org that has never recorded an open day — the default, and the state
    // every existing tenant is in.
    openDayRepository.list.mockResolvedValue([]);
    openDayRepository.mappings.mockResolvedValue([]);
});

describe('facebookReportService.leadPerformance', () => {
    it('divides this practice\'s Meta spend by its own leads, bookings and accepted patients', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 100000, impressions: 5000, clicks: 200 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ booked: true, accepted: true, paid_pence: 20000 }),
            ledgerRow({ booked: true }),
            ledgerRow({}),
            ledgerRow({}),
        ]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.state).toBe('ok');
        const row = out.practices.find((p) => p.practiceId === P1);
        expect(row).toMatchObject({ leads: 4, booked: 2, accepted: 1, spendPence: 100000 });
        expect(row.cplPence).toBe(25000);   // £1000 / 4
        expect(row.cpbPence).toBe(50000);   // £1000 / 2
        expect(row.cpaPence).toBe(100000);  // £1000 / 1
    });

    it('reports a cost per nothing as null, never £0.00', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 100000, impressions: 10, clicks: 1 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([ledgerRow({})]); // a lead, no booking, no payment
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        const row = out.practices.find((p) => p.practiceId === P1);
        expect(row.cplPence).toBe(100000);
        expect(row.cpbPence).toBeNull();
        expect(row.cpaPence).toBeNull();
    });

    it('counts only new patients by default, and every match under the toggle', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 50000, impressions: 1, clicks: 1 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ booked: true, accepted: true, is_new_patient: true }),
            ledgerRow({ booked: true, accepted: true, is_new_patient: false }),
        ]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.total).toMatchObject({ leads: 2, booked: 1, accepted: 1 });
        expect(out.totalAll).toMatchObject({ leads: 2, booked: 2, accepted: 2 });
    });

    it('keeps a practice with spend but no leads, rather than dropping it', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P2, practice_name: 'Barnet', spend_pence: 70000, impressions: 9, clicks: 2 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        const row = out.practices.find((p) => p.practiceId === P2);
        expect(row).toMatchObject({ leads: 0, spendPence: 70000 });
        expect(row.cplPence).toBeNull(); // spend bought nothing measurable, not "free leads"
    });

    it('narrows both spend and leads when one practice is selected', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 100000, impressions: 1, clicks: 1 },
            { practice_id: P2, practice_name: 'Barnet', spend_pence: 900000, impressions: 1, clicks: 1 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ practice_id: P1 }),
            ledgerRow({ practice_id: P2 }), ledgerRow({ practice_id: P2 }),
        ]);
        const out = await facebookReportService.leadPerformance(ORG, { ...WIN, practiceId: P1 });
        // Barnet's spend must not be divided by Rochester's leads.
        expect(out.practices).toHaveLength(1);
        expect(out.total).toMatchObject({ leads: 1, spendPence: 100000 });
    });

    it('says not_connected, and asks the database for nothing, when no Meta account exists', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.state).toBe('not_connected');
        expect(out.practices).toEqual([]);
        expect(out.total).toBeNull();
        expect(marketingRepository.metaLeadLedger).not.toHaveBeenCalled();
    });

    it('publishes the acceptance floor, so the page can state the threshold it used', async () => {
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.acceptanceMinPaidPence).toBe(4000);
        expect(marketingRepository.metaLeadLedger)
            .toHaveBeenCalledWith(ORG, expect.anything(), expect.anything(), 4000);
    });

    // The one that stops the regression this whole change exists to fix: the
    // cards and the per-campaign table must be two views of ONE ledger. If a
    // later edit re-derives either side from ad_meta_funnel's `converted`,
    // these totals diverge and this fails.
    it('reconciles the per-campaign table to the cards above it', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 100000, impressions: 1, clicks: 1 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ campaign_id: 'cmp1', booked: true, accepted: true, paid_pence: 9000 }),
            ledgerRow({ campaign_id: 'cmp2', booked: true }),
            ledgerRow({ campaign_id: 'cmp2' }),
        ]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        const sum = (k) => out.campaigns.reduce((a, c) => a + c[k], 0);
        expect(sum('leads')).toBe(out.total.leads);
        expect(sum('booked')).toBe(out.total.booked);
        expect(sum('accepted')).toBe(out.total.accepted);
    });
});


// ============================================================================
// Open days (migration 000168). A tenant that maps nothing must see today's
// page unchanged; one that maps campaigns gets them carved out of always-on
// into named events, with the two buckets still summing to the whole.
// ============================================================================
describe('facebookReportService.leadPerformance — open days', () => {
    const spend = () => marketingRepository.adSpendByPractice.mockResolvedValue([
        { practice_id: P1, practice_name: 'Rochester', spend_pence: 100000, impressions: 10, clicks: 5 },
    ]);
    // Campaign-grain spend, which is what the split actually buckets.
    const campaignSpend = (rows) => marketingRepository.campaignSpendByProvider.mockResolvedValue(rows);

    it('leaves an org that has mapped nothing exactly as it was', async () => {
        spend();
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ campaign_id: 'c1', booked: true, accepted: true, paid_pence: 9000 }),
        ]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.openDays.events).toEqual([]);
        expect(out.openDays.openDays).toMatchObject({ spendPence: 0, leads: 0, booked: 0, accepted: 0 });
        // Always-on IS the whole thing when nothing is carved out.
        expect(out.openDays.alwaysOn.leads).toBe(out.total.leads);
        expect(out.openDays.alwaysOn.accepted).toBe(out.total.accepted);
    });

    it('carves a mapped campaign out of always-on into its named event', async () => {
        spend();
        campaignSpend([
            { campaign_id: 'c1', campaign_name: 'Open Day July', spend_pence: 40000, impressions: 4, clicks: 2, conversions: 0 },
            { campaign_id: 'c2', campaign_name: 'Always On', spend_pence: 60000, impressions: 6, clicks: 3, conversions: 0 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([
            // Its own pipeline routes it to the event, same as the campaign
            // it happens to be Meta-attributed to — spend and leads carve
            // out together only when both agree, which this row does.
            ledgerRow({ campaign_id: 'c1', open_day_id: 'e1', booked: true, accepted: true, paid_pence: 9000 }),
            ledgerRow({ campaign_id: 'c2' }),
            ledgerRow({ campaign_id: 'c2', booked: true }),
        ]);
        openDayRepository.list.mockResolvedValue([{ id: 'e1', name: 'July 26', eventDate: '2026-07-15' }]);
        openDayRepository.mappings.mockResolvedValue([
            { openDayId: 'e1', campaignId: 'c1', customerId: 'act_1' },
        ]);

        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.openDays.events).toHaveLength(1);
        expect(out.openDays.events[0]).toMatchObject({
            name: 'July 26', eventDate: '2026-07-15', campaigns: 1,
            spendPence: 40000, leads: 1, booked: 1, accepted: 1,
        });
        expect(out.openDays.alwaysOn).toMatchObject({ spendPence: 60000, leads: 2, booked: 1, accepted: 0 });
    });

    // The identity the page prints as a "= Meta total" row.
    it('always-on plus open days equals the cards, metric for metric', async () => {
        spend();
        campaignSpend([
            { campaign_id: 'c1', campaign_name: 'A', spend_pence: 40000, impressions: 4, clicks: 2, conversions: 0 },
            { campaign_id: 'c2', campaign_name: 'B', spend_pence: 60000, impressions: 6, clicks: 3, conversions: 0 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ campaign_id: 'c1', booked: true, accepted: true, paid_pence: 9000 }),
            ledgerRow({ campaign_id: 'c2', booked: true }),
            ledgerRow({ campaign_id: 'c2' }),
        ]);
        openDayRepository.list.mockResolvedValue([{ id: 'e1', name: 'July 26', eventDate: '2026-07-15' }]);
        openDayRepository.mappings.mockResolvedValue([{ openDayId: 'e1', campaignId: 'c1', customerId: 'act_1' }]);

        const out = await facebookReportService.leadPerformance(ORG, WIN);
        const { alwaysOn, openDays } = out.openDays;
        for (const k of ['leads', 'booked', 'accepted']) {
            expect(alwaysOn[k] + openDays[k]).toBe(out.total[k]);
        }
        // Spend reconciles to the campaign-grain total, which is what the
        // split buckets — the cards' practice-grain spend is a separate read.
        expect(alwaysOn.spendPence + openDays.spendPence).toBe(100000);
    });

    it('counts the practices that ran an event, from the account each campaign belongs to', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act_1', practice_id: P1, currency_code: 'GBP', name: 'Rochester' },
            { customer_id: 'act_2', practice_id: P2, currency_code: 'GBP', name: 'Barnet' },
        ]);
        spend();
        campaignSpend([
            { campaign_id: 'c1', campaign_name: 'A', spend_pence: 10000, impressions: 1, clicks: 1, conversions: 0 },
            { campaign_id: 'c2', campaign_name: 'B', spend_pence: 10000, impressions: 1, clicks: 1, conversions: 0 },
        ]);
        marketingRepository.metaLeadLedger.mockResolvedValue([ledgerRow({ campaign_id: 'c1' })]);
        openDayRepository.list.mockResolvedValue([{ id: 'e1', name: 'July 26', eventDate: '2026-07-15' }]);
        openDayRepository.mappings.mockResolvedValue([
            { openDayId: 'e1', campaignId: 'c1', customerId: 'act_1' },
            { openDayId: 'e1', campaignId: 'c2', customerId: 'act_2' },
        ]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.openDays.events[0]).toMatchObject({ campaigns: 2, practices: 2 });
    });

    it('asks for open days only once it knows the org has a Meta account', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.state).toBe('not_connected');
        expect(out.openDays).toMatchObject({ events: [] });
        expect(openDayRepository.mappings).not.toHaveBeenCalled();
    });
});

describe('facebookReportService.leadPerformance — GHL pool and coverage', () => {
    it('buckets a lead by its own open_day_id, not by its campaign', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 100000, impressions: 1, clicks: 1 },
        ]);
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'c1', campaign_name: 'Always On', spend_pence: 100000, impressions: 1, clicks: 1, conversions: 0 },
        ]);
        // Attributed to an ALWAYS-ON campaign, but arrived through an
        // open-day pipeline: the pipeline wins.
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ campaign_id: 'c1', open_day_id: 'e1', meta_attributed: true }),
        ]);
        openDayRepository.list.mockResolvedValue([{ id: 'e1', name: 'July 26', eventDate: '2026-07-15' }]);
        openDayRepository.mappings.mockResolvedValue([]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.openDays.openDays.leads).toBe(1);
        expect(out.openDays.alwaysOn.leads).toBe(0);
        // Its SPEND is still always-on: no campaign is mapped to the event.
        expect(out.openDays.alwaysOn.spendPence).toBe(100000);
    });

    it('publishes how many leads sit in pipelines nobody has categorised', async () => {
        marketingRepository.uncategorisedLeadCounts.mockResolvedValue({
            leads: 1251, attributed: 209,
        });
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.coverage).toEqual({
            uncategorisedLeads: 1251, uncategorisedAttributedLeads: 209,
        });
    });

    // The spec's requirement: an org with nothing mapped must get an empty
    // report that says WHY, not a zeroed one that looks healthy.
    it('an org with no categorised pipelines reports zero leads and names the reason', async () => {
        marketingRepository.metaLeadLedger.mockResolvedValue([]);
        marketingRepository.uncategorisedLeadCounts.mockResolvedValue({
            leads: 640, attributed: 91,
        });
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 50000, impressions: 1, clicks: 1 },
        ]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.total.leads).toBe(0);
        // Spend with no leads is a real state, so the cost is unknowable, not free.
        expect(out.total.cplPence).toBeNull();
        expect(out.coverage.uncategorisedLeads).toBe(640);
    });
});
