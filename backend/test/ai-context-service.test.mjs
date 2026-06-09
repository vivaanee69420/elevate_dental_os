import { describe, it, expect } from 'vitest';
const mod = await import('../src/services/ai-context.service.js');
const { resolvePeriodKey, needsRecompute, isContextEmpty } = mod;

describe('resolvePeriodKey', () => {
  it("maps 'current' to the now month YYYY-MM", () => {
    expect(resolvePeriodKey('current', new Date('2026-06-09T00:00:00Z'))).toBe('2026-06');
  });
  it('passes a literal YYYY-MM through', () => {
    expect(resolvePeriodKey('2026-05', new Date('2026-06-09T00:00:00Z'))).toBe('2026-05');
  });
  it('passes a literal YYYY through', () => {
    expect(resolvePeriodKey('2025', new Date('2026-06-09T00:00:00Z'))).toBe('2025');
  });
});

describe('needsRecompute', () => {
  const now = new Date('2026-06-09T12:00:00Z');
  it('true when row missing', () => {
    expect(needsRecompute(null, now)).toBe(true);
  });
  it('false when row is final regardless of age', () => {
    expect(needsRecompute({ is_final: true, computed_at: '2020-01-01T00:00:00Z' }, now)).toBe(false);
  });
  it('false when non-final but fresh (< 6h)', () => {
    expect(needsRecompute({ is_final: false, computed_at: '2026-06-09T09:00:00Z' }, now)).toBe(false);
  });
  it('true when non-final and stale (> 6h)', () => {
    expect(needsRecompute({ is_final: false, computed_at: '2026-06-09T03:00:00Z' }, now)).toBe(true);
  });
});

describe('isContextEmpty', () => {
  it('true when no financials, no baseline, no appointments', () => {
    expect(isContextEmpty({ meta: { data_coverage: { financials: false, baseline: false, appointments: false } } })).toBe(true);
  });
  it('false when financials present', () => {
    expect(isContextEmpty({ meta: { data_coverage: { financials: true, baseline: false, appointments: false } } })).toBe(false);
  });
  it('false when appointments present', () => {
    expect(isContextEmpty({ meta: { data_coverage: { financials: false, baseline: false, appointments: true } } })).toBe(false);
  });
  it('true when meta missing entirely (defensive)', () => {
    expect(isContextEmpty({})).toBe(true);
  });
});
