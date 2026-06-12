import { describe, it, expect } from 'vitest';
import { bucketsByPeriod } from '../src/services/monthlyFinancial.service.js';

const rows = [
  // accrual QB revenue + manual staff; cash QB revenue only
  { period: '2026-01', dental_bucket: 'revenue', amount_pence: 100000, source: 'quickbooks', accounting_method: 'accrual' },
  { period: '2026-01', dental_bucket: 'staff',   amount_pence: 40000,  source: 'manual',     accounting_method: 'accrual' },
  { period: '2026-01', dental_bucket: 'revenue', amount_pence: 90000,  source: 'quickbooks', accounting_method: 'cash' },
];

describe('bucketsByPeriod accounting method', () => {
  it('accrual basis includes manual + accrual-QB rows', () => {
    const m = bucketsByPeriod(rows, { accountingMethod: 'accrual' });
    expect(m.get('2026-01').revenue).toBe(100000);
    expect(m.get('2026-01').staff).toBe(40000);
  });

  it('cash basis includes only cash rows', () => {
    const m = bucketsByPeriod(rows, { accountingMethod: 'cash' });
    expect(m.get('2026-01').revenue).toBe(90000);
    expect(m.get('2026-01').staff).toBeUndefined();
  });

  it('defaults to accrual when no method given (back-compat)', () => {
    const m = bucketsByPeriod(rows);
    expect(m.get('2026-01').revenue).toBe(100000);
  });
});
