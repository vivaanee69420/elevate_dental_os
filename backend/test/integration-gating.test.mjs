// ============================================================================
// Integration gating — "hide data while an integration is revoked".
// Verifies the helper predicates + a sample of the gated repository reads:
//   - a REVOKED provider's data disappears (ad_metrics rows, appointments,
//     source-tagged payments)
//   - a NEVER-CONNECTED org keeps its manual data (no integrations row = not
//     revoked)
// Distinct orgIds per case avoid the helper's 30s per-org cache bleeding state.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import {
  isRevoked, isActive, revokedProviders, revokedSources,
  domainHidden, pmsHidden, crmHidden, invalidate,
} from '../src/lib/integration-gating.js';
import { analyticsRepository } from '../src/repositories/analytics.repository.js';

// Route a fake query result per table. `integrations` returns the seeded
// connection rows; everything else returns the seeded data rows.
function harness({ integrations = [], rows = {}, rpcs = {} }) {
  supaRec.resultProvider = (q) => {
    if (q.table === 'integrations') return { data: integrations, error: null };
    return { data: rows[q.table] ?? [], error: null };
  };
  // Reads that aggregate in SQL arrive as RPCs, not table selects.
  supaRec.rpcProvider = (fn) => ({ data: rpcs[fn] ?? [], error: null });
}

describe('integration-gating helper', () => {
  beforeEach(() => { invalidate('org-h'); });

  it('treats status=revoked as revoked, active as active', async () => {
    harness({ integrations: [
      { provider: 'dentally', status: 'revoked' },
      { provider: 'google_ads', status: 'active' },
    ] });
    expect(await isRevoked('org-h', 'dentally')).toBe(true);
    expect(await isActive('org-h', 'dentally')).toBe(false);
    expect(await isActive('org-h', 'google_ads')).toBe(true);
    expect([...(await revokedProviders('org-h'))]).toEqual(['dentally']);
    expect(await domainHidden('org-h', ['dentally', 'soe'])).toBe(true);
    expect(await revokedSources('org-h', ['dentally', 'quickbooks'])).toEqual(['dentally']);
  });

  it('a never-connected provider is NOT revoked (manual data stays)', async () => {
    invalidate('org-empty');
    harness({ integrations: [] });
    expect(await isRevoked('org-empty', 'dentally')).toBe(false);
    expect(await pmsHidden('org-empty')).toBe(false);
    expect(await crmHidden('org-empty')).toBe(false);
  });

  it('domain stays visible when one provider revoked but another active', async () => {
    invalidate('org-switch');
    harness({ integrations: [
      { provider: 'dentally', status: 'revoked' },
      { provider: 'soe', status: 'active' },
    ] });
    // Switched PMS: dentally revoked but soe active → data still flows.
    expect(await pmsHidden('org-switch')).toBe(false);
  });
});

describe('gated reads drop a revoked provider', () => {
  it('adMetricsInWindow filters out the revoked ad provider', async () => {
    invalidate('org-ads');
    harness({
      integrations: [{ provider: 'google_ads', status: 'revoked' }],
      // adMetricsInWindow now sums in SQL (ad_metrics_rollup) rather than
      // reading ad_metrics row by row past PostgREST's silent row ceiling. The
      // revoked-provider filter still runs in JS over the aggregated rows.
      rpcs: { ad_metrics_rollup: [
        { provider: 'google_ads', customer_id: 'g1', practice_id: null, spend_pence: 500 },
        { provider: 'meta_ads', customer_id: 'm1', practice_id: null, spend_pence: 300 },
      ] },
    });
    const out = await analyticsRepository.adMetricsInWindow('org-ads', '2026-01-01', '2026-02-01');
    expect(out.map((r) => r.provider)).toEqual(['meta_ads']);
  });

  it('appointmentsForHub returns nothing when the PMS is revoked', async () => {
    invalidate('org-pms');
    harness({
      integrations: [{ provider: 'dentally', status: 'revoked' }],
      rows: { appointments: [{ practice_id: 'p1', status: 'completed', starts_at: '2026-01-02' }] },
    });
    expect(await analyticsRepository.appointmentsForHub('org-pms', '2026-01-01')).toEqual([]);
  });

  it('settledPayments hides the revoked source, keeps manual + active', async () => {
    invalidate('org-pay');
    harness({
      integrations: [
        { provider: 'dentally', status: 'revoked' },
        { provider: 'quickbooks', status: 'active' },
      ],
      rows: { payments: [
        { practice_id: 'p1', amount_pence: 100, source: 'dentally' },
        { practice_id: 'p1', amount_pence: 200, source: 'quickbooks' },
        { practice_id: 'p1', amount_pence: 300, source: 'manual' },
        { practice_id: 'p1', amount_pence: 400, source: null },
      ] },
    });
    const out = await analyticsRepository.settledPayments('org-pay');
    expect(out.map((p) => p.amount_pence).sort()).toEqual([200, 300, 400]);
  });
});
