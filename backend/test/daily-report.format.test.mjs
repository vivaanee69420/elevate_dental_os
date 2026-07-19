import { describe, it, expect } from 'vitest';
import {
  MAX_REPORT_CHARS,
  previousDayInLondon,
  formatPence,
  formatPercent,
  formatReportLine,
} from '../src/services/daily-report.format.js';

const FULL = {
  reportDateLabel: '21 Jul',
  leads: { total: 24, google: 14, meta: 10 },
  spendPence: { total: 41200, google: 41200, meta: null },
  cplPence: { total: 1717, google: 2943, meta: null },
  conversions: 6,
  conversionRate: 0.25,
  cpaPence: 6867,
  cashInPence: 624000,
  dentally: { appointments: 118, dna: 7, dnaRate: 0.059, newPatients: 12 },
  qbo: { revenueMtdPence: 14200000, marginPct: 18.4 },
};

describe('formatPence', () => {
  it('uses 2dp below one hundred pounds', () => {
    expect(formatPence(1717)).toBe('£17.17');
  });
  it('drops decimals from one hundred pounds up', () => {
    expect(formatPence(41200)).toBe('£412');
  });
  it('adds thousands separators', () => {
    expect(formatPence(624000)).toBe('£6,240');
  });
  it('abbreviates from one hundred thousand pounds up', () => {
    expect(formatPence(14200000)).toBe('£142k');
  });
  it('returns null for null', () => {
    expect(formatPence(null)).toBeNull();
  });
  it('formats zero as a real zero, not null', () => {
    expect(formatPence(0)).toBe('£0.00');
  });
});

describe('formatPercent', () => {
  it('renders a ratio as a whole percentage', () => {
    expect(formatPercent(0.25)).toBe('25%');
  });
  it('keeps one decimal for small ratios', () => {
    expect(formatPercent(0.059)).toBe('5.9%');
  });
  it('returns null for null', () => {
    expect(formatPercent(null)).toBeNull();
  });
});

describe('previousDayInLondon', () => {
  it('returns the previous day during British Summer Time', () => {
    // 2026-07-21 18:00 London == 17:00 UTC
    const r = previousDayInLondon(new Date('2026-07-21T17:00:00.000Z'));
    expect(r.date).toBe('2026-07-20');
    expect(r.since).toBe('2026-07-20');
    expect(r.until).toBe('2026-07-20');
    expect(r.label).toBe('20 Jul');
  });

  it('returns the previous day in winter (UTC offset zero)', () => {
    const r = previousDayInLondon(new Date('2026-01-15T18:00:00.000Z'));
    expect(r.date).toBe('2026-01-14');
    expect(r.label).toBe('14 Jan');
  });

  it('uses the London calendar day, not the UTC one', () => {
    // 2026-07-21 00:30 London == 2026-07-20 23:30 UTC.
    // London's "yesterday" is the 20th; UTC's would be the 19th.
    const r = previousDayInLondon(new Date('2026-07-20T23:30:00.000Z'));
    expect(r.date).toBe('2026-07-20');
  });
});

describe('formatReportLine', () => {
  it('renders every section for a complete day', () => {
    const line = formatReportLine(FULL);
    expect(line).toContain('Daily 21 Jul');
    expect(line).toContain('Leads 24 (Google 14, Meta 10)');
    expect(line).toContain('CPL £17.17');
    expect(line).toContain('Conv 6 (25%), CPA £68.67');
    expect(line).toContain('Cash in £6,240');
    expect(line).toContain('Appts 118, DNA 7 (5.9%), New pts 12');
    expect(line).toContain('QBO MTD £142k, margin 18.4%');
  });

  it('renders null spend as "not reporting", never as zero', () => {
    const line = formatReportLine(FULL);
    expect(line).toContain('Meta not reporting');
    expect(line).not.toContain('Meta £0');
  });

  it('renders metrics dependent on missing spend as n/a', () => {
    const line = formatReportLine({
      ...FULL,
      spendPence: { total: null, google: null, meta: null },
      cplPence: { total: null, google: null, meta: null },
      cpaPence: null,
    });
    expect(line).toContain('CPL n/a');
    expect(line).toContain('CPA n/a');
  });

  it('omits the Dentally section when there is no data', () => {
    const line = formatReportLine({ ...FULL, dentally: null });
    expect(line).not.toContain('Appts');
    expect(line).toContain('QBO MTD');
  });

  it('omits the QuickBooks section when there is no data', () => {
    const line = formatReportLine({ ...FULL, qbo: null });
    expect(line).not.toContain('QBO');
    expect(line).toContain('Appts 118');
  });

  it('never contains newlines, tabs, or four consecutive spaces', () => {
    const line = formatReportLine(FULL);
    expect(line).not.toMatch(/[\n\r\t]/);
    expect(line).not.toMatch(/ {4}/);
  });

  it('stays within the cap and keeps the typical line well under it', () => {
    const line = formatReportLine(FULL);
    expect(line.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    expect(line.length).toBeLessThan(260);
  });

  it('stays within the cap even for absurd values', () => {
    // Every field at an impossible magnitude. Measured at 269 chars, so the
    // truncation guard should NOT fire — this test exists to prove the cap
    // has real headroom, not to exercise truncation.
    const wide = {
      ...FULL,
      leads: { total: 999999, google: 999999, meta: 999999 },
      spendPence: { total: null, google: null, meta: null },
      cplPence: { total: null, google: null, meta: null },
      conversions: 999999,
      cashInPence: 99999900,
      dentally: { appointments: 999999, dna: 999999, dnaRate: 0.999, newPatients: 999999 },
      qbo: { revenueMtdPence: 99900000000, marginPct: 100 },
    };
    const line = formatReportLine(wide);
    expect(line.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    expect(line).toContain('QBO');   // nothing was dropped
    expect(line).toContain('Leads');
  });
});
