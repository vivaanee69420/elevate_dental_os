// ============================================================================
// Ad reconciliation — does our deep-grain total agree with the campaign total
// the platform reports?
//
// This exists because "the numbers must tally exactly" is the acceptance
// criterion for the deep pull. Making the tally a product surface means a
// divergence is seen on screen rather than discovered in a client conversation.
//
// The Google keyword gap is EXPECTED, not a defect: Dynamic Search Ads traffic
// carries no keyword and Display/Video campaigns have none at all, so keyword
// cost is always a subset of campaign cost. Google's own interface shows the
// same shortfall. It is explained rather than flagged.
//
// Any OTHER grain failing to reconcile IS a real discrepancy and is reported
// as one, never softened away.
//
// Money is integer pence throughout (rule 2).
// ============================================================================
import { adGrainRepository } from "../repositories/ad-grain.repository.js";
import { marketingRepository } from "../repositories/marketing.repository.js";
import { isSupportedCurrency } from "../lib/integrations/ad-currency.js";
// Imported, not re-declared. A second copy of the permanent-status list would
// drift from the one the nightly sync actually skips on, and a drifted copy
// shows up here as a permanent unexplained gap — the exact failure this file
// exists to rule out.
import { SKIP_STATUSES } from "../lib/integrations/google-ads-sync.js";

const LEVELS = {
    google_ads: [
        { grain: 'google_adgroup', label: 'Ad groups', expectShortfall: false },
        { grain: 'google_ad',      label: 'Ads',       expectShortfall: false },
        { grain: 'google_keyword', label: 'Keywords',  expectShortfall: true },
    ],
    meta_ads: [
        { grain: 'meta_adset', label: 'Ad sets', expectShortfall: false },
        { grain: 'meta_ad',    label: 'Ads',     expectShortfall: false },
    ],
};

const SHORTFALL_NOTE =
    'Keyword cost is always a subset of campaign cost: Dynamic Search Ads traffic carries no keyword, '
  + 'and Display and Video campaigns have none at all. Google reports the same gap.';

const MISMATCH_NOTE =
    'This level does not reconcile to the campaign total. Investigate before relying on it.';

const REACH_NOTE =
    'Reach counts unique people, so it is never additive — ad set reach cannot be summed to a campaign total.';

// A gap under this is rounding, not a discrepancy worth reporting.
const TOLERANCE_PENCE = 100;

function sumSpend(rows) {
    return (rows ?? []).reduce((acc, r) => acc + Number(r.spend_pence ?? 0), 0);
}

// Which accounts can BOTH sides of the comparison see?
//
// The campaign side is ad_metrics, which keeps its window for an account long
// after that account stops being pulled. The deep side only ever holds
// accounts the deep pull covers. Compare the two without reconciling the
// account sets and a deactivated, deselected or non-GBP account contributes
// its entire spend to one side only — a permanent red gap, on the one screen
// whose whole job is to show that the numbers tally.
//
// Reasons are ordered by what takes an account out of the pull FIRST: an
// account the owner deselected never reaches the currency check at all.
function coverage(accounts) {
    const covered = [];
    const excluded = [];
    for (const a of accounts ?? []) {
        const customerId = String(a.customer_id);
        const name = a.name ?? null;
        if (a.is_selected === false) {
            excluded.push({ customerId, name, reason: 'not_selected', currency: a.currency ?? null });
        } else if (a.status && SKIP_STATUSES.has(a.status)) {
            excluded.push({ customerId, name, reason: a.status, currency: a.currency ?? null });
        } else if (!isSupportedCurrency(a.currency)) {
            excluded.push({ customerId, name, reason: 'unsupported_currency', currency: a.currency ?? null });
        } else {
            covered.push(customerId);
        }
    }
    return { covered, excluded };
}

const EXCLUSION_PROSE = {
    not_selected: 'not selected for reporting',
    unsupported_currency: 'billed in a currency we do not convert',
    manager: 'a manager account, which reports no metrics of its own',
    not_enabled: 'not enabled on the ad platform',
};

// Calm prose, not an error. An excluded account is a fact to state.
export function describeExclusion(entry) {
    const reason = EXCLUSION_PROSE[entry.reason]
        ?? `excluded by the ad platform (${entry.reason})`;
    const currency = entry.reason === 'unsupported_currency' && entry.currency
        ? ` (${entry.currency})` : '';
    return `${entry.name || entry.customerId}: ${reason}${currency}.`;
}

export const adReconciliationService = {
    async build(orgId, { since, until, provider }) {
        const levels = LEVELS[provider];
        if (!levels) throw new Error(`ad-reconciliation: unknown provider '${provider}'`);

        const accounts = await marketingRepository.adAccountsForProvider(orgId, provider);
        const { covered, excluded } = coverage(accounts);
        // No account dimension at all (never synced, pre-migration) is NOT the
        // same as "no account is covered". Filtering to an empty set there
        // would zero the campaign side and make every level "reconcile" at
        // nothing — a wrong answer that looks right. Fall back to no filter,
        // the behaviour before account reconciliation existed.
        const customerIds = (accounts ?? []).length === 0 ? null : covered;

        const campaignRows = await marketingRepository.campaignSpendByProvider(
            orgId, since, until, provider, customerIds,
        );
        const campaignSpendPence = sumSpend(campaignRows);

        const out = [];
        for (const level of levels) {
            const rows = await adGrainRepository.rollup(orgId, level.grain, { since, until });
            const spendPence = sumSpend(rows);
            const rawGapPence = campaignSpendPence - spendPence;
            const material = Math.abs(rawGapPence) > TOLERANCE_PENCE;
            // ONE gap figure drives both fields. Reporting gapPence as 0 under
            // tolerance while deriving gapPct from the raw gap made the two
            // disagree inside a single payload — "Reconciles" next to 0.02%.
            const gapPence = material ? rawGapPence : 0;
            out.push({
                grain: level.grain,
                label: level.label,
                spendPence,
                campaignSpendPence,
                gapPence,
                // null, not 0, on a zero denominator — a percentage of nothing
                // is not zero, it is unknowable.
                gapPct: campaignSpendPence > 0 ? (gapPence / campaignSpendPence) * 100 : null,
                additive: true,
                note: !material ? null : (level.expectShortfall ? SHORTFALL_NOTE : MISMATCH_NOTE),
            });
        }

        return {
            provider,
            since,
            until,
            campaignSpendPence,
            levels: out,
            reachNote: provider === 'meta_ads' ? REACH_NOTE : null,
            // Both sides of every figure above cover exactly these accounts.
            // When some are left out the totals are partial, and the payload
            // says so rather than letting a partial total read as the whole.
            coversAllAccounts: excluded.length === 0,
            coveredAccountCount: covered.length,
            excludedAccounts: excluded.map((e) => ({ ...e, description: describeExclusion(e) })),
            excludedNote: excluded.length === 0 ? null
                : `These totals cover ${covered.length} of ${covered.length + excluded.length} connected `
                  + `${provider === 'meta_ads' ? 'Meta' : 'Google'} accounts. `
                  + 'Spend on the remaining accounts is not counted on either side of this comparison.',
        };
    },
};
