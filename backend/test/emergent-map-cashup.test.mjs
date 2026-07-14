import { describe, it, expect } from 'vitest';
const { mapCashup, cashupExternalId } = await import('../src/lib/integrations/emergent-sync.js');

const ORG = '00000000-0000-0000-0000-000000000001';
const DATA = {
  id: 'biz1_2026-08-20', business_id: 'biz1', business_name: 'Ashford', date: '2026-08-20',
  treatments_accepted: 2, num_treatment_accepted: 2,
  tx_plans_given: 3, total_tx_plan_given_value: 12000.0,
  cash_up_money_taken: 1850.0,
  num_bookings: 6, num_new_leads: 9, num_follow_ups: 4, num_attended: 8,
  chair_utilisation: 85.5, total_chairs: 5, chairs_used: 4,
  reviews_collected: 4, before_after_pictures: 3, video_testimonials: 2, practice_plan_signups: 1,
  total_refunds: 50.0,
  refunds: [{ amount: 50, reason: 'Cancelled scale & polish', patient_name: 'J. Bloggs' }],
  source_google: 3, source_facebook: 2, source_walk_in: 1, source_referred: 2,
  appointment_booked_for: 'Follow-up next week', crm_system_notes: 'All entered in Nexus',
  patients: [{
    patient_name: 'Sarah Wong', phone: '07700 900 111', email: 'sarah@ex.com',
    treatment_accepted: 'Invisalign', amount: 4500, quantity: 1,
    source: 'Google', campaign: 'PPC-Aug', dentist: 'Dr Jones', comments: 'Signed today',
  }],
  detail_patient_rows_count: 1, detail_patient_money_total: 4500.0, variance_manager_vs_detail: 1,
  created_at: '2026-07-14T12:01:07.746418+00:00', created_by: 'user-1',
};

describe('mapCashup', () => {
  it('maps money fields to integer pence', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.cash_up_money_taken_pence).toBe(185000);
    expect(row.tx_plan_given_value_pence).toBe(1200000);
    expect(row.total_refunds_pence).toBe(5000);
    expect(row.detail_patient_money_total_pence).toBe(450000);
  });
  it('maps counts and chair utilisation', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.treatments_accepted).toBe(2);
    expect(row.num_attended).toBe(8);
    expect(row.chair_utilisation).toBe(85.5);
    expect(row.organisation_id).toBe(ORG);
    expect(row.cashup_date).toBe('2026-08-20');
  });
  it('splits known source_* into columns and custom sources into custom_sources', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.source_google).toBe(3);
    expect(row.source_facebook).toBe(2);
    expect(row.source_walk_in).toBe(1);
    expect(row.source_youtube).toBe(0);
    expect(row.custom_sources).toEqual({ referred: 2 });
  });
  it('normalises refunds to pence', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.refunds).toEqual([{ amount_pence: 5000, reason: 'Cancelled scale & polish', patient_name: 'J. Bloggs' }]);
  });
  it('derives external_id from business_id + date, stable across re-saves', () => {
    expect(mapCashup(DATA, ORG).row.external_id).toBe(cashupExternalId(DATA));
    expect(mapCashup(DATA, ORG).row.external_id).toBe(mapCashup({ ...DATA }, ORG).row.external_id);
  });
  it('maps patients[] into treatment_accepted rows (same external_id path)', () => {
    const { patients } = mapCashup(DATA, ORG);
    expect(patients).toHaveLength(1);
    expect(patients[0].value_pence).toBe(450000);
    expect(patients[0].phone).toBe('07700 900 111');
    expect(patients[0].business_id).toBe('biz1');
    expect(patients[0].accepted_date).toBe('2026-08-20');
    expect(patients[0].organisation_id).toBe(ORG);
  });
  it('stores variance verbatim and keeps the full raw payload', () => {
    const { row } = mapCashup(DATA, ORG);
    expect(row.variance_manager_vs_detail).toBe(1);
    expect(row.raw).toBe(DATA);
  });
});
