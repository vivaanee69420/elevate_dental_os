// ============================================================================
// Open days — splitting a Meta campaign list into always-on and per-event.
//
// The page shows "Always-on + Open days = Meta total" as an on-screen sum, so
// the split must be a true PARTITION: every campaign in exactly one bucket,
// nothing counted twice, nothing lost. The database guarantees the input side
// (ad_open_day_campaigns' primary key allows a campaign only one event); these
// pin the arithmetic side.
// ============================================================================
import { describe, it, expect } from 'vitest';

const { splitByOpenDay } = await import('../src/lib/marketing/open-days.js');

// Shaped like campaignLeadPerformance's output, which is what the service feeds in.
const campaign = (id, over = {}) => ({
    campaignId: id, campaignName: `Campaign ${id}`, attributed: true,
    spendPence: 0, impressions: 0, clicks: 0, conversions: 0,
    leads: 0, booked: 0, accepted: 0, paidPence: 0,
    ...over,
});

const lead = (over = {}) => ({
    open_day_id: null, meta_attributed: true,
    booked: false, accepted: false, is_new_patient: true, paid_pence: 0,
    ...over,
});

const EVENTS = [
    { id: 'e-july', name: 'July 26', eventDate: '2026-07-15' },
    { id: 'e-april', name: 'April 26', eventDate: '2026-04-18' },
];

describe('splitByOpenDay', () => {
    it('splits spend by campaign and leads by the pipeline the lead came through', () => {
        const campaigns = [
            campaign('c1', { spendPence: 40000 }),
            campaign('c2', { spendPence: 60000 }),
        ];
        const leads = [
            lead({ open_day_id: 'e-july', booked: true, accepted: true, paid_pence: 9000 }),
            lead({ open_day_id: 'e-july' }),
            lead({}),
        ];
        const out = splitByOpenDay(campaigns, leads, EVENTS, {
            eventByCampaign: new Map([['c1', EVENTS[0]]]),
        });
        expect(out.openDays).toMatchObject({ spendPence: 40000, leads: 2, booked: 1, accepted: 1 });
        expect(out.alwaysOn).toMatchObject({ spendPence: 60000, leads: 1, booked: 0, accepted: 0 });
        expect(out.events[0]).toMatchObject({ name: 'July 26', spendPence: 40000, leads: 2 });
    });

    it('partitions: always-on plus open days equals the whole, metric for metric', () => {
        const campaigns = [
            campaign('c1', { spendPence: 1234, impressions: 90, clicks: 9 }),
            campaign('c2', { spendPence: 5678, impressions: 80, clicks: 8 }),
        ];
        const leads = [
            lead({ open_day_id: 'e-july', booked: true, accepted: true, paid_pence: 500 }),
            lead({ open_day_id: 'e-april', booked: true }),
            lead({ meta_attributed: false }),
            lead({}),
        ];
        const out = splitByOpenDay(campaigns, leads, EVENTS, {
            eventByCampaign: new Map([['c2', EVENTS[0]]]),
        });
        // Spend metrics must sum to the CAMPAIGN rows.
        for (const k of ['spendPence', 'impressions', 'clicks']) {
            expect(out.alwaysOn[k] + out.openDays[k], k)
                .toBe(campaigns.reduce((a, c) => a + c[k], 0));
        }
        // Lead metrics must sum to the LEDGER rows — a different source, which
        // is the whole point of the rework and the thing a single loop over
        // both would have quietly stopped checking.
        expect(out.alwaysOn.leads + out.openDays.leads).toBe(leads.length);
        expect(out.alwaysOn.attributedLeads + out.openDays.attributedLeads)
            .toBe(leads.filter((l) => l.meta_attributed).length);
        expect(out.alwaysOn.booked + out.openDays.booked)
            .toBe(leads.filter((l) => l.booked).length);
    });

    it('counts a lead Meta could not account for, and says so separately', () => {
        const out = splitByOpenDay([], [
            lead({ open_day_id: 'e-july', meta_attributed: false }),
            lead({ open_day_id: 'e-july', meta_attributed: true }),
        ], EVENTS, { eventByCampaign: new Map() });
        expect(out.openDays).toMatchObject({ leads: 2, attributedLeads: 1 });
    });

    it('recomputes each bucket\'s costs from its own totals, never by averaging', () => {
        const out = splitByOpenDay(
            [campaign('c1', { spendPence: 100000 })],
            [lead({ open_day_id: 'e-july', booked: true, accepted: true }),
             lead({ open_day_id: 'e-july' }),
             lead({ open_day_id: 'e-july' }),
             lead({ open_day_id: 'e-july' })],
            EVENTS,
            { eventByCampaign: new Map([['c1', EVENTS[0]]]) },
        );
        expect(out.events[0].cplPence).toBe(25000);   // £1000 / 4
        expect(out.events[0].cpaPence).toBe(100000);  // £1000 / 1
        expect(out.alwaysOn.cpbPence).toBeNull();     // a cost per nothing is unknowable
    });

    it('keeps an event that produced leads but spent nothing this window', () => {
        const out = splitByOpenDay([], [lead({ open_day_id: 'e-april' })], EVENTS, {
            eventByCampaign: new Map(),
        });
        expect(out.events.map((e) => e.name)).toEqual(['April 26']);
        expect(out.events[0]).toMatchObject({ spendPence: 0, leads: 1 });
        expect(out.events[0].cplPence).toBeNull();    // no spend: not "free leads"
    });

    it('keeps an event that spent but produced no leads', () => {
        const out = splitByOpenDay([campaign('c1', { spendPence: 5000 })], [], EVENTS, {
            eventByCampaign: new Map([['c1', EVENTS[0]]]),
        });
        expect(out.events.map((e) => e.name)).toEqual(['July 26']);
        expect(out.events[0]).toMatchObject({ spendPence: 5000, leads: 0 });
    });

    it('omits an event with neither spend nor leads in this window', () => {
        const out = splitByOpenDay([], [], EVENTS, { eventByCampaign: new Map() });
        expect(out.events).toEqual([]);
    });

    it('leaves an org that has mapped nothing exactly as it was', () => {
        const out = splitByOpenDay(
            [campaign('c1', { spendPence: 30000 })],
            [lead({}), lead({ booked: true })],
            [],
            { eventByCampaign: new Map() },
        );
        expect(out.events).toEqual([]);
        expect(out.openDays).toMatchObject({ spendPence: 0, leads: 0 });
        expect(out.alwaysOn).toMatchObject({ spendPence: 30000, leads: 2, booked: 1 });
    });

    it('counts booked and accepted only for new patients unless told otherwise', () => {
        const rows = [
            lead({ open_day_id: 'e-july', booked: true, accepted: true, is_new_patient: true }),
            lead({ open_day_id: 'e-july', booked: true, accepted: true, is_new_patient: false }),
        ];
        const base = { eventByCampaign: new Map() };
        expect(splitByOpenDay([], rows, EVENTS, base).openDays)
            .toMatchObject({ leads: 2, booked: 1, accepted: 1 });
        expect(splitByOpenDay([], rows, EVENTS, { ...base, includeExisting: true }).openDays)
            .toMatchObject({ leads: 2, booked: 2, accepted: 2 });
    });
});
