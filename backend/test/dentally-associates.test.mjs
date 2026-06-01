// Dentally sync — practitioner mapper + appointment->associate linkage.
import { describe, it, expect } from 'vitest';
import './setup.js';
import { practitionerRow, appointmentRow, treatmentPlanRow } from '../src/lib/integrations/dentally-sync.js';

const ORG = 'org-aaaaaaaa';
const siteMap = new Map([['7', 'prac-7']]);

describe('practitionerRow', () => {
    it('maps a Dentally practitioner to an associate upsert row', () => {
        const row = practitionerRow(ORG, { id: 55, first_name: 'Sarah', last_name: 'Mitchell', email_address: 's@x.co', site_id: 7 }, siteMap);
        expect(row).toMatchObject({
            organisation_id: ORG,
            pms_external_id: '55',
            full_name: 'Sarah Mitchell',
            email: 's@x.co',
            primary_practice_id: 'prac-7',
            active: true,
        });
    });
    it('reads the real name from the nested user object (live Dentally shape)', () => {
        const row = practitionerRow(ORG, {
            id: 102519, site_id: 7, active: false,
            user: { first_name: 'Gaurav', last_name: 'Mehta', title: 'Dr', email: 'g@x.co' },
        }, siteMap);
        expect(row.full_name).toBe('Dr Gaurav Mehta');
        expect(row.email).toBe('g@x.co');
        expect(row.active).toBe(false);
    });
    it('falls back to a name when only an id is present, and null practice for unmapped site', () => {
        const row = practitionerRow(ORG, { id: 9, site_id: 999 }, siteMap);
        expect(row.full_name).toBe('Practitioner 9');
        expect(row.primary_practice_id).toBeNull();
    });
});

describe('appointmentRow practitioner linkage', () => {
    const contactMap = new Map();
    const base = { id: 1, practitioner_site_id: 7, start_time: '2026-05-01T09:00:00Z', finish_time: '2026-05-01T09:30:00Z', state: 'confirmed' };
    it('sets associate_id from the practitioner map', () => {
        const pmap = new Map([['55', 'assoc-55']]);
        const row = appointmentRow(ORG, { ...base, practitioner_id: 55 }, siteMap, contactMap, pmap);
        expect(row.associate_id).toBe('assoc-55');
    });
    it('null associate_id when practitioner is unmapped or absent', () => {
        const pmap = new Map([['55', 'assoc-55']]);
        expect(appointmentRow(ORG, { ...base, practitioner_id: 999 }, siteMap, contactMap, pmap).associate_id).toBeNull();
        expect(appointmentRow(ORG, base, siteMap, contactMap, pmap).associate_id).toBeNull();
    });
    it('still works with no practitionerMap arg (webhook/back-compat)', () => {
        const row = appointmentRow(ORG, { ...base, practitioner_id: 55 }, siteMap, contactMap);
        expect(row.associate_id).toBeNull();
    });
    it('persists pms_practitioner_id for later relink, even when unmapped', () => {
        const row = appointmentRow(ORG, { ...base, practitioner_id: 999 }, siteMap, contactMap, new Map());
        expect(row.associate_id).toBeNull();
        expect(row.pms_practitioner_id).toBe('999');
    });
    it('pms_practitioner_id is null when the appointment carries no practitioner', () => {
        expect(appointmentRow(ORG, base, siteMap, contactMap).pms_practitioner_id).toBeNull();
    });
});

describe('appointmentRow treatment type', () => {
    const contactMap = new Map();
    const base = { id: 1, practitioner_site_id: 7, start_time: '2026-05-01T09:00:00Z', finish_time: '2026-05-01T09:30:00Z', state: 'confirmed' };
    it('maps an explicit appointment_type', () => {
        const row = appointmentRow(ORG, { ...base, appointment_type: 'Invisalign' }, siteMap, contactMap);
        expect(row.appointment_type).toBe('Invisalign');
    });
    it('falls back to the free-text reason', () => {
        const row = appointmentRow(ORG, { ...base, reason: 'Composite Bonding' }, siteMap, contactMap);
        expect(row.appointment_type).toBe('Composite Bonding');
    });
    it('prefers appointment_type over reason when both present', () => {
        const row = appointmentRow(ORG, { ...base, appointment_type: 'Implant', reason: 'check-up' }, siteMap, contactMap);
        expect(row.appointment_type).toBe('Implant');
    });
    it('null when neither is present', () => {
        const row = appointmentRow(ORG, base, siteMap, contactMap);
        expect(row.appointment_type).toBeNull();
    });
});

describe('treatmentPlanRow (production)', () => {
    const assocMap = new Map([['189834', 'assoc-x']]);
    const contactMap = new Map([['9354', 'cont-x']]);
    const tp = {
        id: 67920, practitioner_id: 189834, patient_id: 9354,
        private_treatment_value: '850.5', nhs_uda_value: '3.0', nhs_completed_uda_value: null,
        completed: true, completed_at: '2026-06-01T11:15:54.814+01:00',
        start_date: '2026-06-01', end_date: '2026-06-01',
    };
    it('maps production to integer pence and resolves associate + contact', () => {
        const row = treatmentPlanRow(ORG, tp, assocMap, contactMap);
        expect(row).toMatchObject({
            organisation_id: ORG, source: 'dentally', pms_external_id: '67920',
            pms_practitioner_id: '189834', pms_patient_id: '9354',
            associate_id: 'assoc-x', contact_id: 'cont-x',
            private_value_pence: 85050, nhs_uda_value: 3, completed: true,
        });
    });
    it('null associate/contact when unmapped; nhs values null-safe', () => {
        const row = treatmentPlanRow(ORG, { id: 1, practitioner_id: 7, patient_id: 8, private_treatment_value: '0.0' });
        expect(row.associate_id).toBeNull();
        expect(row.contact_id).toBeNull();
        expect(row.private_value_pence).toBe(0);
        expect(row.nhs_uda_value).toBeNull();
        expect(row.pms_practitioner_id).toBe('7'); // persisted for later relink
    });
});
