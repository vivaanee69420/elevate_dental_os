// ============================================================================
// Accepted-patient counts for the Marketing section, on the SAME rule the
// Facebook and Google report pages use.
//
// THE DEFECT. /marketing/performance — which feeds Marketing > Overview,
// Campaigns and Practices — takes its "Became patients" figure from
// ad_campaign_funnel, where a patient means "this lead matches SOME record in
// Dentally". The Facebook and Google pages take theirs from the per-platform
// lead ledgers, where a patient means "this lead has settled payments above the
// acceptance floor". Same word, two rules, both on screen at once.
//
// Measured live (group, Jun-Aug 2026): the Marketing section reported 729
// patients where the report pages reported 86 — 8.5x apart. That is the exact
// drift migration 000167 was written to close for Facebook; this side never
// moved.
//
// The gate matters as much as the floor: the report pages count an outcome only
// for a NEW patient by default, so Ashford reads 33 accepted where an ungated
// count of the same rows gives 36. Re-expressing that rule here would be a
// second definition free to drift, which is the whole bug — so it is imported.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { summariseAccepted } from '../src/lib/marketing/accepted-ledger.js';

// Rows as the two repository readers return them (snake_case, both platforms).
const lead = (o = {}) => ({
    practice_id: 'p-ash', campaign_id: 'c1',
    booked: false, accepted: false, is_new_patient: true, ...o,
});

describe('summariseAccepted', () => {
    it('counts accepted patients per campaign, per practice and per channel', () => {
        const s = summariseAccepted(
            [lead({ campaign_id: 'g1', accepted: true, booked: true })],
            [lead({ campaign_id: 'm1', accepted: true, booked: true }),
                lead({ campaign_id: 'm1', booked: true })],
        );

        expect(s.total.accepted).toBe(2);
        expect(s.total.leads).toBe(3);
        expect(s.byCampaign.get('g1').accepted).toBe(1);
        expect(s.byCampaign.get('m1').accepted).toBe(1);
        expect(s.byCampaign.get('m1').leads).toBe(2);
        expect(s.byPractice.get('p-ash').accepted).toBe(2);
        expect(s.byChannel.google_ads.accepted).toBe(1);
        expect(s.byChannel.meta_ads.accepted).toBe(1);
    });

    it('counts an outcome only for a new patient, exactly as the report pages do', () => {
        // A returning patient who books and pays is real, and is NOT an
        // acquisition — charging ad spend against them is what makes a cost per
        // patient read cheaper than it is. Ashford: 36 accepted rows, 33 of them
        // new, and the report page shows 33.
        const s = summariseAccepted(
            [lead({ accepted: true, booked: true, is_new_patient: true }),
                lead({ accepted: true, booked: true, is_new_patient: false })],
            [],
        );

        expect(s.total.accepted).toBe(1);
        expect(s.total.booked).toBe(1);
        // Leads are NOT gated — an enquiry is an enquiry whoever it came from.
        expect(s.total.leads).toBe(2);
    });

    it('separates leads that resolve to a campaign from those that do not', () => {
        // A ledger lead with no campaign is still a lead the ads produced; it
        // just cannot be charged to one campaign's spend. It must survive into
        // the totals and stay out of the per-campaign denominators.
        const s = summariseAccepted(
            [lead({ campaign_id: null, accepted: true }), lead({ campaign_id: 'g1', accepted: true })],
            [],
        );

        expect(s.total.accepted).toBe(2);
        expect(s.attributed.accepted).toBe(1);
        expect(s.byCampaign.has('g1')).toBe(true);
        expect(s.byCampaign.has(null)).toBe(false);
    });

    it('keeps a practice-less lead in its own bucket rather than dropping it', () => {
        const s = summariseAccepted([lead({ practice_id: null, accepted: true })], []);

        expect(s.total.accepted).toBe(1);
        expect(s.byPractice.get(null).accepted).toBe(1);
    });

    it('is empty, not broken, when a platform returns nothing', () => {
        const s = summariseAccepted([], []);

        expect(s.total).toEqual({ leads: 0, booked: 0, accepted: 0 });
        expect(s.attributed).toEqual({ leads: 0, booked: 0, accepted: 0 });
        expect(s.byCampaign.size).toBe(0);
        expect(s.byChannel.google_ads.accepted).toBe(0);
    });

    it('tolerates a missing platform entirely', () => {
        // One platform's read failing must not take the other's numbers with it.
        const s = summariseAccepted(null, [lead({ accepted: true })]);

        expect(s.total.accepted).toBe(1);
        expect(s.byChannel.meta_ads.accepted).toBe(1);
        expect(s.byChannel.google_ads.leads).toBe(0);
    });
});
