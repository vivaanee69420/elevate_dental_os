// ============================================================================
// Google click_view sync — the click behind a lead.
//
// Campaign grain lives in google-ads-sync.js and deep grain (ad group / ad /
// keyword, by DAY and by SPEND) in google-ads-deep-sync.js. This is neither:
// it is one row per CLICK, keyed by gclid, and it exists solely so a lead
// carrying a gclid can be told which ad produced it. Migration 000177 holds
// the table and the reasoning; 000178 does the join.
//
// ============================================================================
// WHAT THE LIVE API ACTUALLY RETURNS. Probed against customers 6110644137 /
// 9010336897 / 6846708190 on 2026-08-31, 159 clicks, before this was written:
//
//                      clicks   ad group   ad    keyword
//       SEARCH            70       70      70      70
//       PERFORMANCE_MAX   89        0       0       0
//
// A Search click resolves all the way down, every time. A PMax click resolves
// to its campaign and stops — PMax has asset groups, not ad groups and ads, so
// there is nothing below the campaign to name. Not a defect and not something
// a later version fixes.
//
// click_view.gbraid and click_view.wbraid are NOT selectable (probed:
// UNRECOGNIZED_FIELD). iOS/privacy clicks that carry a gbraid instead of a
// gclid therefore cannot be looked up by any route this API offers, and stay
// unattributed rather than guessed at.
//
// ============================================================================
// ONE QUERY PER DAY. Not a choice — click_view accepts a single date, never a
// range. So the cost of this sync is (accounts x days), which is why the
// nightly run resumes from what it already holds instead of re-walking the
// window, and why every insert is ON CONFLICT DO NOTHING so an overlap costs
// nothing.
//
// NINETY DAYS IS A HARD FLOOR. click_view retains 90 days; day 91 is an error,
// not a smaller answer. daysToPull() clamps to it no matter how stale the
// table, so an org that goes a year without a sync recovers the 90 days that
// still exist rather than failing every night on a request Google will never
// serve.
// ============================================================================
import { googleClickRepository } from "../../repositories/google-click.repository.js";
import { londonYmd } from "../tz.js";

/** Google's retention limit for click_view. Not tunable — it is their number. */
export const CLICK_WINDOW_DAYS = 90;

/**
 * Account statuses that can never serve a click. Shared with the one-shot
 * backfill so both agree on what is worth asking: at one query PER DAY per
 * account, a manager or a deactivated account costs 90 doomed requests, not
 * one. Mirrors google-ads-sync.js's SKIP_STATUSES, which guards the same two
 * conditions for the spend pull.
 */
export const SKIP_ACCOUNT_STATUSES = new Set(['manager', 'not_enabled']);

/**
 * Consecutive failed days after which an account is abandoned FOR THIS RUN.
 *
 * Measured, not guessed: the first backfill spent 450 queries discovering five
 * times over that an account it cannot read on day 1 it also cannot read on
 * days 2 through 90. Every one returned the same "user doesn't have permission"
 * — a fact about the ACCOUNT, repeated ninety times at one query each.
 *
 * Three, not one, because a single failure is usually a throttle or a deadline
 * and the next day would have succeeded. Three in a row is a condition, not a
 * blip. The account is not marked bad anywhere: the next run tries it again
 * from the top, so an account that regains access heals itself.
 */
export const MAX_CONSECUTIVE_DAY_FAILURES = 3;

/**
 * Days re-pulled on top of what is already held. Google attributes some clicks
 * late, so the most recent days keep changing for a short while after the
 * fact; re-reading them is free (ON CONFLICT DO NOTHING) and not re-reading
 * them loses clicks permanently once they age out.
 */
export const CLICK_OVERLAP_DAYS = 3;

const dayBefore = (ymd, n) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
};

/**
 * The days to query for one account: everything from `latest - overlap` up to
 * `until`, clamped to the 90-day retention floor, ascending.
 *
 * `latest` null (nothing captured yet) means the full window — the one-off
 * backfill. A `latest` in the future (clock skew, a hand-inserted row) yields
 * an empty list rather than a reversed range.
 */
export function daysToPull(latestHeld, until) {
    const floor = dayBefore(until, CLICK_WINDOW_DAYS - 1);
    let from = latestHeld ? dayBefore(latestHeld, CLICK_OVERLAP_DAYS) : floor;
    if (from < floor) from = floor;
    const out = [];
    for (let d = from; d <= until; d = dayBefore(d, -1)) out.push(d);
    return out;
}

export function buildClickGaql(day) {
    // Every field here was probed field-by-field against the live API; the two
    // that were rejected are named in the header. Adding an unprobed field
    // fails the WHOLE query, so this list is not a place to guess.
    return `SELECT click_view.gclid, segments.date,
       campaign.id, campaign.name, campaign.advertising_channel_type,
       ad_group.id, ad_group.name,
       click_view.ad_group_ad, click_view.keyword, click_view.keyword_info.text
FROM click_view
WHERE segments.date = '${day}'`;
}

function* streamRows(batches) {
    for (const batch of Array.isArray(batches) ? batches : []) {
        for (const r of batch?.results ?? []) yield r;
    }
}

/**
 * The id at the end of a Google resource name.
 *
 *   customers/6110644137/adGroupAds/182196461723~764173219615  ->  764173219615
 *   customers/6110644137/adGroupCriteria/182196461723~2933117426 -> 2933117426
 *
 * The part BEFORE the '~' is the ad group repeated, so reading the whole
 * string — or the wrong half — stores something that joins to nothing.
 */
function idAfterTilde(resourceName) {
    if (typeof resourceName !== 'string') return null;
    const tail = resourceName.split('~').at(-1);
    return tail && tail !== resourceName ? tail : null;
}

/**
 * '0' IS NOT AN ID. A Performance Max click does not omit ad_group — it
 * returns `ad_group: { id: '0' }`. Left alone, every PMax click in the account
 * would collide into one fictional ad group and a drill-down would show real
 * traffic against a thing that does not exist. The CHECK constraint in 000177
 * is the second line of defence; this is the first.
 */
const realId = (v) => {
    const s = v == null ? '' : String(v);
    return s && s !== '0' ? s : null;
};

export function parseClicks(batches, { customerId }) {
    const out = [];
    for (const r of streamRows(batches)) {
        const gclid = r.clickView?.gclid;
        const date = r.segments?.date;
        // No gclid means nothing to join a lead on, and no date means no row
        // the table will accept. Both are dropped rather than defaulted.
        if (!gclid || !date) continue;

        const adGroupId = realId(r.adGroup?.id);
        // An ad or keyword can only be reported under an ad group. If the ad
        // group is the '0' sentinel there is nothing below it either, whatever
        // the other fields happen to hold.
        const adId = adGroupId ? realId(idAfterTilde(r.clickView?.adGroupAd)) : null;
        const keywordId = adGroupId ? realId(idAfterTilde(r.clickView?.keyword)) : null;

        out.push({
            customer_id: String(customerId),
            gclid: String(gclid),
            click_date: date,
            campaign_id: realId(r.campaign?.id),
            campaign_name: r.campaign?.name ?? null,
            // Google's own word for the campaign type, stored so "why has this
            // click no ad?" is answerable from the row. Never inferred from a
            // campaign name containing "PMAX" — that is one advertiser's
            // naming convention, not a fact about the campaign.
            channel_type: r.campaign?.advertisingChannelType ?? null,
            ad_group_id: adGroupId,
            ad_id: adId,
            keyword_id: keywordId,
            keyword_text: keywordId ? (r.clickView?.keywordInfo?.text ?? null) : null,
        });
    }
    return out;
}

/**
 * Pull clicks for every account into google_clicks.
 *
 * Failures are per (account, day) and never fatal. Five of this org's ten
 * accounts answer "user doesn't have permission" — that is the steady state,
 * not an incident — and a throttle on day 40 of a backfill must not cost the
 * other 89 days. The caller wraps this whole function again so it can never
 * fail the spend sync it runs behind.
 *
 * @param {string} orgId
 * @param {object} opts
 * @param {string} opts.accessToken
 * @param {string[]} opts.customerIds
 * @param {string} [opts.until] London today unless given.
 * @param {number} [opts.days] Force a fixed window instead of resuming. Tests
 *   and a deliberate re-backfill; the nightly path never passes it.
 * @param {(cid: string, token: string, gaql: string) => Promise<any>} opts.queryCustomer
 */
export async function syncGoogleClicks(orgId, { accessToken, customerIds, until, days, queryCustomer }) {
    const untilDay = until ?? londonYmd();
    const skipped = [];
    let clicks = 0;
    let inserted = 0;
    let queries = 0;

    for (const customerId of customerIds ?? []) {
        let window;
        if (days) {
            // An explicit window means exactly that many days ending at
            // `until` — the overlap is a property of RESUMING, and adding it
            // here would make `days: 3` quietly pull six.
            window = [];
            for (let i = days - 1; i >= 0; i--) window.push(dayBefore(untilDay, i));
        } else {
            let latest = null;
            try {
                latest = await googleClickRepository.latestClickDate(orgId, customerId);
            } catch (err) {
                // Unreadable bookkeeping means we do not know where to resume.
                // Fall back to the full window: re-reading days we already hold
                // is free, and skipping days we do not is permanent.
                skipped.push({ customerId, day: null, error: `resume point unreadable, pulling full window: ${String(err.message).slice(0, 120)}` });
            }
            window = daysToPull(latest, untilDay);
        }

        const rows = [];
        let consecutiveFailures = 0;
        for (const day of window) {
            try {
                queries += 1;
                const batches = await queryCustomer(customerId, accessToken, buildClickGaql(day));
                rows.push(...parseClicks(batches, { customerId }));
                // A success clears the count: an account that fails twice and
                // then answers is having a bad night, not a permission
                // problem, and must be allowed to finish its window.
                consecutiveFailures = 0;
            } catch (err) {
                consecutiveFailures += 1;
                skipped.push({ customerId, day, error: String(err.message).slice(0, 150) });
                if (consecutiveFailures >= MAX_CONSECUTIVE_DAY_FAILURES) {
                    // Reported as its own entry, with no day, so the caller can
                    // tell "this account is unreadable" from "these days
                    // failed" — different problems needing different action.
                    skipped.push({
                        customerId, day: null,
                        error: `abandoned after ${consecutiveFailures} consecutive failed days; ${window.length - window.indexOf(day) - 1} day(s) not attempted this run`,
                    });
                    break;
                }
            }
        }
        if (rows.length) {
            clicks += rows.length;
            try {
                inserted += await googleClickRepository.insertChunk(orgId, rows);
            } catch (err) {
                skipped.push({ customerId, day: null, error: `write failed: ${String(err.message).slice(0, 150)}` });
            }
        }
    }

    return { clicks, inserted, queries, skipped };
}

export const __test = {
    parseClicks, buildClickGaql, daysToPull, idAfterTilde, realId,
    CLICK_WINDOW_DAYS, CLICK_OVERLAP_DAYS, SKIP_ACCOUNT_STATUSES,
    MAX_CONSECUTIVE_DAY_FAILURES,
};
