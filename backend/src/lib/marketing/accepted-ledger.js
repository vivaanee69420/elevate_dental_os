// ============================================================================
// Accepted-patient counts for the Marketing section, on the SAME rule the
// Facebook and Google report pages use.
//
// WHY. /marketing/performance — Marketing > Overview, Campaigns and Practices —
// took "Became patients" from ad_campaign_funnel, where a patient means "this
// lead matches SOME record in Dentally". The two report pages take theirs from
// the per-platform lead ledgers, where a patient means "this lead's settled
// payments exceed the acceptance floor". Same word, two rules, both on screen in
// the same section. Measured live (group, Jun-Aug 2026): 729 here against 86
// there — 8.5x apart. That is the drift migration 000167 closed for Facebook;
// this side never moved.
//
// This does NOT redefine anything. It re-buckets the ledger rows the report
// pages already read, through the shared eligibleForOutcome gate, so the
// Marketing section's patient count is the report pages' patient count.
//
// Leads are deliberately left alone: the Marketing Overview counts every
// enquiry however it arrived (it says so on screen) and uses only the
// campaign-attributed subset as a cost denominator. Only the MONEY rules move.
// ============================================================================
import { eligibleForOutcome } from './lead-performance.js';

const blank = () => ({ leads: 0, booked: 0, accepted: 0 });

function add(acc, lead, includeExisting) {
    acc.leads += 1;
    if (lead.booked && eligibleForOutcome(lead, includeExisting)) acc.booked += 1;
    if (lead.accepted && eligibleForOutcome(lead, includeExisting)) acc.accepted += 1;
}

export function summariseAccepted(googleRows, metaRows, includeExisting = false) {
    const total = blank();
    // Leads that resolve to a campaign we hold spend for. Kept apart from the
    // total because a ledger lead with no campaign is still a lead the ads
    // produced — it simply cannot be charged to one campaign's spend, and
    // folding it into a per-campaign denominator would understate every cost.
    const attributed = blank();
    const byCampaign = new Map();
    const byPractice = new Map();
    const byChannel = { google_ads: blank(), meta_ads: blank() };

    const touch = (map, key) => {
        if (!map.has(key)) map.set(key, blank());
        return map.get(key);
    };

    for (const [channel, rows] of [['google_ads', googleRows], ['meta_ads', metaRows]]) {
        // A platform whose read failed or returned nothing contributes nothing
        // and must not take the other platform's numbers with it.
        for (const l of rows ?? []) {
            add(total, l, includeExisting);
            add(byChannel[channel], l, includeExisting);
            // null practice is its OWN bucket, never dropped — the same
            // discipline practiceLeadPerformance applies to unmapped spend.
            add(touch(byPractice, l.practice_id ?? null), l, includeExisting);
            if (l.campaign_id == null) continue;
            add(attributed, l, includeExisting);
            add(touch(byCampaign, l.campaign_id), l, includeExisting);
        }
    }

    return { total, attributed, byCampaign, byPractice, byChannel };
}
