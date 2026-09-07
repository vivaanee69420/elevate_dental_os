// ============================================================================
// Tax service: the states, the tenant boundary, and the accounting period.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { taxService, accountingPeriod } from '../src/services/tax.service.js';
import { taxRepository } from '../src/repositories/tax.repository.js';
import { analyticsService } from '../src/services/analytics.service.js';

const ORG = 'org-1';
const OTHER = 'org-2';

const LTD = {
    organisation_id: ORG, entity_type: 'limited_company', vat_registered: true,
    prices_include_vat: true, year_end_day: 31, year_end_month: 3,
    associated_companies: 1,
};

const VAT_RATES = {
    tax_year: '2026-27', source_url: 'https://www.gov.uk/how-vat-works/vat-thresholds',
    rates: {
        standardRatePct: 20, registrationThresholdPence: 90_000_00,
        deregistrationThresholdPence: 88_000_00,
    },
};
const CT_RATES = {
    tax_year: 'FY2026', source_url: 'https://www.gov.uk/corporation-tax-rates',
    rates: {
        smallProfitsRatePct: 19, mainRatePct: 25,
        lowerLimitPence: 50_000_00, upperLimitPence: 250_000_00,
        marginalReliefFraction: [3, 200],
    },
};

describe('accountingPeriod', () => {
    it('returns the period containing the date, ending on the year end', () => {
        const p = accountingPeriod({ yearEndDay: 31, yearEndMonth: 3 }, '2026-09-07');
        expect(p).toMatchObject({ start: '2026-04-01', end: '2027-03-31' });
        expect(p.days).toBe(365);
    });

    // A period invented from a default would put the CT deadline on the wrong
    // date, which is worse than showing nothing.
    it('returns null when the year end has not been set', () => {
        expect(accountingPeriod({}, '2026-09-07')).toBeNull();
    });

    it('clamps a 31st year end into a short month', () => {
        const p = accountingPeriod({ yearEndDay: 31, yearEndMonth: 2 }, '2026-01-15');
        expect(p.end).toBe('2026-02-28');
    });
});

describe('taxService.overview', () => {
    let orig;
    beforeEach(() => {
        orig = {
            settings: taxRepository.settings, rates: taxRepository.rates,
            liabilityMap: taxRepository.liabilityMap,
            revenueByTreatment: taxRepository.revenueByTreatment,
            plMargin: analyticsService.plMargin,
        };
        taxRepository.rates = async (regime) => (regime === 'vat' ? VAT_RATES : CT_RATES);
        taxRepository.liabilityMap = async () => ({ examination: 'exempt', 'teeth whitening': 'standard' });
        taxRepository.revenueByTreatment = async () => ([
            { description: 'Examination', amountPence: 100_000_00 },
            { description: 'Teeth whitening', amountPence: 12_000_00 },
            { description: 'Composite bonding', amountPence: 30_000_00 },   // unmapped
        ]);
        analyticsService.plMargin = async () => ({ statement: { netPence: 100_000_00 } });
    });
    afterEach(() => {
        taxRepository.settings = orig.settings;
        taxRepository.rates = orig.rates;
        taxRepository.liabilityMap = orig.liabilityMap;
        taxRepository.revenueByTreatment = orig.revenueByTreatment;
        analyticsService.plMargin = orig.plMargin;
    });

    // An org that has not told us its entity type must not be quoted a tax
    // bill computed on a guessed regime.
    it('is not_configured until the entity type is known', async () => {
        taxRepository.settings = async () => null;
        const r = await taxService.overview(ORG, { onDate: '2026-09-07' });
        expect(r.state).toBe('not_configured');
        expect(r.corporationTax).toBeNull();
        expect(r.vat).toBeNull();
    });

    it('computes VAT on the mapped split and reports the rest as unmapped', async () => {
        taxRepository.settings = async () => LTD;
        const r = await taxService.overview(ORG, { onDate: '2026-09-07' });
        expect(r.vat.exemptPence).toBe(100_000_00);
        expect(r.vat.standardPence).toBe(12_000_00);
        expect(r.vat.unmappedPence).toBe(30_000_00);
        // Prices include VAT, so the VAT is the 1/6 fraction of the gross.
        expect(r.vat.outputVatPence).toBe(2_000_00);
        expect(r.caveats.join(' ')).toMatch(/no VAT liability set/);
    });

    // The threshold test must use TAXABLE turnover. £100k of exempt dental
    // care is not a registration obligation.
    it('does not treat exempt revenue as taxable turnover', async () => {
        taxRepository.settings = async () => LTD;
        const r = await taxService.overview(ORG, { onDate: '2026-09-07' });
        expect(r.vat.registration.taxableTurnover12mPence).toBe(12_000_00);
        expect(r.vat.registration.overThreshold).toBe(false);
        // …but says so, because the unmapped £30k could change the answer.
        expect(r.vat.registration.indeterminate).toBe(false);
    });

    it('estimates Corporation Tax with marginal relief for a limited company', async () => {
        taxRepository.settings = async () => LTD;
        const r = await taxService.overview(ORG, { onDate: '2026-09-07' });
        expect(r.corporationTax.state).toBe('ok');
        expect(r.corporationTax.band).toBe('marginal');
        expect(r.corporationTax.taxPence).toBe(22_750_00);
        expect(r.corporationTax.deadlines).toEqual({ payBy: '2028-01-01', fileBy: '2028-03-31' });
    });

    // A sole trader pays a different tax, not a different rate.
    it('does not quote Corporation Tax to a sole trader', async () => {
        taxRepository.settings = async () => ({ ...LTD, entity_type: 'sole_trader' });
        const r = await taxService.overview(ORG, { onDate: '2026-09-07' });
        expect(r.corporationTax.state).toBe('not_applicable');
        expect(r.corporationTax.reason).toMatch(/Self Assessment/);
        expect(r.corporationTax.taxPence).toBeUndefined();
    });

    it('says so rather than guessing when the year end is unset', async () => {
        taxRepository.settings = async () => ({ ...LTD, year_end_day: null, year_end_month: null });
        const r = await taxService.overview(ORG, { onDate: '2026-09-07' });
        expect(r.corporationTax.state).toBe('no_period');
    });

    // MULTI-TENANCY: every read is asked for the caller's own org, and one
    // org's settings can never answer for another's.
    it('reads only the caller organisation', async () => {
        const seen = [];
        taxRepository.settings = async (org) => { seen.push(org); return LTD; };
        taxRepository.revenueByTreatment = async (org) => { seen.push(org); return []; };
        taxRepository.liabilityMap = async (org) => { seen.push(org); return {}; };
        await taxService.overview(ORG, { onDate: '2026-09-07' });
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((o) => o === ORG)).toBe(true);
        expect(seen).not.toContain(OTHER);
    });
});
