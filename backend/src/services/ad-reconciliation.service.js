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

export const adReconciliationService = {
    async build(orgId, { since, until, provider }) {
        const levels = LEVELS[provider];
        if (!levels) throw new Error(`ad-reconciliation: unknown provider '${provider}'`);

        const campaignRows = await marketingRepository.campaignSpendByProvider(orgId, since, until, provider);
        const campaignSpendPence = sumSpend(campaignRows);

        const out = [];
        for (const level of levels) {
            const rows = await adGrainRepository.rollup(orgId, level.grain, { since, until });
            const spendPence = sumSpend(rows);
            const gapPence = campaignSpendPence - spendPence;
            const material = Math.abs(gapPence) > TOLERANCE_PENCE;
            out.push({
                grain: level.grain,
                label: level.label,
                spendPence,
                campaignSpendPence,
                gapPence: material ? gapPence : 0,
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
        };
    },
};
