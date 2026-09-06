// ============================================================================
// Open days — splitting a campaign list into always-on and per-event buckets.
//
// Pure: campaign rows in, buckets out. It does no I/O and knows nothing about
// Meta, so it is testable without a database and reusable if Google open days
// ever get a UI.
//
// THE SPLIT IS A PARTITION, and the page says so out loud with an
// "Always-on + Open days = Meta total" row. Two things make that honest:
// ad_open_day_campaigns' primary key (organisation_id, provider, campaign_id)
// lets a campaign belong to at most ONE event, and every row here lands in
// exactly one bucket. Neither is a comment-level promise — the first is a
// database constraint, the second is asserted metric-for-metric in
// test/open-day-split.test.mjs.
// ============================================================================
import { withLeadCosts } from './lead-performance.js';

// Every additive column a campaign row carries. Costs are NOT here: a bucket's
// cost per lead is its own spend over its own leads, never an average of its
// campaigns' costs — averaging ratios weights a £20 campaign the same as a
// £20,000 one.
const METRICS = [
    'spendPence', 'impressions', 'clicks', 'conversions',
    'leads', 'booked', 'accepted', 'paidPence',
];

function emptyBucket() {
    return Object.fromEntries(METRICS.map((k) => [k, 0]));
}

function accumulate(target, row) {
    for (const k of METRICS) target[k] += Number(row[k] ?? 0);
    return target;
}

/**
 * @param campaignRows    campaignLeadPerformance()'s output for the window.
 * @param eventByCampaign Map<campaignId, { id, name, eventDate }>. A campaign
 *                        absent from the map is always-on — that is the whole
 *                        definition, so "unmapped" needs no separate storage.
 * @param keepEmpty       Include events with no spend and no leads in the
 *                        window. Off by default: an org accumulates events
 *                        forever and one that did nothing this period is noise.
 *                        On for the management screen, which must list every
 *                        event in order to let someone edit it.
 */
export function splitByOpenDay(campaignRows, eventByCampaign, { keepEmpty = false } = {}) {
    const alwaysOn = emptyBucket();
    const openDays = emptyBucket();
    const byEvent = new Map();

    for (const row of campaignRows ?? []) {
        const event = eventByCampaign?.get(row.campaignId);
        if (!event) {
            accumulate(alwaysOn, row);
            continue;
        }
        accumulate(openDays, row);
        let bucket = byEvent.get(event.id);
        if (!bucket) {
            bucket = {
                openDayId: event.id,
                name: event.name ?? null,
                eventDate: event.eventDate ?? null,
                // How many of this window's campaigns promoted the event —
                // NOT how many are mapped to it. A campaign mapped but not
                // running in this period has no row here and is not counted,
                // which is why the number can differ between two windows.
                campaigns: 0,
                ...emptyBucket(),
            };
            byEvent.set(event.id, bucket);
        }
        bucket.campaigns += 1;
        accumulate(bucket, row);
    }

    const events = [...byEvent.values()]
        .filter((e) => keepEmpty || e.spendPence > 0 || e.leads > 0)
        // Newest first. An undated event sorts LAST rather than being dropped
        // or treated as 1970 — the date is optional on purpose (an owner
        // recording a past event may not remember it), and losing the event
        // over a missing date would lose the campaign grouping, which is the
        // part carrying the numbers.
        .sort((a, b) => {
            if (a.eventDate === b.eventDate) return String(a.name).localeCompare(String(b.name));
            if (!a.eventDate) return 1;
            if (!b.eventDate) return -1;
            return a.eventDate < b.eventDate ? 1 : -1;
        })
        .map(withLeadCosts);

    return {
        alwaysOn: withLeadCosts(alwaysOn),
        openDays: withLeadCosts(openDays),
        events,
    };
}
