// ============================================================================
// UK VAT for a dental practice.
//
// Sourced from HMRC, September 2026:
//   https://www.gov.uk/how-vat-works/vat-thresholds        (£90,000 / £88,000)
//   https://www.gov.uk/guidance/health-professionals-pharmaceutical-products-and-vat-notice-70157
//   https://www.gov.uk/hmrc-internal-manuals/vat-health/vathlt2480   (cosmetic dentistry)
//
// THE RULE THAT SHAPES THIS FILE. Dental care by a registered professional is
// EXEMPT, not zero-rated, under VATA 1994 Sch 9 Grp 7. Exempt is not a smaller
// rate — it means output VAT is not charged AND input VAT on those costs is not
// recoverable, which is why practices sit in partial exemption.
//
// And the trap that a naive implementation walks straight into: cosmetic
// dentistry is NOT automatically standard-rated. HMRC (VATHLT2480) treats
// cosmetic work as a single supply of exempt healthcare where it forms part of
// a course of dental treatment, and says in terms that "it is rare for dental
// work to be done purely for cosmetic reasons". Only work done outside any
// healthcare context is standard-rated, and "each case will need to be
// considered on its own facts".
//
// WHAT THAT MEANS FOR THE DEFAULT — and this corrects an earlier reading of
// the same guidance. There is no NAME rule: nothing here inspects a treatment's
// words to decide its liability. But HMRC's stated position IS that dental work
// is overwhelmingly exempt, so EXEMPT is the honest default and the practice
// marks the exceptions — the standalone cosmetic work and the retail sales.
//
// The first version defaulted to "unmapped" and folded nothing into either
// bucket, which was defensible and useless: it made a 431-treatment data-entry
// chore the price of seeing any figure at all, and the page showed a tax
// position of nothing until it was finished. Defaulting to the documented norm
// gives a real number immediately and still tracks exactly how much of it rests
// on the assumption, so the number is never mistaken for a mapped one.
// ============================================================================

// Treatment names arrive from the PMS with whatever whitespace and casing the
// practice typed: this org has "Composite Filling " and "Zirconia Implant
// Crown  " with trailing spaces. Keying the mapping on the raw string makes
// the same treatment appear twice, one copy mapped and one silently unmapped —
// the identical trap that inflated accepted value by GBP 1m on the Emergent
// feed. Normalise on the way in and on the way out, always through here.
export function normaliseDescription(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export const LIABILITY = Object.freeze({
    EXEMPT: 'exempt',
    STANDARD: 'standard',
    OUTSIDE_SCOPE: 'outside_scope',
});

/**
 * Split a period's revenue into VAT buckets using the practice's own mapping.
 *
 * @param {Array<{description: string, amountPence: number}>} lines
 * @param {Record<string, 'exempt'|'standard'|'outside_scope'>} liabilityByDescription
 * @returns {{exemptPence: number, standardNetPence: number, outsideScopePence: number,
 *            unmappedPence: number, unmapped: Array<{description: string, amountPence: number}>,
 *            totalPence: number}}
 */
export function splitRevenueByLiability(lines, liabilityByDescription = {}, {
    defaultLiability = LIABILITY.EXEMPT,
} = {}) {
    let exemptPence = 0, standardNetPence = 0, outsideScopePence = 0;
    // Revenue counted under the DEFAULT rather than an explicit decision. It is
    // inside the buckets (so the figures are real) and reported separately (so
    // nobody mistakes an assumption for a classification).
    let assumedPence = 0;
    const unmappedBy = new Map();

    for (const line of lines ?? []) {
        const amount = Number(line?.amountPence) || 0;
        const key = normaliseDescription(line?.description);
        const explicit = liabilityByDescription[key];
        const liability = explicit ?? defaultLiability;

        if (!explicit) {
            assumedPence += amount;
            const label = String(line?.description ?? '').trim();
            unmappedBy.set(label, (unmappedBy.get(label) ?? 0) + amount);
        }

        if (liability === LIABILITY.EXEMPT) exemptPence += amount;
        else if (liability === LIABILITY.STANDARD) standardNetPence += amount;
        else if (liability === LIABILITY.OUTSIDE_SCOPE) outsideScopePence += amount;
    }

    const unmapped = [...unmappedBy.entries()]
        .map(([description, amountPence]) => ({ description, amountPence }))
        .sort((a, b) => b.amountPence - a.amountPence);

    return {
        exemptPence, standardNetPence, outsideScopePence,
        // Kept under its old name so callers reading "how much is not decided"
        // still work; it is now the amount resting on the default.
        unmappedPence: assumedPence,
        assumedPence, assumedLiability: defaultLiability,
        unmapped,
        totalPence: exemptPence + standardNetPence + outsideScopePence,
    };
}

/**
 * Output VAT on the standard-rated supplies.
 *
 * `pricesIncludeVat` matters: a practice that lists "Whitening £300" is almost
 * always quoting VAT-inclusive, so charging 20% ON TOP would overstate the
 * liability by a fifth. Inclusive uses the VAT fraction (rate / (100 + rate)),
 * which is 1/6 at 20%.
 */
export function outputVat({ standardNetPence, standardRatePct, pricesIncludeVat = false }) {
    if (!standardNetPence || standardNetPence <= 0) {
        return { vatPence: 0, netPence: 0, grossPence: 0 };
    }
    if (pricesIncludeVat) {
        const vatPence = Math.round(standardNetPence * (standardRatePct / (100 + standardRatePct)));
        return { vatPence, netPence: standardNetPence - vatPence, grossPence: standardNetPence };
    }
    const vatPence = Math.round(standardNetPence * (standardRatePct / 100));
    return { vatPence, netPence: standardNetPence, grossPence: standardNetPence + vatPence };
}

/**
 * Registration watch on a ROLLING 12 months of TAXABLE turnover.
 *
 * Exempt income does not count toward the threshold — a £2m practice whose
 * income is all exempt dental care may have no obligation to register at all,
 * and testing total turnover would tell it, wrongly, that it must. Unmapped
 * revenue is returned separately rather than assumed either way, because
 * assuming it exempt is what would hide a real obligation.
 */
export function registrationStatus({
    taxableTurnover12mPence,
    unmappedTurnover12mPence = 0,
    registrationThresholdPence,
    deregistrationThresholdPence,
    isRegistered,
}) {
    const over = taxableTurnover12mPence >= registrationThresholdPence;
    // Could the unmapped revenue, if it turned out to be taxable, push them over?
    const couldBeOver = !over
        && (taxableTurnover12mPence + unmappedTurnover12mPence) >= registrationThresholdPence;

    return {
        taxableTurnover12mPence,
        registrationThresholdPence,
        overThreshold: over,
        // Only meaningful for someone already registered.
        belowDeregistrationThreshold: Boolean(isRegistered)
            && taxableTurnover12mPence < deregistrationThresholdPence,
        // An honest "we cannot tell yet" rather than a confident answer built
        // on revenue nobody has classified.
        indeterminate: couldBeOver,
        unmappedTurnover12mPence,
    };
}
