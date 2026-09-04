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
// The DEEP side holds every account the deep sync writes, and there is no way
// to narrow it: neither ad_grain_rollup nor ad_keyword_rollup takes an account
// parameter. So the campaign side is narrowed to match it, and ONLY for the
// two things that genuinely keep an account out of the deep tables while
// leaving its history in ad_metrics:
//
//   - unsupported currency — the deep sync filters on it
//     (partitionAccountsByCurrency); the campaign sync does not. A USD
//     account's rows really are in ad_metrics and really are absent from the
//     deep tables.
//   - a permanently-failed platform status — google-ads-sync drops those
//     customers from customerIds entirely, so no new rows land anywhere, while
//     the ad_metrics history already written persists.
//
// An exclusion is only ever correct if it PARTITIONS THE DATA. `is_selected`
// deliberately is not one: grep it in google-ads-sync.js and meta-ads-sync.js
// and there are no hits — neither sync consults it, both loop over every
// configured account, so a deselected account keeps receiving fresh rows in
// ad_metrics AND in the deep tables every night. Excluding it from the
// campaign side alone made the deep total legitimately EXCEED the campaign
// total: a negative gap past tolerance, rendering as a red "does not
// reconcile" on the one panel whose only job is to be trustworthy. That is the
// mirror image of the bug this function exists to fix. `is_selected` filters
// read paths elsewhere; it does not belong here.
function coverage(accounts) {
    const covered = [];
    const excluded = [];
    for (const a of accounts ?? []) {
        const customerId = String(a.customer_id);
        const name = a.name ?? null;
        if (a.status && SKIP_STATUSES.has(a.status)) {
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
            // Every account listed as excluded is one the deep pull cannot
            // reach, so its spend is missing from the deep side no matter what
            // — leaving it on the campaign side would read as a gap. It is
            // dropped from the campaign side to match, and named here so the
            // partial cover is stated rather than passed off as the whole.
            coversAllAccounts: excluded.length === 0,
            coveredAccountCount: covered.length,
            excludedAccounts: excluded.map((e) => ({ ...e, description: describeExclusion(e) })),
            excludedNote: excluded.length === 0 ? null
                : `These totals cover ${covered.length} of ${covered.length + excluded.length} connected `
                  + `${provider === 'meta_ads' ? 'Meta' : 'Google'} accounts. `
                  + 'The accounts below are not reported at this level of detail, so their spend is '
                  + 'left out of both figures here. It is still counted in full everywhere else in Marketing.',
        };
    },
};
