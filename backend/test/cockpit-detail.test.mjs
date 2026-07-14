import './setup.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/cockpit.repository.js', () => ({
  cockpitRepository: {
    pipelineChannelMap: vi.fn(async () => [
      { pipeline_id: 'fb1', name: '1. Facebook Ads Leads', practice_id: 'P1', practice_label: 'Ashford' },
      { pipeline_id: 'g1', name: '2. Google Ads Leads', practice_id: 'P1', practice_label: 'Ashford' },
    ]),
    leadsDetailRows: vi.fn(async () => [
      { id: 'l1', contact_id: 'c1', ghl_pipeline_id: 'fb1', practice_id: 'P1', created_at: '2026-07-02T10:00:00Z', contacts: { first_name: 'Jane', last_name: 'Doe', phone: '07700 900111', email: 'jane@doe.com' } },
      { id: 'l2', contact_id: 'c2', ghl_pipeline_id: 'g1', practice_id: 'P1', created_at: '2026-07-01T09:00:00Z', contacts: { first_name: 'Sam', last_name: 'Smith', phone: '07700 900999', email: 'sam@smith.com' } },
    ]),
    acceptedContactsInWindow: vi.fn(async () => []),
    acceptedForMatching: vi.fn(async () => [
      { practice_id: 'P1', value_pence: 450000, phone: '+44 7700 900111', email: null, patient_name: 'Jane Doe', treatment_name: 'Implant', accepted_date: '2026-07-02', raw: {} },
    ]),
    acceptedLeadSource: vi.fn(async () => [
      { accepted_id: 't1', ghl_pipeline_id: 'fb1', lead_created_at: '2026-06-02T10:00:00Z' },
    ]),
    treatmentsDetailRows: vi.fn(async () => [
      { id: 't1', accepted_date: '2026-07-02', practice_id: 'P1', patient_name: 'Jane Doe', treatment_name: 'Implant', value_pence: 250000, ext_source: 'facebook', raw: {}, practices: { name: 'Ashford' } },
      { id: 't2', accepted_date: '2026-07-01', practice_id: 'P1', patient_name: 'Sam Smith', treatment_name: 'Whitening', value_pence: 30000, ext_source: null, raw: { source: 'walk_in' }, practices: { name: 'Ashford' } },
    ]),
    cashupDaysDetailRows: vi.fn(async () => [
      { cashup_date: '2026-07-02', practice_id: 'P1', business_name: 'Ashford', cash_up_money_taken_pence: 185000, detail_patient_money_total_pence: 175000, tx_plans_given: 3, tx_plan_given_value_pence: 130500, num_new_leads: 8, num_attended: 2, refunds: [{ amountPence: 5000, reason: 'goodwill' }], practices: { name: 'Ashford' } },
      { cashup_date: '2026-07-01', practice_id: null, business_name: 'Unmapped Biz', cash_up_money_taken_pence: 50000, detail_patient_money_total_pence: 60000, tx_plans_given: 0, tx_plan_given_value_pence: 0, num_new_leads: 0, num_attended: 0, refunds: [], practices: null },
    ]),
  },
}));

let cockpitService, cockpitRepository;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ cockpitService } = await import('../src/services/cockpit.service.js'));
  ({ cockpitRepository } = await import('../src/repositories/cockpit.repository.js'));
  cockpitRepository.pipelineChannelMap.mockImplementation(async () => [
    { pipeline_id: 'fb1', name: '1. Facebook Ads Leads', practice_id: 'P1', practice_label: 'Ashford' },
    { pipeline_id: 'g1', name: '2. Google Ads Leads', practice_id: 'P1', practice_label: 'Ashford' },
  ]);
  cockpitRepository.leadsDetailRows.mockImplementation(async () => [
    { id: 'l1', contact_id: 'c1', ghl_pipeline_id: 'fb1', practice_id: 'P1', created_at: '2026-07-02T10:00:00Z', contacts: { first_name: 'Jane', last_name: 'Doe', phone: '07700 900111', email: 'jane@doe.com' } },
    { id: 'l2', contact_id: 'c2', ghl_pipeline_id: 'g1', practice_id: 'P1', created_at: '2026-07-01T09:00:00Z', contacts: { first_name: 'Sam', last_name: 'Smith', phone: '07700 900999', email: 'sam@smith.com' } },
  ]);
  cockpitRepository.acceptedForMatching.mockImplementation(async () => [
    { practice_id: 'P1', value_pence: 450000, phone: '+44 7700 900111', email: null, patient_name: 'Jane Doe', treatment_name: 'Implant', accepted_date: '2026-07-02', raw: {} },
  ]);
  cockpitRepository.acceptedLeadSource.mockImplementation(async () => [
    { accepted_id: 't1', ghl_pipeline_id: 'fb1', lead_created_at: '2026-06-02T10:00:00Z' },
  ]);
  cockpitRepository.treatmentsDetailRows.mockImplementation(async () => [
    { id: 't1', accepted_date: '2026-07-02', practice_id: 'P1', patient_name: 'Jane Doe', treatment_name: 'Implant', value_pence: 250000, ext_source: 'facebook', raw: {}, practices: { name: 'Ashford' } },
    { id: 't2', accepted_date: '2026-07-01', practice_id: 'P1', patient_name: 'Sam Smith', treatment_name: 'Whitening', value_pence: 30000, ext_source: null, raw: { source: 'walk_in' }, practices: { name: 'Ashford' } },
  ]);
  cockpitRepository.cashupDaysDetailRows.mockImplementation(async () => [
    { cashup_date: '2026-07-02', practice_id: 'P1', business_name: 'Ashford', cash_up_money_taken_pence: 185000, detail_patient_money_total_pence: 175000, tx_plans_given: 3, tx_plan_given_value_pence: 130500, num_new_leads: 8, num_attended: 2, refunds: [{ amountPence: 5000, reason: 'goodwill' }], practices: { name: 'Ashford' } },
    { cashup_date: '2026-07-01', practice_id: null, business_name: 'Unmapped Biz', cash_up_money_taken_pence: 50000, detail_patient_money_total_pence: 60000, tx_plans_given: 0, tx_plan_given_value_pence: 0, num_new_leads: 0, num_attended: 0, refunds: [], practices: null },
  ]);
});

describe('cockpitService.leadsDetail', () => {
  it('shapes lines with id/createdAt/practiceName/channel/pipelineName/name/email/phone, marks matched leads converted with matchedValuePence, unmatched converted=false/0', async () => {
    const r = await cockpitService.leadsDetail('org1', { since: '2026-07-01', until: '2026-07-15' });
    expect(r.window).toEqual({ since: '2026-07-01', until: '2026-07-15' });
    expect(r.limit).toBe(100);
    expect(r.offset).toBe(0);
    expect(r.lines).toHaveLength(2);

    const l1 = r.lines.find(l => l.id === 'l1');
    expect(l1).toEqual({
      id: 'l1',
      contactId: 'c1',
      createdAt: '2026-07-02T10:00:00Z',
      practiceName: 'Ashford',
      channel: 'facebook',
      pipelineName: '1. Facebook Ads Leads',
      name: 'Jane Doe',
      email: 'jane@doe.com',
      phone: '07700 900111',
      converted: true,
      matchedValuePence: 450000,
      matchedTreatmentName: 'Implant',
      matchedPatientName: 'Jane Doe',
      matchedAcceptedDate: '2026-07-02',
    });

    const l2 = r.lines.find(l => l.id === 'l2');
    expect(l2.channel).toBe('google');
    expect(l2.pipelineName).toBe('2. Google Ads Leads');
    expect(l2.converted).toBe(false);
    expect(l2.matchedValuePence).toBe(0);
    expect(l2.matchedTreatmentName).toBeNull();
    expect(l2.matchedPatientName).toBeNull();
    expect(l2.matchedAcceptedDate).toBeNull();
  });

  it('threads practiceId + limit/offset to the repo reads', async () => {
    await cockpitService.leadsDetail('org1', { since: '2026-07-01', until: '2026-07-15', practiceId: 'P1', limit: 50, offset: 10 });
    expect(cockpitRepository.leadsDetailRows).toHaveBeenCalledWith('org1', '2026-07-01', '2026-07-15', 'P1', 50, 10);
    // pipes load org-wide (a lead's pipeline resolves the same way whatever
    // the view is scoped to) and the accepted side is open-ended.
    expect(cockpitRepository.pipelineChannelMap).toHaveBeenCalledWith('org1');
    expect(cockpitRepository.acceptedForMatching).toHaveBeenCalledWith('org1', '2026-07-01');
  });

  it('caps limit at 500 and defaults to 100', async () => {
    await cockpitService.leadsDetail('org1', { since: '2026-07-01', until: '2026-07-15', limit: 9999 });
    expect(cockpitRepository.leadsDetailRows).toHaveBeenCalledWith('org1', '2026-07-01', '2026-07-15', undefined, 500, 0);
  });

  it('filters by channel when given', async () => {
    const r = await cockpitService.leadsDetail('org1', { since: '2026-07-01', until: '2026-07-15', channel: 'google' });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].channel).toBe('google');
  });
});

describe('cockpitService.treatmentsDetail', () => {
  it('shapes lines from treatment_accepted rows, source falls back to raw.source', async () => {
    const r = await cockpitService.treatmentsDetail('org1', { since: '2026-07-01', until: '2026-07-15' });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toEqual({
      id: 't1',
      acceptedDate: '2026-07-02',
      practiceName: 'Ashford',
      patientName: 'Jane Doe',
      treatmentName: 'Implant',
      valuePence: 250000,
      source: 'facebook',
      leadChannel: 'facebook',
      leadPipelineName: '1. Facebook Ads Leads',
      leadCreatedAt: '2026-06-02T10:00:00Z',
    });
    expect(r.lines[1].source).toBe('walk_in');
    // t2 has no matching pipeline lead — the ad tags stay null rather than guessing.
    expect(r.lines[1].leadChannel).toBeNull();
    expect(r.lines[1].leadPipelineName).toBeNull();
    expect(r.limit).toBe(100);
    expect(r.offset).toBe(0);
  });

  it('threads practiceId + limit/offset to the repo', async () => {
    await cockpitService.treatmentsDetail('org1', { since: '2026-07-01', until: '2026-07-15', practiceId: 'P1', limit: 20, offset: 5 });
    expect(cockpitRepository.treatmentsDetailRows).toHaveBeenCalledWith('org1', '2026-07-01', '2026-07-15', 'P1', 20, 5);
  });
});

describe('cockpitService.cashupDaysDetail', () => {
  it('shapes lines with variancePence = cashTakenPence - detailPence, refunds passed through, name falls back to business_name when unmapped', async () => {
    const r = await cockpitService.cashupDaysDetail('org1', { since: '2026-07-01', until: '2026-07-15' });
    expect(r.window).toEqual({ since: '2026-07-01', until: '2026-07-15' });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toEqual({
      cashupDate: '2026-07-02',
      practiceName: 'Ashford',
      cashTakenPence: 185000,
      detailPence: 175000,
      variancePence: 10000,
      txPlansGiven: 3,
      txPlanValuePence: 130500,
      newLeads: 8,
      attended: 2,
      refunds: [{ amountPence: 5000, reason: 'goodwill' }],
    });
    expect(r.lines[1]).toEqual({
      cashupDate: '2026-07-01',
      practiceName: 'Unmapped Biz',
      cashTakenPence: 50000,
      detailPence: 60000,
      variancePence: -10000,
      txPlansGiven: 0,
      txPlanValuePence: 0,
      newLeads: 0,
      attended: 0,
      refunds: [],
    });
  });

  it('threads practiceId to the repo', async () => {
    await cockpitService.cashupDaysDetail('org1', { since: '2026-07-01', until: '2026-07-15', practiceId: 'P1' });
    expect(cockpitRepository.cashupDaysDetailRows).toHaveBeenCalledWith('org1', '2026-07-01', '2026-07-15', 'P1', 100, 0);
  });
});
