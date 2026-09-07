// ============================================================================
// UK Corporation Tax.
//
// Sourced from HMRC, September 2026:
//   https://www.gov.uk/corporation-tax-rates
//   https://www.gov.uk/guidance/corporation-tax-marginal-relief
//   https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03925
//
// RATES ARE NEVER CONSTANTS IN THIS FILE. They are passed in from the
// tax_rates table, keyed by financial year, because they change every April
// and a rate baked into code goes silently wrong the following spring while
// still rendering with total confidence. Everything here is arithmetic over
// the rates it is given.
//
// Money is integer pence throughout, per the project rule. The one place that
// cannot be integer is the marginal relief fraction (3/200), so the relief is
// computed in pence and rounded once, at the end.
// ============================================================================

/**
 * The lower and upper limits are divided by the number of associated companies
 * (the company itself counts as one) and pro-rated for accounting periods
 * shorter than 12 months. Both are HMRC requirements, and both are easy to
 * forget — a group of five practices each holding a company has a lower limit
 * of £10,000, not £50,000, which changes the rate that applies.
 */
export function scaledLimits({ lowerLimitPence, upperLimitPence, associatedCompanies = 1, periodDays = 365 }) {
    const n = Math.max(1, Math.trunc(associatedCompanies));
    const days = Math.max(1, Math.trunc(periodDays));
    const scale = (v) => Math.round((v / n) * (days / 365));
    return { lowerLimitPence: scale(lowerLimitPence), upperLimitPence: scale(upperLimitPence) };
}

/**
 * Corporation Tax on taxable total profits.
 *
 * @param {object} args
 * @param {number} args.profitPence          taxable total profits (TTP)
 * @param {number} args.smallProfitsRatePct  e.g. 19
 * @param {number} args.mainRatePct          e.g. 25
 * @param {number} args.lowerLimitPence      e.g. 5_000_000 (£50,000)
 * @param {number} args.upperLimitPence      e.g. 25_000_000 (£250,000)
 * @param {[number, number]} args.marginalReliefFraction  e.g. [3, 200]
 * @param {number} [args.associatedCompanies]
 * @param {number} [args.periodDays]
 * @returns {{taxPence: number, band: 'none'|'small'|'marginal'|'main',
 *            effectiveRatePct: number|null, marginalReliefPence: number,
 *            lowerLimitPence: number, upperLimitPence: number}}
 */
export function corporationTax({
    profitPence,
    smallProfitsRatePct,
    mainRatePct,
    lowerLimitPence,
    upperLimitPence,
    marginalReliefFraction,
    associatedCompanies = 1,
    periodDays = 365,
}) {
    const limits = scaledLimits({ lowerLimitPence, upperLimitPence, associatedCompanies, periodDays });

    // A loss or a nil profit is not "£0 tax at 19%" — there is no rate in
    // point at all, and an effective rate over no profit is undefined, never
    // zero. Same rule the marketing pages use for cost-per-nothing.
    if (!Number.isFinite(profitPence) || profitPence <= 0) {
        return {
            taxPence: 0, band: 'none', effectiveRatePct: null, marginalReliefPence: 0,
            ...limits,
        };
    }

    if (profitPence <= limits.lowerLimitPence) {
        const taxPence = Math.round(profitPence * (smallProfitsRatePct / 100));
        return {
            taxPence, band: 'small', marginalReliefPence: 0,
            effectiveRatePct: round2((taxPence / profitPence) * 100),
            ...limits,
        };
    }

    const mainTax = Math.round(profitPence * (mainRatePct / 100));

    if (profitPence >= limits.upperLimitPence) {
        return {
            taxPence: mainTax, band: 'main', marginalReliefPence: 0,
            effectiveRatePct: round2((mainTax / profitPence) * 100),
            ...limits,
        };
    }

    // Marginal Relief = F x (U - A) x (N / A), where F is the fraction, U the
    // upper limit, A augmented profits and N taxable total profits. This app
    // has no franked investment income to distinguish augmented profits from
    // TTP, so N/A is 1 — stated rather than silently assumed, because a
    // company WITH franked investment income would need the ratio and this
    // would quietly over-relieve it.
    const [num, den] = marginalReliefFraction;
    const relief = Math.round((num / den) * (limits.upperLimitPence - profitPence));
    const taxPence = mainTax - relief;

    return {
        taxPence, band: 'marginal', marginalReliefPence: relief,
        effectiveRatePct: round2((taxPence / profitPence) * 100),
        ...limits,
    };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Corporation Tax is due 9 months and 1 day after the end of the accounting
 * period (for companies below the quarterly-instalment threshold, which every
 * practice group here is). The RETURN is due 12 months after — a different
 * date, and conflating the two is how a payment is late while the filing looks
 * on time.
 *
 * @param {string} periodEndYmd  YYYY-MM-DD
 * @returns {{payBy: string, fileBy: string}}
 */
export function corporationTaxDeadlines(periodEndYmd) {
    const end = new Date(`${periodEndYmd}T12:00:00Z`);   // midday: no DST date roll
    const pay = addDays(addMonths(end, 9), 1);
    const file = addMonths(end, 12);
    return { payBy: ymd(pay), fileBy: ymd(file) };
}

// Month arithmetic that CLAMPS instead of overflowing. Date.setUTCMonth rolls
// a non-existent day into the next month: 31 December plus nine months becomes
// "31 September", which silently becomes 1 October, and the payment date then
// lands a day late. 31 December year ends are the single most common in UK
// company filings, so this is the case that matters most.
function addMonths(date, months) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + months;
    const d = date.getUTCDate();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, lastDay), 12));
}

function addDays(date, days) {
    const out = new Date(date);
    out.setUTCDate(out.getUTCDate() + days);
    return out;
}

function ymd(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
