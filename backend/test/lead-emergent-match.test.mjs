// The Emergent matcher is shared by the Daily Cockpit and the /ad-performance
// page. These tests pin its behaviour so the extraction from
// lead-attribution.service.js cannot change it.
import { describe, it, expect } from 'vitest';
import {
  normPhone, normEmail, normName, buildAcceptedByKey, matchAcceptedValue,
} from '../src/lib/lead-emergent-match.js';

describe('normalisers', () => {
  it('normPhone keeps the last 10 digits and drops punctuation', () => {
    expect(normPhone('+44 7700 900123')).toBe('7700900123');
    expect(normPhone('07700900123')).toBe('7700900123');
  });

  it('normPhone returns null for empty input rather than an empty string', () => {
    // An empty-string key would match every blank-phone record at once.
    expect(normPhone('')).toBeNull();
    expect(normPhone(null)).toBeNull();
    expect(normPhone('---')).toBeNull();
  });

  it('normEmail trims and lowercases', () => {
    expect(normEmail('  Jo@Example.COM ')).toBe('jo@example.com');
    expect(normEmail('')).toBeNull();
  });

  it('normName collapses whitespace and accepts one or two arguments', () => {
    expect(normName('Jo', 'Bloggs')).toBe('jo bloggs');
    expect(normName('  Jo   Bloggs ')).toBe('jo bloggs');
    expect(normName('', '')).toBeNull();
  });
});

describe('buildAcceptedByKey', () => {
  it('indexes by phone and email, first row winning per key', () => {
    const { acceptedByKey } = buildAcceptedByKey([
      { phone: '07700900123', email: 'a@x.com', value_pence: 500000, treatment_name: 'Implant', patient_name: 'Jo Bloggs', accepted_date: '2026-07-01' },
      { phone: '07700900123', email: 'a@x.com', value_pence: 999999, treatment_name: 'Later', patient_name: 'Jo Bloggs', accepted_date: '2026-07-02' },
    ]);
    expect(acceptedByKey.get('7700900123').valuePence).toBe(500000);
    expect(acceptedByKey.get('a@x.com').treatmentName).toBe('Implant');
  });

  it('reads phone and email from raw when the top-level columns are absent', () => {
    const { acceptedByKey } = buildAcceptedByKey([
      { raw: { phone: '07700900999', email: 'B@X.com' }, value_pence: 100 },
    ]);
    expect(acceptedByKey.has('7700900999')).toBe(true);
    expect(acceptedByKey.has('b@x.com')).toBe(true);
  });

  it('scopes the name index by practice', () => {
    const { nameByPractice } = buildAcceptedByKey([
      { patient_name: 'Jo Bloggs', practice_id: 'p1', value_pence: 111 },
      { patient_name: 'Jo Bloggs', practice_id: 'p2', value_pence: 222 },
    ]);
    expect(nameByPractice.get('p1').get('jo bloggs').valuePence).toBe(111);
    expect(nameByPractice.get('p2').get('jo bloggs').valuePence).toBe(222);
  });
});

describe('matchAcceptedValue precedence', () => {
  const accepted = [
    { phone: '07700900123', email: 'phone-row@x.com', value_pence: 100, patient_name: 'Phone Row', practice_id: 'p1' },
    { email: 'email-row@x.com', value_pence: 200, patient_name: 'Email Row', practice_id: 'p1' },
    { patient_name: 'Name Row', practice_id: 'p1', value_pence: 300 },
  ];
  const { acceptedByKey, nameByPractice } = buildAcceptedByKey(accepted);

  it('prefers phone over email', () => {
    const lead = { contacts: { phone: '07700900123', email: 'email-row@x.com' }, practiceId: 'p1' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice).valuePence).toBe(100);
  });

  it('falls back to email when phone does not match', () => {
    const lead = { contacts: { phone: '07999999999', email: 'email-row@x.com' }, practiceId: 'p1' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice).valuePence).toBe(200);
  });

  it('falls back to a practice-scoped name last', () => {
    const lead = { contacts: { first_name: 'Name', last_name: 'Row' }, practiceId: 'p1' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice).valuePence).toBe(300);
  });

  it('does NOT match a name from a different practice', () => {
    // Name matching is the weakest tier; scoping it to the practice is what
    // stops common names colliding across sites.
    const lead = { contacts: { first_name: 'Name', last_name: 'Row' }, practiceId: 'p2' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    const lead = { contacts: { phone: '07000000000' }, practiceId: 'p1' };
    expect(matchAcceptedValue(lead, acceptedByKey, nameByPractice)).toBeNull();
  });
});
