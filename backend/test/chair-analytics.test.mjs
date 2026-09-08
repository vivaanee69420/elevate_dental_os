// ============================================================================
// chairAnalytics — capacity from the practice's REAL opening hours x its
// chairs, occupancy over the cells actually entered, and money withheld below
// the coverage threshold.
//
// The lineage this replaces took occupancy from the entered cells but capacity
// from chair_config (chairs x 8h x 230 days), so the two described different
// practices and the money was computed off the larger one.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/analytics.service.js')).analyticsService;

const ORG = 'org-aaaaaaaa';
const now = () => new Date(Date.UTC(2026, 4, 15));

// These three are read through the keyset pager, which stops on an EMPTY page.
// A provider that returned the same array for ever would spin, so they yield
// their rows once and then nothing — exactly as Postgres does once the cursor
// passes the last row.
const PAGED = new Set(['practice_chairs', 'practice_opening_hours', 'chair_utilisation']);

function tableProvider(spec) {
    const reads = new Map();
    return (q) => {
        const t = q.table;
        const n = reads.get(t) ?? 0;
        reads.set(t, n + 1);
        // chair_config is read with .maybeSingle(); null makes getChairConfig
        // fall back to the CHAIR_CONFIG defaults (46 weeks, 88%, GBP 300/hr).
        if (t === 'chair_config') return { data: null, error: null };
        const rows = spec[t];
        if (!rows) return { data: [], error: null };
        return { data: PAGED.has(t) && n > 0 ? [] : rows, error: null };
    };
}

beforeEach(() => {
    supaRec.last = undefined;
    supaRec.resultProvider = () => ({ data: [], error: null });
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('chairAnalytics', () => {
    // p1 is open Monday only, 09:00-17:00, with one chair -> 3 open cells.
    // Two are entered, so coverage is 67% and the money figures are computed.
    // p2 has no opening hours at all (the live Warwick Lodge case: no
    // pms_site_id, so no Dentally site).
    const spec = {
        practices: [
            { id: 'p1', name: 'Rochester', chairs: 1, assumed_util_pct: null, kind: 'practice' },
            { id: 'p2', name: 'Warwick Lodge', chairs: 1, assumed_util_pct: null, kind: 'practice' },
        ],
        practice_chairs: [{ id: 'c1', practice_id: 'p1', active: true }],
        practice_opening_hours: [
            { id: 'h1', practice_id: 'p1', weekday: 1, open_minute: 540, close_minute: 1020 },
        ],
        chair_utilisation: [
            { id: 'u1', practice_id: 'p1', chair_id: 'c1', weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 30000 },
            { id: 'u2', practice_id: 'p1', chair_id: 'c1', weekday: 1, slot: 'midday', booked_minutes: 180, revenue_pence: 90000 },
        ],
    };

    const run = async () => {
        supaRec.resultProvider = tableProvider(spec);
        supaRec.rpcProvider = (fn) => (fn === 'settled_revenue_by_practice'
            ? { data: [{ practice_id: 'p1', pence: 231_840_000 }], error: null }
            : { data: [], error: null });
        return svc.chairAnalytics(ORG, { scope: 'all', recoverPctPoints: 10, now });
    };

    it('derives capacity from the opening hours, NOT from chair_config days', async () => {
        const r = await run();
        const p1 = r.practices.find((x) => x.id === 'p1');
        // 300 available min/wk = 5 h -> 5 x 46 weeks = 230 h/yr. The old
        // lineage would have said 1 chair x 8 h x 230 days = 1,840 h.
        expect(p1.capHrsYr).toBe(230);
        expect(p1.bookedHrsYr).toBe(184);
        expect(p1.emptyHrsYr).toBe(46);
        expect(p1.occupancySource).toBe('grid');
    });

    it('occupancy is booked over DERIVED available on the entered cells', async () => {
        const p1 = (await run()).practices.find((x) => x.id === 'p1');
        expect(p1.occupancyPct).toBe(80);
    });

    it('states coverage on every practice row', async () => {
        const p1 = (await run()).practices.find((x) => x.id === 'p1');
        expect(p1.openCells).toBe(3);
        expect(p1.enteredCells).toBe(2);
        expect(p1.coveragePct).toBe(67);
    });

    it('computes money once coverage clears the threshold', async () => {
        const p1 = (await run()).practices.find((x) => x.id === 'p1');
        expect(p1.lostPotentialYrPence).toBe(1380000);  // 46 idle h x GBP 300
        expect(p1.revPerBookedHrPence).toBe(30000);
        expect(p1.recoverRevYrPence).toBe(552000);      // 18.4 h to 88% at own yield
    });

    it('a practice with NO opening hours is null everywhere, never a zero', async () => {
        const p2 = (await run()).practices.find((x) => x.id === 'p2');
        expect(p2.occupancySource).toBe('none');
        expect(p2.hasOpeningHours).toBe(false);
        // null, not 0: "we do not know" is not "there is nothing to lose".
        expect(p2.occupancyPct).toBeNull();
        expect(p2.lostPotentialYrPence).toBeNull();
        expect(p2.recoverRevYrPence).toBeNull();
        expect(p2.coveragePct).toBeNull();
        expect(p2.chairs).toBe(0);
    });

    it('rolls the group up from the summed minutes, and reports the threshold', async () => {
        const r = await run();
        expect(r.group.chairs).toBe(1);
        expect(r.group.capHrsYr).toBe(230);
        expect(r.group.occupancyPct).toBe(80);
        expect(r.group.coveragePct).toBe(67);
        expect(r.group.blendedRevPerBookedHrPence).toBe(30000);
        expect(r.coverageThresholdPct).toBe(50);
        expect(r.ocpspd).toBeNull();
    });

    it('recovery projects from the derived capacity', async () => {
        const r = await run();
        // 230 h capacity, 10-point uplift within a 20-point headroom.
        expect(r.recovery.recoveryHrsYr).toBe(23);
        expect(r.recovery.revenueUnlockedPence).toBe(690000);
        expect(r.recovery.newOccupancyPct).toBe(90);
    });

    it('recovery is NULL when no practice has an occupancy to climb from', async () => {
        supaRec.resultProvider = tableProvider({ practices: spec.practices });
        supaRec.rpcProvider = () => ({ data: [], error: null });
        const r = await svc.chairAnalytics(ORG, { scope: 'all', recoverPctPoints: 10, now });
        // Zeros here would read as "there is nothing to win back", which is the
        // opposite of "we have not been told enough to say".
        expect(r.recovery).toBeNull();
        expect(r.group.occupancyPct).toBeNull();
    });

    it('academy/lab scope -> not applicable, no crash', async () => {
        supaRec.resultProvider = () => ({ data: [{ id: 'acad', name: 'Academy', kind: 'academy' }], error: null });
        const r = await svc.chairAnalytics(ORG, { scope: 'academy', now });
        expect(r.applicable).toBe(false);
        expect(r.scope).toBe('academy');
    });
});
