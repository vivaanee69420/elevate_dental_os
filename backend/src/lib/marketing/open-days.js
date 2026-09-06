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

// Spend-side columns come from campaign rows; lead-side columns from ledger
// rows. They are separate on purpose: since 000171 a lead's event comes from
// its GHL PIPELINE while spend's event comes from its META CAMPAIGN, and
// deriving one from the other is what would put a lead in the wrong bucket.
const SPEND_METRICS = ['spendPence', 'impressions', 'clicks', 'conversions'];
const LEAD_METRICS = ['leads', 'attributedLeads', 'booked', 'accepted', 'paidPence'];

function emptyBucket() {
    return Object.fromEntries([...SPEND_METRICS, ...LEAD_METRICS].map((k) => [k, 0]));
}

function addSpend(target, row) {
    for (const k of SPEND_METRICS) target[k] += Number(row[k] ?? 0);
}

// includeExisting mirrors practiceLeadPerformance/campaignLeadPerformance in
// lead-performance.js exactly: leads and attributedLeads always count (they
// answer "how many leads came in", not "how many are worth counting"), but
// booked/accepted/paidPence are gated on the same is_new_patient eligibility
// those functions use — the owner's own definition of CPB/CPA — so the split
// beneath the cards moves when the "Include existing patients" toggle does,
// instead of half-working.
function addLead(target, row, includeExisting) {
    target.leads += 1;
    if (row.meta_attributed) target.attributedLeads += 1;
    const eligible = includeExisting || row.is_new_patient;
    if (!eligible) return;
    if (row.booked) target.booked += 1;
    if (row.accepted) target.accepted += 1;
    target.paidPence += Number(row.paid_pence ?? 0);
}

// withLeadCosts nulls a cost only on a zero DENOMINATOR (no leads/booked/
// accepted to divide by). It does not null on a zero NUMERATOR, so a bucket
// with leads but no spend this window prices out at a literal £0.00 — read
// as "free leads" rather than what it actually means here: the mapped
// campaign didn't spend in this window (a stale mapping, a paused ad), and
// the leads arriving anyway are not attributable to £0 of effort. Spend-side
// zero is exactly as unknowable as lead-side zero, so it gets the same null.
function withOpenDayCosts(bucket) {
    const withCosts = withLeadCosts(bucket);
    if (bucket.spendPence === 0) {
        return { ...withCosts, cplPence: null, cpbPence: null, cpaPence: null };
    }
    return withCosts;
}

/**
 * @param campaignRows    campaignLeadPerformance() output — the SPEND side.
 * @param ledgerRows      ad_meta_lead_ledger rows — the LEAD side. Each row's
 *                        `open_day_id` is its event, from its pipeline.
 * @param events          [{ id, name, eventDate }] for the org.
 * @param eventByCampaign Map<campaignId, { id }> — which event owns each
 *                        campaign's SPEND.
 * @param keepEmpty       include events with neither spend nor leads.
 * @param includeExisting count booked/accepted/paidPence for existing
 *                        patients too, not only new ones. Defaults to false,
 *                        matching practiceLeadPerformance's default.
 */
export function splitByOpenDay(campaignRows, ledgerRows, events, {
    eventByCampaign = new Map(), keepEmpty = false, includeExisting = false,
} = {}) {
    const alwaysOn = emptyBucket();
    const openDays = emptyBucket();
    const byEvent = new Map();

    const bucketFor = (event) => {
        let b = byEvent.get(event.id);
        if (!b) {
            b = {
                openDayId: event.id,
                name: event.name ?? null,
                eventDate: event.eventDate ?? null,
                campaigns: 0,
                ...emptyBucket(),
            };
            byEvent.set(event.id, b);
        }
        return b;
    };
    for (const e of events ?? []) bucketFor(e);

    for (const row of campaignRows ?? []) {
        const event = eventByCampaign.get(row.campaignId);
        if (!event) { addSpend(alwaysOn, row); continue; }
        addSpend(openDays, row);
        const b = bucketFor(event);
        b.campaigns += 1;
        addSpend(b, row);
    }

    for (const row of ledgerRows ?? []) {
        const id = row.open_day_id ?? null;
        if (!id || !byEvent.has(id)) { addLead(alwaysOn, row, includeExisting); continue; }
        addLead(openDays, row, includeExisting);
        addLead(byEvent.get(id), row, includeExisting);
    }

    const out = [...byEvent.values()]
        .filter((e) => keepEmpty || e.spendPence > 0 || e.leads > 0)
        // Newest first. An undated event sorts LAST rather than being dropped
        // or treated as 1970 — the date is optional on purpose.
        .sort((a, b) => {
            if (a.eventDate === b.eventDate) return String(a.name).localeCompare(String(b.name));
            if (!a.eventDate) return 1;
            if (!b.eventDate) return -1;
            return a.eventDate < b.eventDate ? 1 : -1;
        })
        .map(withOpenDayCosts);

    return {
        alwaysOn: withOpenDayCosts(alwaysOn),
        openDays: withOpenDayCosts(openDays),
        events: out,
    };
}
