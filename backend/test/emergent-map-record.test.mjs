// backend/test/emergent-map-record.test.mjs
// Unit tests for the Emergent record mapper. Real payload shape (no record id,
// no status field, amount is float GBP). See emergent-sync.js.
import { describe, it, expect } from 'vitest';
const { mapRecord } = await import('../src/lib/integrations/emergent-sync.js');

const ORG = '00000000-0000-0000-0000-000000000001';
const REC = {
  business_id: '25442cca-f21f-446e-af74-123c8626c36c',
  business_name: 'Ashford',
  date: '2026-06-10',
  patient_name: 'Clarissa Ward',
  treatment_accepted: 'Composite restoration',
  quantity: 1,
  amount: 3346.0,
  source: 'google',
  campaign: '',
  dentist: 'Akash',
  comments: '',
};

describe('emergent mapRecord', () => {
  it('converts amount (float GBP) to integer pence', () => {
    expect(mapRecord({ ...REC, amount: 6328.62 }, ORG).value_pence).toBe(632862);
    expect(mapRecord({ ...REC, amount: 532.5 }, ORG).value_pence).toBe(53250);
    expect(mapRecord({ ...REC, amount: 175 }, ORG).value_pence).toBe(17500);
  });

  it('forces status to accepted (endpoint returns only accepted; aggregate filters on it)', () => {
    expect(mapRecord(REC, ORG).status).toBe('accepted');
  });

  it('maps names, date and source fields', () => {
    const r = mapRecord(REC, ORG);
    expect(r.organisation_id).toBe(ORG);
    expect(r.source).toBe('emergent');
    expect(r.patient_name).toBe('Clarissa Ward');
    expect(r.treatment_name).toBe('Composite restoration');
    expect(r.practitioner_name).toBe('Akash');
    expect(r.accepted_date).toBe('2026-06-10');
    expect(r.patient_external_id).toBeNull();
  });

  it('coerces empty strings to null', () => {
    const r = mapRecord({ ...REC, treatment_accepted: '', dentist: '' }, ORG);
    expect(r.treatment_name).toBeNull();
    expect(r.practitioner_name).toBeNull();
  });

  it('derives a deterministic external_id (same record -> same key)', () => {
    expect(mapRecord(REC, ORG).external_id).toBe(mapRecord({ ...REC }, ORG).external_id);
  });

  it('different records -> different external_id', () => {
    const a = mapRecord(REC, ORG).external_id;
    const b = mapRecord({ ...REC, patient_name: 'Someone Else' }, ORG).external_id;
    expect(a).not.toBe(b);
  });

  it('resolves practice_id by business_name substring against full practice name', () => {
    const map = new Map([
      ['gm dental & implant centre ashford', 'prac-ashford'],
      ['gm dental & implant centre - rochester', 'prac-rochester'],
    ]);
    expect(mapRecord(REC, ORG, map).practice_id).toBe('prac-ashford');
    expect(mapRecord({ ...REC, business_name: 'Rochester' }, ORG, map).practice_id).toBe('prac-rochester');
  });

  it('leaves practice_id null when no practice matches', () => {
    const map = new Map([['somewhere else', 'prac-x']]);
    expect(mapRecord(REC, ORG, map).practice_id).toBeNull();
  });

  it('persists phone, email, quantity, source and campaign (previously raw-only)', () => {
    const r = mapRecord(
      { ...REC, phone: '07700 900 111', email: 'a@b.com', quantity: 2, source: 'Google', campaign: 'PPC-Aug' },
      ORG,
    );
    expect(r.phone).toBe('07700 900 111');
    expect(r.email).toBe('a@b.com');
    expect(r.quantity).toBe(2);
    expect(r.ext_source).toBe('Google');
    expect(r.ext_campaign).toBe('PPC-Aug');
  });
  it('defaults quantity to 1 and coerces empty source/campaign to null', () => {
    const r = mapRecord({ ...REC, quantity: undefined, source: '', campaign: '' }, ORG);
    expect(r.quantity).toBe(1);
    expect(r.ext_source).toBeNull();
    expect(r.ext_campaign).toBeNull();
  });
});

describe('emergent mapRecord explicit resolution', () => {
  const REC2 = {
    business_id: 'biz-1', business_name: 'Ashford', date: '2026-06-10',
    patient_name: 'P', treatment_accepted: 'X', amount: 100, dentist: 'D',
  };

  it('sets business_id on the row', () => {
    expect(mapRecord(REC2, ORG).business_id).toBe('biz-1');
  });

  it('explicit map wins over fuzzy and resolves by business_id', () => {
    const maps = {
      explicit: new Map([['biz-1', 'prac-explicit']]),
      fuzzy: new Map([['ashford', 'prac-fuzzy']]),
    };
    expect(mapRecord(REC2, ORG, maps).practice_id).toBe('prac-explicit');
  });

  it('explicit null forces unmapped (does NOT fall back to fuzzy)', () => {
    const maps = {
      explicit: new Map([['biz-1', null]]),
      fuzzy: new Map([['ashford', 'prac-fuzzy']]),
    };
    expect(mapRecord(REC2, ORG, maps).practice_id).toBeNull();
  });

  it('falls back to fuzzy when no explicit row exists for the business', () => {
    const maps = {
      explicit: new Map(),
      fuzzy: new Map([['ashford', 'prac-fuzzy']]),
    };
    expect(mapRecord(REC2, ORG, maps).practice_id).toBe('prac-fuzzy');
  });

  it('still accepts a legacy plain Map as the fuzzy map (back-compat)', () => {
    const legacy = new Map([['ashford', 'prac-legacy']]);
    expect(mapRecord(REC2, ORG, legacy).practice_id).toBe('prac-legacy');
  });
});
