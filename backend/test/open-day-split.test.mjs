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

const JULY = { id: 'e-july', name: 'July 26', eventDate: '2026-07-15' };
const APRIL = { id: 'e-april', name: 'April 26', eventDate: '2026-04-18' };

describe('splitByOpenDay', () => {
    it('puts mapped campaigns under their event and leaves the rest always-on', () => {
        const rows = [
            campaign('c1', { spendPence: 10000, leads: 10, booked: 2, accepted: 1 }),
            campaign('c2', { spendPence: 20000, leads: 20, booked: 4, accepted: 2 }),
            campaign('c3', { spendPence: 70000, leads: 30, booked: 6, accepted: 3 }),
        ];
        const out = splitByOpenDay(rows, new Map([['c1', JULY], ['c2', JULY]]));

        expect(out.events).toHaveLength(1);
        expect(out.events[0]).toMatchObject({
            openDayId: 'e-july', name: 'July 26', eventDate: '2026-07-15',
            campaigns: 2, spendPence: 30000, leads: 30, booked: 6, accepted: 3,
        });
        expect(out.openDays).toMatchObject({ spendPence: 30000, leads: 30, booked: 6, accepted: 3 });
        expect(out.alwaysOn).toMatchObject({ spendPence: 70000, leads: 30, booked: 6, accepted: 3 });
    });

    // The claim the page makes in a "= Meta total" row. If this ever fails the
    // page is asserting an identity that is not true.
    it('partitions: always-on plus open days equals the whole, metric for metric', () => {
        const rows = [
            campaign('c1', { spendPence: 1234, impressions: 90, clicks: 9, leads: 7, booked: 3, accepted: 1, paidPence: 500 }),
            campaign('c2', { spendPence: 5678, impressions: 80, clicks: 8, leads: 6, booked: 2, accepted: 2, paidPence: 900 }),
            campaign('c3', { spendPence: 9012, impressions: 70, clicks: 7, leads: 5, booked: 1, accepted: 0, paidPence: 0 }),
            campaign('c4', { spendPence: 3456, impressions: 60, clicks: 6, leads: 4, booked: 0, accepted: 0, paidPence: 0 }),
        ];
        const out = splitByOpenDay(rows, new Map([['c2', JULY], ['c4', APRIL]]));

        for (const k of ['spendPence', 'impressions', 'clicks', 'leads', 'booked', 'accepted', 'paidPence']) {
            const whole = rows.reduce((a, r) => a + r[k], 0);
            expect(out.alwaysOn[k] + out.openDays[k]).toBe(whole);
        }
        // And the events themselves sum to the open-day bucket.
        expect(out.events.reduce((a, e) => a + e.spendPence, 0)).toBe(out.openDays.spendPence);
    });

    it('recomputes each bucket\'s costs from its own totals, never by averaging', () => {
        const rows = [
            campaign('c1', { spendPence: 100000, leads: 4, booked: 2, accepted: 1 }),
            campaign('c2', { spendPence: 60000, leads: 3, booked: 0, accepted: 0 }),
        ];
        const out = splitByOpenDay(rows, new Map([['c1', JULY]]));
        expect(out.events[0].cplPence).toBe(25000);  // £1000 / 4
        expect(out.events[0].cpaPence).toBe(100000); // £1000 / 1
        // A cost per nothing is unknowable, not free.
        expect(out.alwaysOn.cpbPence).toBeNull();
        expect(out.alwaysOn.cpaPence).toBeNull();
    });

    it('orders events newest first, and puts an undated event last rather than dropping it', () => {
        const UNDATED = { id: 'e-x', name: 'Legacy day', eventDate: null };
        const rows = [campaign('c1'), campaign('c2'), campaign('c3')];
        const out = splitByOpenDay(rows, new Map([
            ['c1', APRIL], ['c2', JULY], ['c3', UNDATED],
        ]), { keepEmpty: true });
        expect(out.events.map((e) => e.name)).toEqual(['July 26', 'April 26', 'Legacy day']);
    });

    it('omits an event with no spend and no leads in this window', () => {
        // An org accumulates events forever; one that did nothing in the
        // selected period is noise, not information.
        const rows = [campaign('c1', { spendPence: 5000, leads: 2 }), campaign('c2')];
        const out = splitByOpenDay(rows, new Map([['c1', JULY], ['c2', APRIL]]));
        expect(out.events.map((e) => e.name)).toEqual(['July 26']);
    });

    it('leaves an org that has mapped nothing exactly as it was', () => {
        const rows = [
            campaign('c1', { spendPence: 10000, leads: 5, booked: 1, accepted: 1 }),
            campaign('c2', { spendPence: 20000, leads: 6, booked: 2, accepted: 0 }),
        ];
        const out = splitByOpenDay(rows, new Map());
        expect(out.events).toEqual([]);
        expect(out.openDays).toMatchObject({ spendPence: 0, leads: 0, booked: 0, accepted: 0 });
        expect(out.alwaysOn).toMatchObject({ spendPence: 30000, leads: 11, booked: 3, accepted: 1 });
    });

    it('ignores a mapping for a campaign that has no row in this window', () => {
        // The mapping is historical; the window is not. A mapped campaign that
        // did not run in this period must not invent an empty row.
        const rows = [campaign('c1', { spendPence: 10000, leads: 5 })];
        const out = splitByOpenDay(rows, new Map([['c1', JULY], ['gone', APRIL]]));
        expect(out.events).toHaveLength(1);
        expect(out.events[0].name).toBe('July 26');
    });
});
