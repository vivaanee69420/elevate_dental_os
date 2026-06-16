import { describe, it, expect } from 'vitest';
import { __test } from '../src/lib/integrations/quickbooks-sync.js';

describe('quickbooks-sync accounting basis', () => {
  it('parseReportRows + mapBucket produce bucketed lines', () => {
    const report = {
      Rows: { Row: [
        { Header: { ColData: [{ value: 'Income' }] },
          Rows: { Row: [ { ColData: [{ value: 'Sales' }, { value: '1000.00' }] } ] } },
        { Header: { ColData: [{ value: 'Expenses' }] },
          Rows: { Row: [ { ColData: [{ value: 'Wages' }, { value: '400.00' }] } ] } },
      ] },
    };
    const rows = __test.parseReportRows(report);
    expect(rows).toHaveLength(2);
    const map = new Map();
    expect(__test.mapBucket('Sales', 'Income', map)).toBe('revenue');
    expect(__test.mapBucket('Wages', 'Expenses', map)).toBe('staff');
    expect(__test.toPence('1000.00')).toBe(100000);
  });

  it('exposes the two accounting methods it pulls', () => {
    expect(__test.ACCOUNTING_METHODS).toEqual(['accrual', 'cash']);
  });

  it('does NOT fold "Cost of Sales" accounts into revenue (section title carries "sales")', () => {
    const map = new Map();
    // Cost of Sales section — none of these are revenue.
    expect(__test.mapBucket('Associate Salary', 'Cost of Sales', map)).toBe('associates');
    expect(__test.mapBucket('therapist/Hygeniest', 'Cost of Sales', map)).toBe('associates');
    expect(__test.mapBucket('Lab fees', 'Cost of Sales', map)).toBe('lab');
    expect(__test.mapBucket('Dental Materials', 'Cost of Sales', map)).toBe('materials');
    expect(__test.mapBucket('Dental Implants Materials', 'Cost of Sales', map)).toBe('materials');
    // Genuine income still classifies as revenue (incl. contra refund lines).
    expect(__test.mapBucket('Sales', 'Income', map)).toBe('revenue');
    expect(__test.mapBucket('payment Received', 'Income', map)).toBe('revenue');
    expect(__test.mapBucket('Patient Refund', 'Income', map)).toBe('revenue');
    // Expenses section routes to cost buckets, never revenue.
    expect(__test.mapBucket('Advertising/Promotional', 'Expenses', map)).toBe('overhead');
    expect(__test.mapBucket('Business rates', 'Expenses', map)).toBe('overhead');
  });
});
