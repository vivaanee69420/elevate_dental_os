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
});
