import { describe, it, expect } from 'vitest';
import { ageDays, bandKey, buildDebtView } from '../src/services/debt.service.js';

const NOW = new Date('2026-05-26T00:00:00.000Z').getTime();

describe('ageDays', () => {
  it('ages from due_on when present', () => {
    expect(ageDays({ due_on: '2026-04-26', dated_on: '2026-01-01' }, NOW)).toBe(30);
  });
  it('falls back to dated_on when due_on is null', () => {
    expect(ageDays({ due_on: null, dated_on: '2026-04-26' }, NOW)).toBe(30);
  });
  it('clamps not-yet-due invoices to 0', () => {
    expect(ageDays({ due_on: '2026-06-30' }, NOW)).toBe(0);
  });
  it('returns 0 when no date at all', () => {
    expect(ageDays({}, NOW)).toBe(0);
  });
});

describe('bandKey', () => {
  it('maps boundaries', () => {
    expect(bandKey(0)).toBe('0-30');
    expect(bandKey(30)).toBe('0-30');
    expect(bandKey(31)).toBe('31-60');
    expect(bandKey(60)).toBe('31-60');
    expect(bandKey(90)).toBe('61-90');
    expect(bandKey(91)).toBe('91-120');
    expect(bandKey(120)).toBe('91-120');
    expect(bandKey(121)).toBe('120+');
  });
});

describe('buildDebtView', () => {
  const rows = [
    { amount_outstanding_pence: 425000, due_on: '2025-12-01', treatment: 'All-on-4',
      patient_name: 'R Sutton', practice: { name: 'Warwick Lodge' }, contact: null },
    { amount_outstanding_pence: 180000, due_on: '2026-04-26', treatment: 'Invisalign',
      patient_name: null, contact: { first_name: 'S', last_name: 'Patel' },
      practice: { name: 'Ashford' } },
  ];
  const view = buildDebtView(rows, NOW);

  it('sums outstanding across all rows', () => {
    expect(view.outstanding_pence).toBe(605000);
  });
  it('sums 90+ overdue only', () => {
    expect(view.overdue90_pence).toBe(425000);
  });
  it('treats exactly-90 days as band 61-90 (not overdue90); 91 days is overdue90', () => {
    const v = buildDebtView([
      { amount_outstanding_pence: 1000, due_on: '2026-02-25' }, // exactly 90 days before NOW
      { amount_outstanding_pence: 2000, due_on: '2026-02-24' }, // 91 days before NOW
    ], NOW);
    expect(v.overdue90_pence).toBe(2000); // only the 91-day invoice counts as 90+
    expect(v.bands.find((b) => b.key === '61-90').count).toBe(1);
    expect(v.bands.find((b) => b.key === '91-120').count).toBe(1);
  });
  it('returns 5 bands with correct counts', () => {
    expect(view.bands.map((b) => b.key)).toEqual(['0-30', '31-60', '61-90', '91-120', '120+']);
    expect(view.bands.find((b) => b.key === '120+').count).toBe(1);
    expect(view.bands.find((b) => b.key === '0-30').count).toBe(1);
  });
  it('resolves name from contact, else patient_name, else Unknown', () => {
    expect(view.debtors.find((d) => d.amount_pence === 180000).name).toBe('S Patel');
    expect(view.debtors.find((d) => d.amount_pence === 425000).name).toBe('R Sutton');
    expect(buildDebtView([{ amount_outstanding_pence: 100 }], NOW).debtors[0].name).toBe('Unknown patient');
  });
  it('sorts debtors oldest-first', () => {
    expect(view.debtors[0].amount_pence).toBe(425000);
  });
});
