import { describe, it, expect } from 'vitest';
import { splitRevenueByLiability, outputVat, registrationStatus, LIABILITY, normaliseDescription } from '../src/lib/tax/vat.js';

const RATES = { standardRatePct: 20, registrationThresholdPence: 90_000_00, deregistrationThresholdPence: 88_000_00 };

describe('splitRevenueByLiability', () => {
    const lines = [
        { description: 'Examination', amountPence: 142_300_00 },
        { description: 'Teeth whitening', amountPence: 18_900_00 },
        { description: 'Toothbrush', amountPence: 900_00 },
        { description: 'Composite bonding', amountPence: 41_200_00 },
    ];
    // Keys are stored normalised (lower-case, whitespace collapsed) — the
    // repository writes them that way, so the fixture must too.
    const mapping = {
        examination: LIABILITY.EXEMPT,
        'teeth whitening': LIABILITY.STANDARD,
        toothbrush: LIABILITY.STANDARD,
        // 'Composite bonding' deliberately unmapped
    };

    it('splits using the practice mapping only', () => {
        const r = splitRevenueByLiability(lines, mapping);
        expect(r.exemptPence).toBe(142_300_00);
        expect(r.standardNetPence).toBe(19_800_00);
    });

    // The heart of it: unmapped revenue must never be quietly treated as
    // exempt, which is the assumption that understates a VAT bill to zero.
    it('reports unmapped revenue separately, never as exempt', () => {
        const r = splitRevenueByLiability(lines, mapping);
        expect(r.unmappedPence).toBe(41_200_00);
        expect(r.unmapped[0]).toEqual({ description: 'Composite bonding', amountPence: 41_200_00 });
        expect(r.exemptPence).not.toContain?.(41_200_00);
    });

    it('accounts for every penny across the buckets', () => {
        const r = splitRevenueByLiability(lines, mapping);
        const sum = r.exemptPence + r.standardNetPence + r.outsideScopePence + r.unmappedPence;
        expect(sum).toBe(r.totalPence);
        expect(sum).toBe(lines.reduce((n, l) => n + l.amountPence, 0));
    });

    it('treats an empty mapping as everything unmapped, not everything exempt', () => {
        const r = splitRevenueByLiability(lines, {});
        expect(r.exemptPence).toBe(0);
        expect(r.standardNetPence).toBe(0);
        expect(r.unmappedPence).toBe(lines.reduce((n, l) => n + l.amountPence, 0));
    });
});

describe('outputVat', () => {
    it('adds VAT when prices are quoted net', () => {
        expect(outputVat({ standardNetPence: 10_000_00, standardRatePct: 20 }))
            .toEqual({ vatPence: 2_000_00, netPence: 10_000_00, grossPence: 12_000_00 });
    });

    // A practice listing "Whitening £300" is quoting VAT-inclusive. Charging
    // 20% on top would overstate the liability by a fifth.
    it('extracts VAT with the VAT fraction when prices include VAT', () => {
        const r = outputVat({ standardNetPence: 12_000_00, standardRatePct: 20, pricesIncludeVat: true });
        expect(r.vatPence).toBe(2_000_00);     // 1/6 of the gross
        expect(r.netPence).toBe(10_000_00);
        expect(r.grossPence).toBe(12_000_00);
    });

    it('is nil on no standard-rated supplies', () => {
        expect(outputVat({ standardNetPence: 0, standardRatePct: 20 }).vatPence).toBe(0);
    });
});

describe('registrationStatus', () => {
    // The figure that matters is TAXABLE turnover. A large practice whose
    // income is all exempt dental care may have no duty to register at all.
    it('tests taxable turnover, not total turnover', () => {
        const r = registrationStatus({
            ...RATES, taxableTurnover12mPence: 12_000_00, isRegistered: false,
        });
        expect(r.overThreshold).toBe(false);
    });

    it('flags crossing the registration threshold', () => {
        const r = registrationStatus({
            ...RATES, taxableTurnover12mPence: 90_000_00, isRegistered: false,
        });
        expect(r.overThreshold).toBe(true);
    });

    // Unclassified revenue must produce "cannot tell", not a confident "no".
    it('says indeterminate when unmapped revenue could cross the threshold', () => {
        const r = registrationStatus({
            ...RATES,
            taxableTurnover12mPence: 60_000_00,
            unmappedTurnover12mPence: 41_000_00,
            isRegistered: false,
        });
        expect(r.overThreshold).toBe(false);
        expect(r.indeterminate).toBe(true);
    });

    it('only considers deregistration for someone already registered', () => {
        const notReg = registrationStatus({ ...RATES, taxableTurnover12mPence: 1_000_00, isRegistered: false });
        const reg = registrationStatus({ ...RATES, taxableTurnover12mPence: 1_000_00, isRegistered: true });
        expect(notReg.belowDeregistrationThreshold).toBe(false);
        expect(reg.belowDeregistrationThreshold).toBe(true);
    });
});

describe('normaliseDescription', () => {
    // Real names from this org's PMS carry trailing and doubled whitespace.
    it('collapses whitespace and case so one treatment is one key', () => {
        expect(normaliseDescription('Composite Filling ')).toBe('composite filling');
        expect(normaliseDescription('Zirconia Implant Crown  ')).toBe('zirconia implant crown');
        expect(normaliseDescription('COMPOSITE  filling')).toBe('composite filling');
    });

    it('matches a mapping stored under the normalised key', () => {
        const r = splitRevenueByLiability(
            [{ description: 'Composite Filling ', amountPence: 1000 }],
            { 'composite filling': LIABILITY.EXEMPT },
        );
        expect(r.exemptPence).toBe(1000);
        expect(r.unmappedPence).toBe(0);
    });

    it('groups two spellings into ONE unmapped row, not two', () => {
        const r = splitRevenueByLiability([
            { description: 'Scale & Polish', amountPence: 500 },
            { description: 'Scale & Polish ', amountPence: 500 },
        ], {});
        expect(r.unmapped).toHaveLength(1);
        expect(r.unmapped[0].amountPence).toBe(1000);
    });
});
