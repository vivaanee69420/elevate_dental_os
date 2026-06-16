// Dentally sync — treatment_plan_item mapper (Practitioner Activity feed).
import { describe, it, expect } from 'vitest';
import './setup.js';
import { treatmentItemRow } from '../src/lib/integrations/dentally-sync.js';

const ORG = 'org-aaaaaaaa';
const practiceByPractitioner = new Map([['201101', 'prac-ashford']]);
const associateMap = new Map([['201101', 'assoc-x']]);
const contactMap = new Map([['25136', 'cont-x']]);

// A live-shaped completed treatment line (the SENSITIVE clinical fields teeth /
// surfaces / notes / custom_fields are present in the API payload and MUST be
// dropped on the way in).
const item = {
    id: 2972956114,
    completed: true,
    completed_at: '2026-06-15T21:39:12.292+01:00',
    base_chart: false,
    charged: true,
    appear_on_invoice: true,
    duration: 30,
    price: '450.0',
    practitioner_id: 201101,
    patient_id: 25136,
    treatment_plan_id: 68320,
    treatment_appointment_id: 778899,
    invoice_id: 5421,
    nomenclature: 'RCT - Incisor/Canines',
    patient_nomenclature: 'Root canal',
    teeth: [11, 21],
    surfaces: ['mesial'],
    notes: '<p>clinical free text — must not be stored</p>',
    custom_fields: [{ id: 1, value: 'secret' }],
};

describe('treatmentItemRow (Practitioner Activity feed)', () => {
    it('maps price to integer pence and resolves practice/associate/contact', () => {
        const row = treatmentItemRow(ORG, item, practiceByPractitioner, associateMap, contactMap);
        expect(row).toMatchObject({
            organisation_id: ORG, source: 'dentally', pms_external_id: '2972956114',
            pms_practitioner_id: '201101', pms_patient_id: '25136',
            practice_id: 'prac-ashford', associate_id: 'assoc-x', contact_id: 'cont-x',
            treatment_plan_id: '68320', treatment_appointment_id: '778899', pms_invoice_id: '5421',
            treatment_name: 'Root canal', price_pence: 45000, duration: 30,
            completed: true, base_chart: false, charged: true, appear_on_invoice: true,
        });
        expect(row.completed_at).toBe('2026-06-15T21:39:12.292+01:00');
    });

    it('NEVER stores sensitive clinical detail (teeth/surfaces/notes/custom_fields)', () => {
        const row = treatmentItemRow(ORG, item, practiceByPractitioner, associateMap, contactMap);
        expect(row).not.toHaveProperty('teeth');
        expect(row).not.toHaveProperty('surfaces');
        expect(row).not.toHaveProperty('notes');
        expect(row).not.toHaveProperty('custom_fields');
    });

    it('flags base_chart charting rows so the rollup RPC can exclude them', () => {
        const row = treatmentItemRow(ORG, { ...item, base_chart: true }, practiceByPractitioner);
        expect(row.base_chart).toBe(true);
    });

    it('falls back to nomenclature when no patient_nomenclature; pence/duration default to 0', () => {
        const row = treatmentItemRow(ORG, { id: 9, practitioner_id: 201101, patient_id: 25136, completed: true, nomenclature: 'Exam' });
        expect(row.treatment_name).toBe('Exam');
        expect(row.price_pence).toBe(0);
        expect(row.duration).toBe(0);
    });

    it('null practice/associate/contact when the practitioner/patient are unmapped; ids persist for relink', () => {
        const row = treatmentItemRow(ORG, { id: 5, practitioner_id: 999, patient_id: 888, completed: true, price: '10.0' });
        expect(row.practice_id).toBeNull();
        expect(row.associate_id).toBeNull();
        expect(row.contact_id).toBeNull();
        expect(row.pms_practitioner_id).toBe('999');
        expect(row.pms_patient_id).toBe('888');
        expect(row.price_pence).toBe(1000);
    });
});
