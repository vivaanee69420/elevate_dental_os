// ============================================================================
// How much of a reporting window is actually complete.
//
// Ad spend is pulled by a nightly sync, so the CURRENT day is only ever
// captured up to the moment that sync ran. On 6 Sept 2026 the sync last wrote
// at 02:50 UTC, so the day held GBP 68.04 against a GBP ~720 daily average —
// and the Facebook report rendered that as a finished total. Cross-checked
// against Meta Ads Manager every campaign was short by 13-18%, and impressions
// were short by the same fraction, because whole hours were missing rather
// than any figure being computed wrongly.
//
// A partial day is not a bug to hide; it is a fact to state. This decides
// which days a reader can trust, so the page can say so.
// ============================================================================
import { londonYmd } from "../tz.js";

// The day before the one the sync ran in. A sync that ran at 02:50 on the 6th
// captured under three hours of the 6th, so the 6th is partial and the 5th is
// the last day anyone should treat as final.
//
// Deliberately NOT "assume the sync completed the previous day": if the feed
// has been down for a week, `latestDay` is what caps completeness, not the
// clock. Whichever is earlier wins.
function previousDay(ymd) {
    const d = new Date(`${ymd}T12:00:00Z`);   // midday, so a DST shift cannot roll the date
    d.setUTCDate(d.getUTCDate() - 1);
    return londonYmd(d);
}

/**
 * @param {object} args
 * @param {string|Date|null} args.syncedAt  when ad_metrics was last written for this provider
 * @param {string|null} args.latestDay      the newest metric_date held (YYYY-MM-DD)
 * @param {string|null} args.until          the window's inclusive last day (YYYY-MM-DD)
 * @returns {{syncedAt: string|null, completeTo: string|null, partial: boolean}}
 *   `completeTo` is the last day whose figures are final. `partial` says the
 *   requested window runs past it, so what the reader is looking at understates
 *   the truth. Both are null when nothing has ever synced — a state the caller
 *   must render as "no data", never as "complete".
 */
export function spendFreshness({ syncedAt = null, latestDay = null, until = null } = {}) {
    if (!syncedAt || !latestDay) return { syncedAt: null, completeTo: null, partial: false };

    const syncDay = londonYmd(new Date(syncedAt));
    const lastFinal = previousDay(syncDay);
    // The feed can be stale as well as mid-day: if the newest row predates the
    // sync's own day, the data itself is the ceiling.
    const completeTo = latestDay < lastFinal ? latestDay : lastFinal;

    return {
        syncedAt: new Date(syncedAt).toISOString(),
        completeTo,
        // No window asked for, no claim made. Otherwise: the window reaches
        // past the last final day, so at least one day in view is incomplete.
        partial: Boolean(until) && until > completeTo,
    };
}
