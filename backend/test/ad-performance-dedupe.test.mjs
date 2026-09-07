// The cross-channel group total, and the matching problem it cannot fully solve.
//
// Ad performance previously had its OWN implementation, which measured
// acceptance by joining Emergent accepted treatments while the Facebook and
// Google pages measured it by settled payments over a floor. Two definitions of
// one word, and the page's produced zeros: live, Sep 2026, it read 0
// conversions and £0 accepted beside £7,103.97 of spend while Emergent held 10
// acceptances that month.
//
// The channel blocks now delegate to those services, so they cannot disagree.
// The only figure computed here is the one neither report can answer: how many
// PEOPLE, once someone in both channels is counted once.
import { describe, it, expect } from 'vitest';
import { dedupePeople, emailKey } from '../src/services/ad-performance.service.js';

const meta = (o) => ({ contact_id: null, email: null, booked: false, accepted: false, is_new_patient: true, ...o });
const goog = (o) => ({ phone10: null, email: null, booked: false, accepted: false, is_new_patient: true, ...o });

describe('emailKey', () => {
    it('normalises case and padding, and rejects anything that is not an address', () => {
        expect(emailKey('  A@B.com ')).toBe('a@b.com');
        expect(emailKey('')).toBeNull();
        expect(emailKey(null)).toBeNull();
        // CallRail supplies a phone in the name field on some rows; a bare
        // string must never become a match key or two strangers merge.
        expect(emailKey('07700900123')).toBeNull();
    });
});

describe('dedupePeople', () => {
    it('counts one person once when they appear in BOTH channels', () => {
        const r = dedupePeople(
            [meta({ contact_id: 'c1', email: 'sam@x.com' })],
            [goog({ phone10: '7700900123', email: 'SAM@x.com' })],
        );
        expect(r.overlap).toBe(1);
        expect(r.people).toBe(1);          // not 2 — that is the whole point
        expect(r.metaPeople).toBe(1);
        expect(r.googlePeople).toBe(1);    // the channel columns still say 1 each
    });

    it('counts one person once when they appear TWICE in the same channel', () => {
        // Two form fills is one person. Counting them twice would inflate the
        // very total that exists to stop double counting.
        const r = dedupePeople([
            meta({ contact_id: 'c1', email: 'sam@x.com' }),
            meta({ contact_id: 'c2', email: 'sam@x.com' }),
        ], []);
        expect(r.metaPeople).toBe(1);
        expect(r.people).toBe(1);
    });

    it('keeps a person whose email is missing, matched within their own channel', () => {
        // A Google lead from CallRail has a phone and no email. It is a real
        // enquiry and must be counted — it simply cannot be matched to Meta.
        const r = dedupePeople([], [
            goog({ phone10: '7700900123' }),
            goog({ phone10: '7700900123' }),   // same caller, twice
            goog({ phone10: '7700900999' }),
        ]);
        expect(r.googlePeople).toBe(2);
        expect(r.overlap).toBe(0);
        expect(r.unmatchable).toBe(3);         // three ROWS carry no email
        expect(r.overlapIsLowerBound).toBe(true);
    });

    it('says the overlap is exact when every row carries an email', () => {
        const r = dedupePeople(
            [meta({ contact_id: 'c1', email: 'a@x.com' })],
            [goog({ phone10: '1', email: 'b@x.com' })],
        );
        expect(r.overlap).toBe(0);
        expect(r.unmatchable).toBe(0);
        expect(r.overlapIsLowerBound).toBe(false); // nothing hidden, so say so
    });

    it('counts a lead with NO identity at all, but never matches it', () => {
        const r = dedupePeople([meta({})], [goog({})]);
        expect(r.anonymous).toBe(2);
        expect(r.people).toBe(2);   // both real enquiries
        expect(r.overlap).toBe(0);  // and provably unmatchable
    });

    it('takes the strongest outcome for a person seen twice', () => {
        // One row booked, another not. The person booked.
        const r = dedupePeople([
            meta({ email: 'sam@x.com', booked: false }),
            meta({ email: 'sam@x.com', booked: true }),
        ], []);
        expect(r.booked).toBe(1);
    });

    it('never counts a cross-channel person twice in booked or accepted', () => {
        const r = dedupePeople(
            [meta({ email: 'sam@x.com', booked: true, accepted: true })],
            [goog({ email: 'sam@x.com', booked: true, accepted: true })],
        );
        expect(r.booked).toBe(1);
        expect(r.accepted).toBe(1);
    });

    it('gates outcomes to new patients, exactly as the channel blocks do', () => {
        // eligibleForOutcome is what the Facebook and Google pages apply. Not
        // applying it here would make the group total disagree with the two
        // blocks beneath it on the figures they share — the class of bug this
        // page is being rebuilt to end.
        const rows = [meta({ email: 'sam@x.com', booked: true, accepted: true, is_new_patient: false })];
        expect(dedupePeople(rows, []).booked).toBe(0);
        expect(dedupePeople(rows, [], true).booked).toBe(1);   // including existing
    });

    it('handles both channels being empty without inventing anything', () => {
        const r = dedupePeople([], []);
        expect(r).toMatchObject({ people: 0, overlap: 0, booked: 0, accepted: 0, unmatchable: 0 });
        expect(r.overlapIsLowerBound).toBe(false);
    });

    it('tolerates null row arrays — an unread channel is not an empty one', () => {
        expect(() => dedupePeople(null, null)).not.toThrow();
        expect(dedupePeople(null, null).people).toBe(0);
    });
});

describe('the channel blocks delegate rather than re-derive', () => {
    it('routes each channel to its own report service', async () => {
        // The bug being closed: Ad performance had its OWN acceptance rule
        // (Emergent joins) while the marketing pages used settled payments.
        // Delegation is what makes the two surfaces incapable of disagreeing,
        // so it is asserted rather than assumed.
        const mod = await import('../src/services/ad-performance.service.js');
        expect(mod.CHANNEL_IDS.sort()).toEqual(['facebook', 'google']);
        await expect(
            mod.channelPerformance('org-1', { channel: 'tiktok', since: '2026-01-01', until: '2026-01-31' }),
        ).rejects.toThrow(/unknown channel/i);
    });
});
