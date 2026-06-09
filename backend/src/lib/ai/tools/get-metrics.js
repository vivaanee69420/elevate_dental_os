// backend/src/lib/ai/tools/get-metrics.js
// ============================================================================
// get_metrics — the AI drill-down tool. The model calls it to fetch aggregated
// business metrics for a period (cached) or an arbitrary date range (live), at
// group ('all') or per-practice scope. orgId is NEVER a tool param: it is bound
// into the executor by the call site (req.user), so the model cannot reach
// another org. All param validation returns a structured tool_error (never
// throws) so the model can self-correct.
// ============================================================================
import { getSnapshot } from '../../../services/ai-context.service.js';
import { analyticsService } from '../../../services/analytics.service.js';
import { analyticsRepository } from '../../../repositories/analytics.repository.js';
import { sanitizeBundle } from '../sanitize.js';

const PERIOD_RE = /^(current|\d{4}-\d{2})$/;
const MAX_RANGE_MONTHS = 24;

export const getMetricsTool = {
  name: 'get_metrics',
  description:
    "Fetch the practice group's aggregated business metrics (P&L, cash, debt, leakage, chairs, clinicians, marketing, per-practice breakdown) for a period or date range. Use `period` ('current' or a 'YYYY-MM' month) for fast cached figures, OR `since`+`until` (YYYY-MM-DD) for a custom range. Optional `scope`: 'all' (default) or a practice name to narrow to one practice. Money is integer pence. Some fields may be null when the relevant data source is not connected.",
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      period: { type: 'string', description: "'current' | 'YYYY-MM'. Mutually exclusive with since/until." },
      since: { type: 'string', description: 'Range start, YYYY-MM-DD (use with until).' },
      until: { type: 'string', description: 'Range end, YYYY-MM-DD (use with since).' },
      scope: { type: 'string', description: "'all' (default) or a practice name." },
    },
  },
};

// Resolve a scope arg ('all' or a practice name/id) to 'all' or a practice id.
// Returns { scope } or { tool_error }.
async function resolveScopeArg(orgId, scope) {
  if (!scope || scope === 'all') return { scope: 'all' };
  const entities = await analyticsRepository.allEntities(orgId);
  const hit = entities.find(
    (e) => e.id === scope || (e.name && e.name.toLowerCase() === String(scope).toLowerCase()),
  );
  if (!hit) return { tool_error: `unknown scope "${scope}" — use 'all' or an exact practice name` };
  return { scope: hit.id };
}

export function makeGetMetricsExecutor(orgId) {
  return async function getMetrics(input = {}) {
    const { period, since, until, scope } = input;

    // Mutual exclusion: period vs range
    if (period && (since || until)) {
      return { tool_error: 'period and since/until are mutually exclusive — pass one or the other' };
    }

    if (period) {
      if (!PERIOD_RE.test(period)) {
        return { tool_error: "invalid period — use 'current' or a 'YYYY-MM' month" };
      }
    } else if (since || until) {
      if (!since || !until) {
        return { tool_error: 'both since and until are required for a date range' };
      }
      const s = new Date(since);
      const u = new Date(until);
      if (Number.isNaN(s.getTime()) || Number.isNaN(u.getTime())) {
        return { tool_error: 'since/until must be YYYY-MM-DD dates' };
      }
      if (u < s) {
        return { tool_error: 'until must be on or after since' };
      }
      const months =
        (u.getUTCFullYear() - s.getUTCFullYear()) * 12 + (u.getUTCMonth() - s.getUTCMonth());
      if (months > MAX_RANGE_MONTHS) {
        return { tool_error: `range too large — keep it within ${MAX_RANGE_MONTHS} months` };
      }
      if (s.getTime() > Date.now()) {
        return { tool_error: 'since cannot be in the future' };
      }
    } else {
      // Neither period nor range — default to current month
      return getMetrics({ period: 'current', scope });
    }

    const resolved = await resolveScopeArg(orgId, scope);
    if (resolved.tool_error) return resolved;

    // Cached fast path: a period at group scope is exactly a Phase 1 snapshot.
    if (period && resolved.scope === 'all') {
      const snapshot = await getSnapshot(orgId, period);
      return snapshot || { tool_error: 'no metrics available for this period yet' };
    }

    // Live path: explicit range, or a narrowed scope. Sanitize labels (the cached
    // path is already sanitized by buildSnapshot).
    const bundle = await analyticsService.assembleLiveContext(orgId, {
      ...(period ? { period } : { since, until }),
      scope: resolved.scope,
    });
    return sanitizeBundle(bundle);
  };
}
