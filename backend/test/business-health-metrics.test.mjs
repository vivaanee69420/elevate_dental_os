import { describe, it, expect } from 'vitest';
import { METRIC_CATALOG, METRIC_BY_KEY } from '../src/lib/health-metrics.js';

describe('health metric catalog', () => {
  it('every entry has the required shape and a valid sourceType', () => {
    for (const m of METRIC_CATALOG) {
      expect(typeof m.key).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(['Financial', 'Patient', 'Conversion', 'Operational']).toContain(m.cat);
      expect(['%', '£', 'min', '']).toContain(m.unit);
      expect(['higher', 'lower']).toContain(m.better);
      expect(['auto', 'manual']).toContain(m.sourceType);
    }
  });

  it('keys are unique and METRIC_BY_KEY indexes them', () => {
    const keys = METRIC_CATALOG.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(METRIC_BY_KEY[keys[0]]).toBe(METRIC_CATALOG[0]);
  });

  it('exposes exactly the six auto metrics wired to live actuals', () => {
    const auto = METRIC_CATALOG.filter((m) => m.sourceType === 'auto').map((m) => m.key).sort();
    expect(auto).toEqual(
      ['annual_revenue', 'cash_at_bank', 'fta_no_show_rate', 'lead_to_treatment', 'net_profit', 'net_profit_margin'].sort(),
    );
  });
});
