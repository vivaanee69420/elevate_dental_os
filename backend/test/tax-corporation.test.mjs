// ============================================================================
// Corporation Tax arithmetic. Figures checked against HMRC's own worked
// example in CTM03925 and the published rates for FY2026.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { corporationTax, scaledLimits, corporationTaxDeadlines } from '../src/lib/tax/corporation-tax.js';

// FY2026 rates, as they would arrive from the tax_rates table.
const FY2026 = {
    smallProfitsRatePct: 19,
    mainRatePct: 25,
    lowerLimitPence: 50_000_00,
    upperLimitPence: 250_000_00,
    marginalReliefFraction: [3, 200],
};

describe('corporationTax', () => {
    it('charges the small profits rate at or below the lower limit', () => {
        const r = corporationTax({ ...FY2026, profitPence: 40_000_00 });
        expect(r.band).toBe('small');
        expect(r.taxPence).toBe(7_600_00);          // £40,000 x 19%
        expect(r.effectiveRatePct).toBe(19);
    });

    it('charges the main rate at or above the upper limit', () => {
        const r = corporationTax({ ...FY2026, profitPence: 300_000_00 });
        expect(r.band).toBe('main');
        expect(r.taxPence).toBe(75_000_00);         // £300,000 x 25%
        expect(r.effectiveRatePct).toBe(25);
    });

    // HMRC's worked shape: £100,000 profit.
    //   main rate      100,000 x 25%              = 25,000.00
    //   marginal relief 3/200 x (250,000 - 100,000) =  2,250.00
    //   tax due                                     = 22,750.00
    it('applies marginal relief between the limits', () => {
        const r = corporationTax({ ...FY2026, profitPence: 100_000_00 });
        expect(r.band).toBe('marginal');
        expect(r.marginalReliefPence).toBe(2_250_00);
        expect(r.taxPence).toBe(22_750_00);
        expect(r.effectiveRatePct).toBe(22.75);
    });

    // The bands must meet exactly at the boundaries — a gap or an overlap here
    // is a company taxed twice or not at all.
    it('is continuous at both limits', () => {
        const atLower = corporationTax({ ...FY2026, profitPence: 50_000_00 });
        const justOver = corporationTax({ ...FY2026, profitPence: 50_000_01 });
        expect(atLower.band).toBe('small');
        expect(justOver.band).toBe('marginal');
        expect(Math.abs(justOver.taxPence - atLower.taxPence)).toBeLessThan(100); // < £1 step

        const atUpper = corporationTax({ ...FY2026, profitPence: 250_000_00 });
        expect(atUpper.band).toBe('main');
        expect(atUpper.taxPence).toBe(62_500_00);
    });

    // A loss is not "£0 at 19%": there is no rate in point, and an effective
    // rate over no profit is undefined, never zero.
    it('returns no tax and a null effective rate on a loss or nil profit', () => {
        for (const p of [0, -25_000_00]) {
            const r = corporationTax({ ...FY2026, profitPence: p });
            expect(r.taxPence).toBe(0);
            expect(r.band).toBe('none');
            expect(r.effectiveRatePct).toBeNull();
        }
    });

    // The limits are divided by the number of associated companies. A group of
    // five practice companies has a £10,000 lower limit, not £50,000 — so the
    // same profit lands in a different band entirely.
    it('divides the limits by associated companies', () => {
        const solo = corporationTax({ ...FY2026, profitPence: 40_000_00 });
        const grouped = corporationTax({ ...FY2026, profitPence: 40_000_00, associatedCompanies: 5 });
        expect(solo.band).toBe('small');
        expect(grouped.band).toBe('marginal');
        expect(grouped.lowerLimitPence).toBe(10_000_00);
        expect(grouped.upperLimitPence).toBe(50_000_00);
        expect(grouped.taxPence).toBeGreaterThan(solo.taxPence);
    });

    it('pro-rates the limits for a short accounting period', () => {
        const l = scaledLimits({ ...FY2026, periodDays: 183 });
        expect(l.lowerLimitPence).toBe(Math.round(50_000_00 * (183 / 365)));
        expect(l.upperLimitPence).toBe(Math.round(250_000_00 * (183 / 365)));
    });
});

describe('corporationTaxDeadlines', () => {
    // Payment is 9 months + 1 day after period end; the RETURN is 12 months.
    // Two different dates — conflating them makes a payment late while the
    // filing still looks on time.
    it('separates the payment date from the filing date', () => {
        expect(corporationTaxDeadlines('2026-03-31')).toEqual({
            payBy: '2027-01-01', fileBy: '2027-03-31',
        });
    });

    it('handles a 31 December year end across the year boundary', () => {
        expect(corporationTaxDeadlines('2026-12-31')).toEqual({
            payBy: '2027-10-01', fileBy: '2027-12-31',
        });
    });
});
