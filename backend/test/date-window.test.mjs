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
import { startOfDayISO, endOfDayISO, exclusiveEndISO, dayWindowISO } from '../src/lib/date-window.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('a calendar day expands to the whole day, in Europe/London', () => {
  // Bounds are asserted as literal UTC instants, NOT via `new Date(y, m, d)`,
  // which is server-local and so would pass for any zone the runner happens to
  // be in — the exact blind spot that let a UTC-built bound describe a
  // different day from the one the user picked.
  it('the upper bound is the LAST instant of the day, not the first', () => {
    // The whole bug in one assertion.
    expect(endOfDayISO('2026-08-31')).toBe('2026-08-31T22:59:59.999Z');
    expect(new Date(endOfDayISO('2026-08-31')).getTime())
      .toBeGreaterThan(new Date(startOfDayISO('2026-08-31')).getTime());
  });

  it('the lower bound is the first instant of the LONDON day', () => {
    // 1 Aug is BST, so London midnight is 23:00Z on 31 July. Building this in
    // UTC would start the window an hour late and lose the first London hour of
    // the month from every BST period.
    expect(startOfDayISO('2026-08-01')).toBe('2026-07-31T23:00:00.000Z');
  });

  it('winter days are GMT and summer days are BST — the zone is not a fixed offset', () => {
    // "UK time" is not UTC+1. Pinning a constant +1 would be wrong for the five
    // months the country is on GMT, which is the same class of error as pinning
    // UTC — just wrong in the other half of the year.
    expect(startOfDayISO('2026-01-15')).toBe('2026-01-15T00:00:00.000Z'); // GMT
    expect(startOfDayISO('2026-07-15')).toBe('2026-07-14T23:00:00.000Z'); // BST
  });

  it('the clock-change days are 23 and 25 hours long, not 24', () => {
    const spring = new Date(endOfDayISO('2026-03-29')).getTime() - new Date(startOfDayISO('2026-03-29')).getTime();
    const autumn = new Date(endOfDayISO('2026-10-25')).getTime() - new Date(startOfDayISO('2026-10-25')).getTime();
    expect(spring).toBe(23 * 3600_000 - 1); // BST begins: an hour is skipped
    expect(autumn).toBe(25 * 3600_000 - 1); // BST ends: an hour repeats
  });

  it('the exclusive end is the start of the NEXT London day', () => {
    // This is the bound the period pickers produce and the shape the SQL helper
    // window_last_day() expects. Handing a date-column aggregate the inclusive
    // 23:59:59.999 instead would resolve to the FOLLOWING London day in BST.
    expect(exclusiveEndISO('2026-08-31')).toBe('2026-08-31T23:00:00.000Z');
    expect(exclusiveEndISO('2026-08-31')).toBe(startOfDayISO('2026-09-01'));
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

// ============================================================================
// businessHub's ad window. `until` reaches it in three different shapes
// depending on the caller — an exclusive next-day-midnight (the Business Hub
// scope bar), an inclusive end-of-day, or a UTC midnight — and the ad
// date-range has to derive the same last calendar DAY from all three.
//
// It used to subtract a fixed 86,400,000ms and slice the UTC string, which is
// only correct when `until` is exactly UTC midnight. A window built in a
// browser carries the user's offset, so for a UK user in BST `until` arrives
// as 23:00Z and minus-24h lands on the PREVIOUS day — the ad window silently
// lost its final day for the ~7 months of the year Britain is on BST.
//
// `until - 1ms` is the last instant inside the window under every convention.
// ============================================================================
describe('the ad window keeps its final day under every until convention', () => {
  const lastDay = (untilISO) =>
    new Date(new Date(untilISO).getTime() - 1).toISOString().slice(0, 10);

  it('exclusive next-day midnight in UTC', () => {
    expect(lastDay('2026-08-01T00:00:00.000Z')).toBe('2026-07-31');
  });

  it('exclusive next-day midnight from a BST browser (the broken case)', () => {
    // 2026-08-01T00:00:00+01:00
    expect(lastDay('2026-07-31T23:00:00.000Z')).toBe('2026-07-31');
    // The old arithmetic gave 2026-07-30 here.
    const old = new Date(new Date('2026-07-31T23:00:00.000Z').getTime() - 86400000)
      .toISOString().slice(0, 10);
    expect(old).toBe('2026-07-30');
  });

  it('inclusive end-of-day', () => {
    expect(lastDay('2026-07-31T23:59:59.999Z')).toBe('2026-07-31');
  });

  it('a single-day window resolves to that day', () => {
    expect(lastDay('2026-09-02T00:00:00.000Z')).toBe('2026-09-01');
  });

  it('the service uses the convention-agnostic form', () => {
    const analytics = readFileSync(join(SRC, 'services', 'analytics.service.js'), 'utf8');
    expect(analytics).toMatch(/new Date\(untilISO\)\.getTime\(\) - 1\)/);
    expect(analytics).not.toMatch(/new Date\(untilISO\)\.getTime\(\) - 86400000/);
  });
});
