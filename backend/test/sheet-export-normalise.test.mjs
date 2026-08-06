import { describe, it, expect } from 'vitest';
import { normaliseEmail, normalisePhone } from '../src/lib/sheet-export/normalise.js';

describe('normaliseEmail', () => {
  it('trims and lowercases', () => {
    expect(normaliseEmail('  Jane.Smith@Example.COM ')).toBe('jane.smith@example.com');
  });
  it('rejects empties and non-emails', () => {
    expect(normaliseEmail('')).toBeNull();
    expect(normaliseEmail('   ')).toBeNull();
    expect(normaliseEmail(null)).toBeNull();
    expect(normaliseEmail('not-an-email')).toBeNull();
  });
});

describe('normalisePhone', () => {
  it('canonicalises all UK forms to 44…', () => {
    for (const raw of ['07123 456789', '+447123456789', '447123456789',
                       '07123-456-789', '(07123) 456789', '+44 7123 456789']) {
      expect(normalisePhone(raw)?.canonical).toBe('447123456789');
    }
  });
  it('returns the last-9-digit suffix for SQL lookup', () => {
    expect(normalisePhone('07123 456789')?.suffix9).toBe('123456789');
  });
  it('rejects numbers with fewer than 10 digits', () => {
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('0712345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
  it('leaves non-UK international numbers digits-only untouched', () => {
    expect(normalisePhone('+1 555 123 4567')?.canonical).toBe('15551234567');
  });
});
