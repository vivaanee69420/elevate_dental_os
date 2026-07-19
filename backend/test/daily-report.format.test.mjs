import { describe, it, expect } from 'vitest';
import {
  MAX_REPORT_CHARS,
  previousDayInLondon,
  formatPence,
  formatPercent,
  formatMarginPct,
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

  it('stays on the 2dp branch just below one hundred pounds', () => {
    expect(formatPence(9999)).toBe('£99.99');
  });
  it('crosses to the whole-pounds branch at exactly one hundred pounds', () => {
    expect(formatPence(10000)).toBe('£100');
  });
  it('rounds whole-pounds-with-separator values that round up to six figures', () => {
    // 9999999p = £99,999.99. This is still < £100,000 so it takes the
    // whole-pounds branch (no decimals), but Math.round(99999.99) rounds up
    // to 100000 — so the display is "£100,000", not "£99,999.99" or "£100k".
    expect(formatPence(9999999)).toBe('£100,000');
  });
  it('crosses to the k-abbreviation branch at exactly one hundred thousand pounds', () => {
    expect(formatPence(10000000)).toBe('£100k');
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

describe('formatMarginPct', () => {
  // The single source for the QuickBooks margin rounding — buildPayload
  // (daily-report.service.js) and formatReportLine (below) both call this
  // instead of each rounding independently, so the report line and the
  // outgoing payload can never disagree.
  it('renders one decimal place', () => {
    expect(formatMarginPct(18.4)).toBe('18.4%');
  });
  it('rounds to one decimal place', () => {
    expect(formatMarginPct(18.44)).toBe('18.4%');
    expect(formatMarginPct(18.46)).toBe('18.5%');
  });
  it('returns null for null', () => {
    expect(formatMarginPct(null)).toBeNull();
  });
  it('returns null for undefined', () => {
    expect(formatMarginPct(undefined)).toBeNull();
  });
  it('renders zero as a real zero, not null', () => {
    expect(formatMarginPct(0)).toBe('0%');
  });
});

describe('previousDayInLondon', () => {
  it('returns the previous day during British Summer Time', () => {
    // 2026-07-21 18:00 London == 17:00 UTC
    const r = previousDayInLondon(new Date('2026-07-21T17:00:00.000Z'));
    expect(r.date).toBe('2026-07-20');
    expect(r.since).toBe('2026-07-20');
    // `until` is EXCLUSIVE (see previousDayInLondon): the day AFTER the report
    // date. The previous assertion here expected until === since, which would
    // have made every downstream `.gte(since).lt(until)` match nothing.
    expect(r.until).toBe('2026-07-21');
    expect(r.label).toBe('20 Jul');
  });

  // The whole codebase treats a window end as exclusive: ad-attribution's
  // leadsInWindow is `.gte(since).lt(until)`, cockpit names its variable
  // `endExclusive`, analytics' businessHub recovers the last inclusive day as
  // `until - 86400000`. So the one-day window for a report on date D must be
  // [D, D+1) — `until` is always exactly one day after `since`.
  describe('exclusive-end window convention', () => {
    const nextDay = (iso) => {
      const d = new Date(`${iso}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };

    it('always returns `until` exactly one day after `since`', () => {
      const r = previousDayInLondon(new Date('2026-07-21T17:00:00.000Z'));
      expect(r.since).toBe(r.date);
      expect(r.until).toBe(nextDay(r.since));
    });

    it('rolls over a month boundary: a report for 31 Jan ends on 1 Feb', () => {
      // 2026-02-01 18:00 London (GMT) -> reports on 2026-01-31.
      const r = previousDayInLondon(new Date('2026-02-01T18:00:00.000Z'));
      expect(r.date).toBe('2026-01-31');
      expect(r.since).toBe('2026-01-31');
      expect(r.until).toBe('2026-02-01');
      expect(r.label).toBe('31 Jan');
    });

    it('rolls over a year boundary: a report for 31 Dec ends on 1 Jan', () => {
      // 2027-01-01 18:00 London (GMT) -> reports on 2026-12-31.
      const r = previousDayInLondon(new Date('2027-01-01T18:00:00.000Z'));
      expect(r.date).toBe('2026-12-31');
      expect(r.since).toBe('2026-12-31');
      expect(r.until).toBe('2027-01-01');
      expect(r.label).toBe('31 Dec');
    });

    it('rolls over a leap-day boundary: a report for 29 Feb ends on 1 Mar', () => {
      const r = previousDayInLondon(new Date('2028-03-01T18:00:00.000Z'));
      expect(r.date).toBe('2028-02-29');
      expect(r.until).toBe('2028-03-01');
    });
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

  it('throws a TypeError when `now` is undefined, instead of falling back to the real clock', () => {
    expect(() => previousDayInLondon(undefined)).toThrow(TypeError);
    expect(() => previousDayInLondon(undefined)).toThrow(/previousDayInLondon/);
  });

  it('throws a TypeError for an invalid Date', () => {
    expect(() => previousDayInLondon(new Date('nonsense'))).toThrow(TypeError);
    expect(() => previousDayInLondon(new Date('nonsense'))).toThrow(/previousDayInLondon/);
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

  it('sanitises newlines, tabs, and runs of spaces from dirty upstream data', () => {
    const dirty = {
      ...FULL,
      reportDateLabel: '21\tJul\n2026',
      leads: { total: 24, google: 14, meta: 10 },
    };
    const line = formatReportLine(dirty);
    expect(line).not.toMatch(/[\n\r\t]/);
    expect(line).not.toMatch(/ {2,}/);
    // The surrounding content still renders — sanitisation isn't dropping data.
    expect(line).toContain('Daily 21 Jul 2026');
    expect(line).toContain('Leads 24 (Google 14, Meta 10)');
  });

  it('renders a null conversionRate as n/a without dropping the rest of the section', () => {
    const line = formatReportLine({ ...FULL, conversionRate: null });
    expect(line).toContain(`Conv ${FULL.conversions} (n/a), CPA ${formatPence(FULL.cpaPence)}`);
  });

  it('renders a null dentally.dnaRate as n/a while the rest of the Dentally section still renders', () => {
    const line = formatReportLine({
      ...FULL,
      dentally: { ...FULL.dentally, dnaRate: null },
    });
    expect(line).toContain('Appts 118, DNA 7 (n/a), New pts 12');
  });

  it('renders a null qbo.marginPct as n/a while the QBO revenue still renders', () => {
    const line = formatReportLine({
      ...FULL,
      qbo: { ...FULL.qbo, marginPct: null },
    });
    expect(line).toContain('QBO MTD £142k, margin n/a');
  });

  it('truncates to exactly MAX_REPORT_CHARS for an unforeseen absurdly long value', () => {
    const line = formatReportLine({ ...FULL, reportDateLabel: 'X'.repeat(500) });
    expect(line.length).toBe(MAX_REPORT_CHARS);
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
