// ============================================================================
// AI context service. Owns the period-keyed snapshot: builds the aggregated,
// sanitized bundle (buildSnapshot), serves it with lazy recompute + freeze
// (getSnapshot), and invalidates periods touched by a sync (invalidatePeriods).
// getLiveContextData delegates here. Pure helpers (resolvePeriodKey,
// needsRecompute, isContextEmpty) are exported for direct unit testing.
// ============================================================================
import { aiContextSnapshotRepository } from "../repositories/ai-context-snapshot.repository.js";

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
