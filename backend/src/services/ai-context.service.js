// ============================================================================
// AI context service. Owns the period-keyed snapshot: builds the aggregated,
// sanitized bundle (buildSnapshot), serves it with lazy recompute + freeze
// (getSnapshot), and invalidates periods touched by a sync (invalidatePeriods).
// getLiveContextData delegates here. Pure helpers (resolvePeriodKey,
// needsRecompute, isContextEmpty) are exported for direct unit testing.
// ============================================================================
import { aiContextSnapshotRepository } from "../repositories/ai-context-snapshot.repository.js";
import { sanitizeForContext } from "../lib/ai/sanitize.js";

const TTL_MS = 6 * 60 * 60 * 1000; // 6h: current-period freshness window

function ym(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 'current' -> this UTC month; a literal 'YYYY-MM' / 'YYYY' passes through.
export function resolvePeriodKey(period, now = new Date()) {
  if (!period || period === 'current') return ym(now);
  return period;
}

// Decide whether a cached row must be rebuilt. Final rows are immutable; a
// non-final row is rebuilt once it ages past the TTL or if it is missing.
export function needsRecompute(row, now = new Date()) {
  if (!row) return true;
  if (row.is_final) return false;
  const age = now.getTime() - new Date(row.computed_at).getTime();
  return age > TTL_MS;
}

// An org with no financials, no baseline, and no appointments in the period has
// nothing for the AI to ground on — the caller should not invoke the model.
export function isContextEmpty(snapshot) {
  const c = snapshot?.meta?.data_coverage;
  if (!c) return true;
  return !c.financials && !c.baseline && !c.appointments;
}

// Build the aggregated, sanitized context bundle for one org+period. Heavy
// (runs ~10 rollups); callers reach it through getSnapshot, which caches.
export async function buildSnapshot(orgId, periodKey, now = new Date()) {
  // Lazy import breaks the analytics <-> ai-context circular dependency.
  const { analyticsService } = await import("./analytics.service.js");
  const bundle = await analyticsService.assembleLiveContext(orgId, periodKey);

  // Sanitize every free-text label that came from PMS/user data.
  for (const p of bundle.practices || []) p.name = sanitizeForContext(p.name);
  for (const c of bundle.marketing?.channels || []) c.label = sanitizeForContext(c.label);
  for (const l of bundle.leakage?.lines || []) { l.label = sanitizeForContext(l.label); l.owner = sanitizeForContext(l.owner); }
  for (const c of bundle.clinicians?.top || []) c.name = sanitizeForContext(c.name);
  for (const pr of bundle.chairs?.practices || []) pr.name = sanitizeForContext(pr.name);
  for (const e of bundle.pl?.entities || []) e.name = sanitizeForContext(e.name);

  // Trailing-12-month revenue series (per-month actuals).
  const trailing12 = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const pm = await analyticsService.plMargin(orgId, { periodKey: mk });
    trailing12.push({ m: mk, revPence: pm.hasData ? pm.statement.revPence : 0 });
  }

  // data_coverage drives the empty-data guard.
  const data_coverage = {
    financials: !!bundle.pl,
    baseline: !!bundle.baseline,
    appointments: (bundle.chairs?.totalChairs ?? 0) > 0 || (bundle.clinicians?.top?.length ?? 0) > 0,
    invoices: (bundle.cash?.totalPence ?? 0) > 0,
    marketing: !!bundle.marketing?.connected,
  };

  return {
    meta: { period_key: periodKey, scope: 'all', computed_at: now.toISOString(), is_final: false, currency: 'pence', data_coverage },
    trailing12,
    ...bundle,
  };
}

// Read path: serve the cached row, rebuilding lazily when missing/stale and
// never touching a frozen (is_final) period.
export async function getSnapshot(orgId, period = 'current', now = new Date()) {
  const periodKey = resolvePeriodKey(period, now);
  const row = await aiContextSnapshotRepository.get(orgId, periodKey);
  if (!needsRecompute(row, now)) return row.snapshot;
  const snapshot = await buildSnapshot(orgId, periodKey, now);
  await aiContextSnapshotRepository.upsert(orgId, periodKey, snapshot, false);
  return snapshot;
}

// Called by sync jobs after writing data into [since, until]: force those months
// to recompute on next read (and drop any stale finalization).
export async function invalidatePeriods(orgId, since, until) {
  const keys = [];
  const start = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1));
  const end = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), 1));
  for (let d = start; d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  await aiContextSnapshotRepository.markDirty(orgId, keys);
}
