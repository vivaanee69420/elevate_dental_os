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

// The Business Hub's Marketing block, from the same two ledgers.
//
// It was fed by the `ad_account_marketing` RPC — a THIRD definition of a lead,
// beside ad_campaign_funnel's and the report pages'. Measured live (Rochester's
// two accounts, August 2026) it returned 372 leads where the Facebook and Google
// pages showed 341 + 110 = 451. Three screens, three answers, which is the whole
// complaint this change exists to end.
//
// Scoped by AD ACCOUNT rather than practice, because that is the filter the hub
// offers — and each account maps to a practice (migration 000069), so a chosen
// account implies the practices whose ledger rows it can claim. The two
// providers are scoped SEPARATELY: selecting a Facebook account must not drag in
// Google's leads for the same practice.
export function adAccountFunnel(googleRows, metaRows) {
    const out = { leads: 0, booked: 0, patients: 0, newPatients: 0, paidPence: 0 };
    for (const l of [...(googleRows ?? []), ...(metaRows ?? [])]) {
        out.leads += 1;
        if (l.is_new_patient) out.newPatients += 1;
        // Same gate as the report pages: a returning patient who books is real
        // and is not an acquisition.
        if (l.booked && eligibleForOutcome(l)) out.booked += 1;
        if (l.accepted && eligibleForOutcome(l)) out.patients += 1;
        // Money these leads actually paid — the numerator for revenue-per-lead
        // and for a ROAS that means "what this spend bought", not the group's
        // entire takings.
        out.paidPence += Number(l.paid_pence ?? 0);
    }
    return out;
}
