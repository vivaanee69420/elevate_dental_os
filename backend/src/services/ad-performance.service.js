// ============================================================================
// Ad performance — one page, two channels, ONE definition of every figure.
//
// The page used to have its own implementation (ad-attribution.service.js) that
// measured acceptance by joining Emergent accepted treatments, while the
// Facebook and Google report pages measured it by settled payments over a
// floor. Two definitions of the same word, and the page's one produced zeros:
// live, Sep 2026, it showed 0 conversions and £0 accepted beside £7,103.97 of
// spend, while Emergent held 10 acceptances that month and the marketing pages
// reported real figures for the same window.
//
// So this delegates instead of re-deriving. Each channel block is the SAME
// service call the corresponding marketing page makes, which is what makes the
// hub and those pages incapable of disagreeing.
//
// The one thing the per-channel reports cannot answer is the cross-channel one:
// how many PEOPLE there were once someone in both Google and Facebook is
// counted once. That needs both ledgers together, and it is the only figure
// computed here rather than delegated.
// ============================================================================
import { facebookReportService } from './facebook-report.service.js';
import { googleReportService } from './google-report.service.js';
import { marketingRepository } from '../repositories/marketing.repository.js';
import { ACCEPTANCE_MIN_PAID_PENCE, eligibleForOutcome } from '../lib/marketing/lead-performance.js';

const CHANNELS = { facebook: facebookReportService, google: googleReportService };
export const CHANNEL_IDS = Object.keys(CHANNELS);

/**
 * One channel's figures, from the service that owns them.
 *
 * Each channel keeps its OWN window and practice filter — the two run on
 * different data with different histories (Meta's deep-grain tables hold a
 * rolling 92 days; Google's do not), so forcing one window on both meant
 * either clamping Google needlessly or showing Facebook a silently clamped
 * window it never asked for.
 */
export async function channelPerformance(orgId, { channel, since, until, practiceId = null }) {
    const svc = CHANNELS[channel];
    if (!svc) throw new Error(`unknown channel: ${channel}`);
    return svc.leadPerformance(orgId, { since, until, practiceId });
}

/** Normalised email, or null. The ONLY key both ledgers share. */
export function emailKey(value) {
    const s = String(value ?? '').trim().toLowerCase();
    return s.includes('@') ? s : null;
}

/**
 * People across both channels, counted once.
 *
 * THE MATCHING PROBLEM, stated rather than hidden: the two ledgers identify a
 * person differently. Meta carries `contact_id` and an email; Google carries
 * `phone10` and an email, because a large share of its leads arrive through
 * CallRail, which has a phone number and no email at all. Email is therefore
 * the only key both sides can be matched on.
 *
 * That makes the overlap a genuine LOWER BOUND, and this returns the size of
 * the blind spot (`unmatchable`) so the page can say how big it is instead of
 * claiming an unqualified number. A Google lead with no email cannot be shown
 * to be the same person as a Meta lead, however likely it is.
 *
 * Within a channel, people are deduped first: one person who filled two forms
 * is one person, and counting them twice here would inflate the group total
 * that exists precisely to avoid double counting.
 */
export function dedupePeople(metaRows, googleRows, includeExisting = false) {
    const keyOf = (r, channel) => {
        const email = emailKey(r.email);
        if (email) return `e:${email}`;
        // No shared key — fall back to the channel's own identity so the person
        // is still counted ONCE within their channel. They can never match
        // across channels, which is what `unmatchable` measures.
        if (channel === 'meta' && r.contact_id) return `m:${r.contact_id}`;
        if (channel === 'google' && r.phone10) return `g:${r.phone10}`;
        return null; // no identity at all — counted, never matched
    };

    const meta = new Map();
    const google = new Map();
    let anonymous = 0;
    const add = (map, rows, channel) => {
        for (const r of rows ?? []) {
            const k = keyOf(r, channel);
            if (!k) { anonymous += 1; continue; }
            const prev = map.get(k);
            // Outcomes are gated by the SAME rule the channel blocks use —
            // eligibleForOutcome, i.e. new patients only unless asked
            // otherwise. Counting booked/accepted here without it would make
            // the group total disagree with the two blocks beneath it on the
            // exact figures they share, which is the class of bug this whole
            // page is being rebuilt to end.
            const counts = eligibleForOutcome(r, includeExisting);
            map.set(k, {
                booked: Boolean(prev?.booked) || (counts && Boolean(r.booked)),
                accepted: Boolean(prev?.accepted) || (counts && Boolean(r.accepted)),
            });
        }
    };
    add(meta, metaRows, 'meta');
    add(google, googleRows, 'google');

    let overlap = 0;
    for (const k of meta.keys()) if (google.has(k)) overlap += 1;

    // Rows that can never take part in a cross-channel match, because they
    // carry no email. Reported so the overlap's caveat is measured.
    const unmatchable =
        (metaRows ?? []).filter((r) => !emailKey(r.email)).length
        + (googleRows ?? []).filter((r) => !emailKey(r.email)).length;

    const people = meta.size + google.size - overlap + anonymous;
    const booked = countWhere(meta, google, (v) => v.booked);
    const accepted = countWhere(meta, google, (v) => v.accepted);
    return {
        people,
        metaPeople: meta.size,
        googlePeople: google.size,
        overlap,
        overlapIsLowerBound: unmatchable > 0,
        unmatchable,
        // Leads with no identifying field at all: counted in the total (they
        // were real enquiries) but never matched.
        anonymous,
        booked,
        accepted,
    };
}

// Union count over both maps without double-counting a shared key.
function countWhere(meta, google, pred) {
    let n = 0;
    for (const [k, v] of meta) if (pred(v)) n += 1;
    for (const [k, v] of google) {
        if (!pred(v)) continue;
        const m = meta.get(k);
        if (m && pred(m)) continue; // already counted
        n += 1;
    }
    return n;
}

/**
 * The deduped group total. Built on the SAME two ledgers the channel blocks
 * are built on, so the page's "the columns do not add up, this is the true
 * figure" claim is arithmetic over one dataset rather than a second
 * computation free to drift from the first.
 */
export async function groupTotal(orgId, { since, until, practiceId = null }) {
    const [metaRows, googleRows] = await Promise.all([
        marketingRepository.metaLeadLedger(orgId, since, until, ACCEPTANCE_MIN_PAID_PENCE)
            .catch(() => null),
        marketingRepository.googleLeadLedger(orgId, since, until, ACCEPTANCE_MIN_PAID_PENCE)
            .catch(() => null),
    ]);
    // A channel that could not be read is UNKNOWN, not empty. Counting it as
    // zero would report a smaller group than really exists and, worse, would
    // report an overlap of zero as though the channels never share anyone.
    if (metaRows === null && googleRows === null) {
        return { state: 'unavailable', reason: 'Neither channel ledger could be read.' };
    }
    const scoped = (rows) => (practiceId ? (rows ?? []).filter((r) => r.practice_id === practiceId) : (rows ?? []));
    return {
        state: 'ok',
        metaAvailable: metaRows !== null,
        googleAvailable: googleRows !== null,
        // BOTH gates, from one read, so the page's new-patients-only toggle
        // costs nothing and the two figures can never be computed differently.
        ...dedupePeople(scoped(metaRows), scoped(googleRows), false),
        all: dedupePeople(scoped(metaRows), scoped(googleRows), true),
    };
}

export const adPerformanceService = { channelPerformance, groupTotal, dedupePeople, emailKey };
