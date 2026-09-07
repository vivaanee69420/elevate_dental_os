import { describe, it, expect } from 'vitest';
import { assertNoPatientData } from '../src/lib/ai/pii-guard.js';

// The bundle every AI surface is actually built from today: aggregates, plus
// practice/entity/clinician LABELS. If this shape ever stops passing, the guard
// has become too aggressive and would take the AI features down with it.
const REAL_BUNDLE = {
    pl: { revenuePence: 5266162, netPence: 812300, marginPct: 15.4, entities: [{ name: 'GM Dental Ashford', revPence: 1200000 }] },
    practices: [{ name: 'Rochester', cashPence: 900000, productionPence: 1100000, marginPct: 12.1 }],
    clinicians: { top: [{ name: 'Dr A Patel', productionPence: 450000, payPct: 45 }] },
    funnel: { leads: 1708, converted: 33, conversionRatePct: 1.9 },
    chairs: { totalChairs: 12, occupancyPct: 78, practices: [{ name: 'Ashford', chairs: 4 }] },
    meta: { period_key: '2026-09', currency: 'pence' },
};

describe('assertNoPatientData', () => {
    it('passes the real aggregate bundle untouched', () => {
        expect(() => assertNoPatientData(REAL_BUNDLE)).not.toThrow();
    });

    // `name` must stay legal: practices, entities and clinicians all use it,
    // and banning it would break every surface while catching no patient.
    it('allows practice, entity and clinician name labels', () => {
        expect(() => assertNoPatientData({ practices: [{ name: 'Barnet' }] })).not.toThrow();
    });

    it('rejects a patient name field however deeply it is nested', () => {
        expect(() => assertNoPatientData({ a: { b: [{ patient_name: 'J Smith' }] } }))
            .toThrow(/patient-identifying field "patient_name"/);
    });

    it.each(['first_name', 'last_name', 'date_of_birth', 'nhs_number', 'postcode', 'notes', 'pms_patient_id'])(
        'rejects %s', (key) => {
            expect(() => assertNoPatientData({ [key]: 'x' })).toThrow(/patient-identifying field/);
        },
    );

    it('is case-insensitive about the key', () => {
        expect(() => assertNoPatientData({ Email: 'a@b.com' })).toThrow(/patient-identifying field/);
    });

    // Renaming the column must not defeat the guard — this is why values are
    // checked as well as keys.
    it('catches an email hidden under an innocuous key', () => {
        expect(() => assertNoPatientData({ label: 'contact jane.doe@example.com now' }))
            .toThrow(/an email address reached the AI context/);
    });

    it('catches a UK phone number hidden under an innocuous key', () => {
        expect(() => assertNoPatientData({ label: 'ring 07700 900123' }))
            .toThrow(/a phone number reached the AI context/);
    });

    // Money and counts are the whole point of the bundle; they must never trip
    // the phone matcher.
    it('does not mistake pence figures or percentages for phone numbers', () => {
        expect(() => assertNoPatientData({
            revenuePence: 5266162, bankBalancePence: 1234567890, marginPct: 15.4,
            label: 'Turnover down 49.8% to £52,661.62', period: '2026-09-06',
        })).not.toThrow();
    });

    it('names the path but never echoes the value', () => {
        try {
            assertNoPatientData({ practices: [{ email: 'secret@example.com' }] });
            throw new Error('should have thrown');
        } catch (e) {
            expect(e.message).toContain('practices.0');
            expect(e.message).not.toContain('secret@example.com');
        }
    });

    it('survives a cyclic object instead of hanging', () => {
        const a = { practices: [] };
        a.self = a;
        expect(() => assertNoPatientData(a)).not.toThrow();
    });

    it('accepts null and undefined bundles', () => {
        expect(() => assertNoPatientData(null)).not.toThrow();
        expect(() => assertNoPatientData(undefined)).not.toThrow();
    });
});
