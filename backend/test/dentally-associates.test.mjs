// Dentally sync — practitioner mapper + appointment->associate linkage.
import { describe, it, expect } from 'vitest';
import './setup.js';
import { practitionerRow, appointmentRow } from '../src/lib/integrations/dentally-sync.js';

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
