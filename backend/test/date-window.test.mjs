// ============================================================================
// Day-window normalisation.
//
// Every MTD/QTD/YTD screen sends two calendar days. A calendar day is not an
// instant, so each endpoint had to decide what "up to and including 3 Sept"
// means — and when they decided separately they drifted invisibly: the page
// still rendered, the numbers were still plausible, they just described
// different windows.
//
// dashboardSummary expanded `to` to the end of the day; the lead funnel passed
// the bare `YYYY-MM-DD` to a timestamptz parameter, where it parses as MIDNIGHT
// AT THE START of that day. The funnel silently dropped its entire final day —
// 44 of 1,429 August leads, and on day one of an MTD window every lead in it,
// beside KPI cards that counted a full day of revenue.
//
// These tests pin the boundary itself and the fact that both callers share it.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startOfDayISO, endOfDayISO, dayWindowISO } from '../src/lib/date-window.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('a calendar day expands to the whole day', () => {
  it('the upper bound is the LAST instant of the day, not the first', () => {
    // The whole bug in one assertion.
    expect(new Date(endOfDayISO('2026-08-31')).getTime())
      .toBe(new Date(2026, 7, 31, 23, 59, 59, 999).getTime());
    expect(new Date(endOfDayISO('2026-08-31')).getTime())
      .toBeGreaterThan(new Date(startOfDayISO('2026-08-31')).getTime());
  });

  it('the lower bound is the first instant of the day', () => {
    expect(new Date(startOfDayISO('2026-08-01')).getTime())
      .toBe(new Date(2026, 7, 1, 0, 0, 0, 0).getTime());
  });

  it('a single-day window is a real 24h span, not an empty instant', () => {
    const { sinceISO, untilISO } = dayWindowISO('2026-08-31', '2026-08-31');
    const ms = new Date(untilISO).getTime() - new Date(sinceISO).getTime();
    expect(ms).toBe(86_400_000 - 1);
  });

  it('an MTD window on day one of a month is not empty', () => {
    // This is the case that would have shown "0 leads" beside a full day of
    // revenue on every first-of-month.
    const { sinceISO, untilISO } = dayWindowISO('2026-09-01', '2026-09-01');
    expect(new Date(untilISO).getTime()).toBeGreaterThan(new Date(sinceISO).getTime());
  });
});

describe('inputs that are not calendar days pass through untouched', () => {
  it('a full ISO timestamp is not re-interpreted', () => {
    const iso = '2026-08-31T14:30:00.000Z';
    expect(endOfDayISO(iso)).toBe(iso);
    expect(startOfDayISO(iso)).toBe(iso);
  });

  it('a Date is normalised to ISO, not mangled', () => {
    const d = new Date('2026-08-31T14:30:00.000Z');
    expect(endOfDayISO(d)).toBe(d.toISOString());
  });

  it('null / empty stay null', () => {
    expect(startOfDayISO(null)).toBeNull();
    expect(endOfDayISO(undefined)).toBeNull();
    expect(endOfDayISO('')).toBeNull();
  });
});

describe('a window needs both ends', () => {
  it('ranged only when both bounds are present', () => {
    expect(dayWindowISO('2026-08-01', '2026-08-31').ranged).toBe(true);
    expect(dayWindowISO('2026-08-01', null).ranged).toBe(false);
    expect(dayWindowISO(null, '2026-08-31').ranged).toBe(false);
    expect(dayWindowISO(null, null).ranged).toBe(false);
  });

  it('a lone bound yields no window rather than half a filter', () => {
    const r = dayWindowISO('2026-08-01', null);
    expect(r.sinceISO).toBeNull();
    expect(r.untilISO).toBeNull();
  });
});

describe('both callers share the helper, so they cannot drift again', () => {
  const analytics = readFileSync(join(SRC, 'services', 'analytics.service.js'), 'utf8');
  const leads = readFileSync(join(SRC, 'services', 'lead.service.js'), 'utf8');

  it('dashboardSummary builds its window from the helper', () => {
    expect(analytics).toMatch(/from "\.\.\/lib\/date-window\.js"/);
    expect(analytics).toMatch(/dayWindowISO\(from, to\)/);
  });

  it('the lead funnel builds its window from the helper', () => {
    expect(leads).toMatch(/from "\.\.\/lib\/date-window\.js"/);
    expect(leads).toMatch(/dayWindowISO\)\(since, until\)/);
  });

  // The regression that started this. `financial()` held a verbatim copy of
  // dashboardSummary's window block — duplication is how two windows drift.
  it('financial() and dashboardSummary share one window, not two copies', () => {
    const copies = analytics.match(/const \[fy, fm, fd\] = from\.split/g) || [];
    // Only cashflow() may still derive its own bounds: it needs raw
    // milliseconds for week bucketing, not an ISO pair.
    expect(copies.length).toBeLessThanOrEqual(1);
  });

  // EVERY upper bound derived from a `to` day must cover that whole day. The
  // two ways to get this wrong are a bare start-of-day (loses ~24h) and an
  // exclusive end used against an inclusive `<=` filter (gains one instant).
  it('no untilISO is a bare start-of-day or an uncorrected exclusive end', () => {
    const assigns = analytics.match(/untilISO[:=]\s*new Date\([^;]*?\)\.toISOString\(\)/g) || [];
    expect(assigns.length).toBeGreaterThan(0);
    for (const a of assigns) {
      // Either an explicit last-instant-of-period, or an exclusive end stepped
      // back by 1ms. A bare `new Date(y, m, d).toISOString()` is neither.
      expect(a).toMatch(/23,\s*59,\s*59,\s*999|-\s*1\)/);
    }
  });
});
