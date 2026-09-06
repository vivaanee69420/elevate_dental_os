// ============================================================================
// Lead performance — the shared arithmetic behind the Google and Facebook
// reports' CPL / CPB / CPA cards and their per-campaign tables.
//
// WHY THIS IS SHARED, when the two report services otherwise stay deliberately
// independent (see google-report.service.js's funnelUntil comment). The window
// shims are trivial and copying one costs nothing. THIS is a hundred lines of
// judgement — the unmapped-practice bucket, the new-patients-only gate, the
// unattributed sentinel, the null-not-zero cost guard — and two copies of it
// would be two definitions of "cost per acquired patient" free to drift apart.
// That drift is exactly the bug migration 000167 exists to close: Facebook was
// counting a patient at identity-match while Google counted one at payment, so
// Facebook's cost per patient read ~8x cheaper for no reason but the rule.
//
// Both reports feed this the SAME row shapes:
//   spendRows    { practice_id, practice_name, spend_pence, impressions, clicks }
//   campaignRows { entity_id, entity_name, objective, spend_pence, impressions,
//                  clicks, conversions }
//   ledgerRows   { practice_id, practice_name, campaign_id, campaign_name,
//                  booked, accepted, is_new_patient, paid_pence }
// ============================================================================

// Local copies, as in both report services: a cost per nothing is unknowable,
// not free, so a zero denominator yields null rather than 0.
function perUnitPence(totalPence, units) {
    const n = Number(units ?? 0);
    return n > 0 ? Math.round(Number(totalPence ?? 0) / n) : null;
}

function ratio(numerator, denominator) {
    const d = Number(denominator ?? 0);
    return d > 0 ? Number(numerator ?? 0) / d : null;
}

// The acceptance floor for CPA (000162): a lead counts as an accepted
// patient once the money it has paid EXCEEDS this, not merely reaches it.
//
// £40 is roughly what an appointment costs at this group, and that is the
// whole point of having a floor at all — without one, every routine exam
// fee reads as a treatment acceptance. Measured live (Plan4growth, Google,
// Jun-Aug 2026, new patients only): 62 of 64 booked leads had paid
// SOMETHING, so a "paid anything" rule reports a 97% acceptance rate and
// tells the reader nothing. At £40 it is 46.
//
// It is a named constant, and a parameter of the RPC beneath it, because
// £40 is THIS group's consultation fee — another tenant's differs. When a
// per-practice fee becomes configurable this is the single place that
// reads it; until then no tenant is silently assumed to charge £40 by a
// literal buried in SQL.
export const ACCEPTANCE_MIN_PAID_PENCE = 4000;

// A cost per nothing is unknowable, not free — same guard as withCosts/
// perUnitPence above, applied to the blended lead figures instead of
// Google's own tracked conversions.
//
// Nulls only on a zero DENOMINATOR (no leads/booked/accepted). A zero
// NUMERATOR (no spend, but leads exist) prices out at a literal £0.00 here —
// open-days.js's withOpenDayCosts deliberately nulls that case too, because
// an event whose campaigns didn't run in the selected window would otherwise
// read as "free leads". The two rules are knowingly different pending a
// decision to unify them.
export function withLeadCosts(row) {
    return {
        ...row,
        cplPence: perUnitPence(row.spendPence, row.leads),
        cpbPence: perUnitPence(row.spendPence, row.booked),
        cpaPence: perUnitPence(row.spendPence, row.accepted),
    };
}

// Merge the spend-by-practice rows and the deduplicated lead ledger into ONE
// row per practice (plus one practice_id:null "unmapped" bucket for spend on
// an account with no practice mapping, or a lead whose practice could not be
// resolved) — a LEFT-join-shaped merge, not an inner one: a practice can
// legitimately have spend with zero leads in a quiet window, or leads with
// zero spend if its account is unmapped/paused. Exported for tests; also the
// function that turns raw rows into what the front end's cards need.
// includeExisting: false (the default, and the owner's own definition of
// CPB/CPA — "consider only new patients, no existing patients in Dentally")
// counts booked/accepted ONLY for leads ad_google_lead_ledger marked
// is_new_patient. true is the toggle the owner asked for after doubting a
// suspiciously low booked count: it counts every match regardless, so the
// two figures can be compared side by side without a second, differently-
// computed query — both read the SAME booked/accepted/is_new_patient
// columns from ONE ledger call, they just gate on is_new_patient differently.
export function practiceLeadPerformance(spendRows, ledgerRows, includeExisting = false) {
    const byPractice = new Map();
    const touch = (id, name) => {
        const key = id ?? '__unmapped__';
        let row = byPractice.get(key);
        if (!row) {
            row = {
                practiceId: id ?? null, practiceName: name ?? null,
                spendPence: 0, impressions: 0, clicks: 0,
                leads: 0, booked: 0, accepted: 0,
            };
            byPractice.set(key, row);
        }
        // A practice's name can arrive on either side (spend row or ledger
        // row) first — never let a later null overwrite an earlier real one.
        if (!row.practiceName && name) row.practiceName = name;
        return row;
    };
    for (const s of spendRows ?? []) {
        const row = touch(s.practice_id, s.practice_name);
        row.spendPence += Number(s.spend_pence ?? 0);
        row.impressions += Number(s.impressions ?? 0);
        row.clicks += Number(s.clicks ?? 0);
    }
    for (const l of ledgerRows ?? []) {
        const row = touch(l.practice_id, l.practice_name);
        row.leads += 1;
        const eligible = includeExisting || l.is_new_patient;
        if (l.booked && eligible) row.booked += 1;
        if (l.accepted && eligible) row.accepted += 1;
    }
    return [...byPractice.values()].map(withLeadCosts);
}

// The bucket every lead that could not be tied to a campaign falls into.
//
// A SENTINEL RATHER THAN A DROP, deliberately. If unattributed leads simply
// vanished from the per-campaign table, the campaign rows would sum to fewer
// leads than the practice card directly above them and the difference would be
// invisible. 178 of 553 leads land here on live data today; hiding them would
// overstate every campaign's conversion rate by making the denominator smaller
// than the truth. Same discipline as the reconciliation panel: a visible gap is
// recoverable, a total that looks right and is not is not.
export const UNATTRIBUTED = '__unattributed__';

// Per-CAMPAIGN cost per lead / booking / accepted patient.
//
// This is the figure the Google page has never been able to show. Until
// migration 000165 the file header said plainly it was not buildable — CallRail
// calls were believed to carry no campaign linkage. They do: the campaign name,
// the bid keyword and the gclid, captured from the click.
//
// A LEFT-JOIN-SHAPED MERGE, from spend outward. A campaign can legitimately
// have spend and no leads (a quiet week, a brand campaign) and leads with no
// spend in the window (someone who clicked last month and rang this month), and
// both must survive into the output — an inner join would silently delete the
// most interesting rows in the table.
export function campaignLeadPerformance(campaignRows, ledgerRows, includeExisting = false) {
    const byCampaign = new Map();
    const touch = (id, name, extra = {}) => {
        let row = byCampaign.get(id);
        if (!row) {
            row = {
                campaignId: id === UNATTRIBUTED ? null : id,
                campaignName: name ?? null,
                channelType: null,
                attributed: id !== UNATTRIBUTED,
                spendPence: 0, impressions: 0, clicks: 0, conversions: 0,
                leads: 0, booked: 0, accepted: 0, paidPence: 0,
                ...extra,
            };
            byCampaign.set(id, row);
        }
        if (!row.campaignName && name) row.campaignName = name;
        return row;
    };

    for (const c of campaignRows ?? []) {
        const row = touch(c.entity_id, c.entity_name);
        row.channelType = c.objective ?? null;
        row.spendPence += Number(c.spend_pence ?? 0);
        row.impressions += Number(c.impressions ?? 0);
        row.clicks += Number(c.clicks ?? 0);
        row.conversions += Number(c.conversions ?? 0);
    }

    for (const l of ledgerRows ?? []) {
        const row = touch(l.campaign_id ?? UNATTRIBUTED, l.campaign_name);
        row.leads += 1;
        const eligible = includeExisting || l.is_new_patient;
        if (!eligible) continue;
        if (l.booked) row.booked += 1;
        if (l.accepted) row.accepted += 1;
        // Money actually collected from the patients this campaign brought in.
        // Counted for every eligible lead, not only the ones over the
        // acceptance floor: a patient who paid £35 paid £35, and zeroing them
        // because they sit below a threshold set for a DIFFERENT question
        // would understate real revenue.
        row.paidPence += Number(l.paid_pence ?? 0);
    }

    return [...byCampaign.values()].map((r) => {
        // The unattributed bucket has, by definition, no spend of its own —
        // its leads' spend is sitting in the real campaign rows. Dividing its
        // £0 by its leads yields "£0.00 per lead", which reads as the cheapest
        // campaign in the table and is the exact opposite of what it means.
        // Unknowable, so null.
        const costs = r.attributed
            ? {
                cplPence: perUnitPence(r.spendPence, r.leads),
                cpbPence: perUnitPence(r.spendPence, r.booked),
                cpaPence: perUnitPence(r.spendPence, r.accepted),
                // Collected money against money spent. Null rather than 0 on
                // no spend — a return on nothing is not a return of zero.
                returnOnSpend: r.spendPence > 0 ? r.paidPence / r.spendPence : null,
            }
            : { cplPence: null, cpbPence: null, cpaPence: null, returnOnSpend: null };
        return { ...r, ...costs, ctr: ratio(r.clicks, r.impressions) };
    });
}

export function sumPracticeRows(rows) {
    const base = (rows ?? []).reduce((acc, r) => ({
        spendPence: acc.spendPence + r.spendPence,
        impressions: acc.impressions + r.impressions,
        clicks: acc.clicks + r.clicks,
        leads: acc.leads + r.leads,
        booked: acc.booked + r.booked,
        accepted: acc.accepted + r.accepted,
    }), { spendPence: 0, impressions: 0, clicks: 0, leads: 0, booked: 0, accepted: 0 });
    return withLeadCosts(base);
}
