// ============================================================================
// Board Report Generator (DentaCFO gap module, Phase 2). Covers:
//  - isScheduleDue cadence logic (pure)
//  - claude.generateBoardReport throws without an API key (caller falls back)
//  - analyticsService.boardReport assembles metrics + deterministic fallback
//    pack from stubbed live rollups (no API key => no AI call)
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isScheduleDue } from '../src/repositories/boardReport.repository.js';
import { generateBoardReport } from '../src/lib/gemini.js';
import { analyticsService } from '../src/services/analytics.service.js';

describe('isScheduleDue', () => {
  const now = new Date('2026-06-09T08:00:00Z');
  it('first send (no last_sent_at) is always due', () => {
    expect(isScheduleDue('daily', null, now)).toBe(true);
    expect(isScheduleDue('monthly', undefined, now)).toBe(true);
  });
  it('daily is due on a different calendar day, not the same day', () => {
    expect(isScheduleDue('daily', '2026-06-08T23:00:00Z', now)).toBe(true);
    expect(isScheduleDue('daily', '2026-06-09T01:00:00Z', now)).toBe(false);
  });
  it('weekly is due after 7 days', () => {
    expect(isScheduleDue('weekly', '2026-06-01T08:00:00Z', now)).toBe(true);
    expect(isScheduleDue('weekly', '2026-06-04T08:00:00Z', now)).toBe(false);
  });
  it('monthly is due after 28 days', () => {
    expect(isScheduleDue('monthly', '2026-05-01T08:00:00Z', now)).toBe(true);
    expect(isScheduleDue('monthly', '2026-05-20T08:00:00Z', now)).toBe(false);
  });
});

describe('claude.generateBoardReport', () => {
  it('throws without ANTHROPIC_API_KEY so the caller can fall back', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generateBoardReport({ scopeLabel: 'Group', periodLabel: 'x', data: {} }))
      .rejects.toThrow('No ANTHROPIC_API_KEY');
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  });
});

describe('analyticsService.boardReport', () => {
  const ORG = 'org-1';
  let origHub, origLeak, prevKey;

  beforeEach(() => {
    origHub = analyticsService.businessHub;
    origLeak = analyticsService.revenueLeakage;
    prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; // force deterministic fallback

    analyticsService.businessHub = async () => ({
      period: { days: 30, since: '2026-05-10T00:00:00Z', until: null, label: null },
      group: {
        practices: 2,
        revenuePence: 100_000_00,
        revenueTargetPence: 120_000_00,
        marginPct: 30,
        appointments: 1000,
        noShows: 80,
        noShowRate: 8,
        noShowTracked: true,
        leads: 200,
        conversionRate: 25,
        newPatients: 50,
        cashCollectedPence: 90_000_00,
        treatmentsStarted: 40,
        treatmentsClosedPence: 60_000_00,
      },
      practices: [
        { name: 'Site A', revenuePence: 70_000_00, appointments: 600, noShows: 30, noShowRate: 5 },
        { name: 'Site B', revenuePence: 30_000_00, appointments: 400, noShows: 50, noShowRate: 12.5 },
      ],
    });
    analyticsService.revenueLeakage = async () => ({
      windowDays: 30,
      since: '2026-05-10T00:00:00Z',
      until: null,
      annualTotalPence: 240_000_00,
      monthlyTotalPence: 20_000_00,
      asPctOfRevenue: 20,
      lines: [
        { label: 'Unaccepted / lost treatment plans', annualPence: 120_000_00, monthlyPence: 10_000_00, owner: 'COO' },
        { label: 'Failed appointments (FTA)', annualPence: 60_000_00, monthlyPence: 5_000_00, owner: 'Site managers' },
      ],
    });
  });

  afterEach(() => {
    analyticsService.businessHub = origHub;
    analyticsService.revenueLeakage = origLeak;
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
  });

  it('assembles metrics and a deterministic pack from live rollups', async () => {
    const r = await analyticsService.boardReport(ORG, { label: 'May board pack' });
    expect(r.basis).toBe('deterministic');
    expect(r.empty).toBe(false);
    expect(r.metrics.revenuePence).toBe(100_000_00);
    expect(r.metrics.revenueAnnualisedPence).toBe(Math.round((100_000_00 * 365) / 30));
    expect(r.metrics.ebitdaWindowPence).toBe(30_000_00); // 30% of turnover
    // top practice = highest revenue; weak = highest no-show rate
    expect(r.metrics.topPractice.name).toBe('Site A');
    expect(r.metrics.weakPractice.name).toBe('Site B');
    expect(r.metrics.biggestLeak.annualPence).toBe(120_000_00);
    // exec summary cites real figures; exactly 3 RAG priorities
    expect(r.summary.length).toBeGreaterThanOrEqual(3);
    expect(r.priorities.length).toBe(3);
    expect(r.priorities[0].rag).toBe('red');
    expect(r.priorities.map((p) => p.rag)).toEqual(['red', 'amber', 'green']);
  });

  it('flags empty when there is no activity', async () => {
    analyticsService.businessHub = async () => ({
      period: { days: 30 },
      group: { practices: 0, revenuePence: 0, revenueTargetPence: 0, marginPct: 0, appointments: 0, noShows: 0, noShowRate: 0, noShowTracked: false, leads: 0, conversionRate: 0, newPatients: 0, cashCollectedPence: 0 },
      practices: [],
    });
    analyticsService.revenueLeakage = async () => ({ windowDays: 30, since: 's', until: null, annualTotalPence: 0, monthlyTotalPence: 0, asPctOfRevenue: 0, lines: [] });
    const r = await analyticsService.boardReport(ORG, {});
    expect(r.empty).toBe(true);
  });
});
