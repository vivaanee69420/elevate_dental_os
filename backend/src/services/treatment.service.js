// ============================================================================
// Treatment service — builds the Treatment Mix table from appointment volume.
// Share = type volume / total volume. No money: appointments carry no price
// in the Dentally feed, so revenue/margin are intentionally absent.
// ============================================================================
import { treatmentRepository } from "../repositories/treatment.repository.js";

export const treatmentService = {
    async mix(orgId, { practice_id, weeks, since, until }) {
        // Prefer the explicit [since, until) window from the global filter; fall
        // back to a trailing `weeks` window (default 52) when no bounds are sent.
        const windowed = Boolean(since);
        const sinceIso = since ?? new Date(Date.now() - (weeks ?? 52) * 7 * 86400000).toISOString();
        const untilIso = until ?? null;
        const rows = await treatmentRepository.mixByType(orgId, { practiceId: practice_id, since: sinceIso, until: untilIso });
        const total = rows.reduce((s, r) => s + r.volume, 0);
        const treatments = rows
            .map((r) => ({
                type: r.type,
                volume: r.volume,
                share_pct: total ? Math.round((1000 * r.volume) / total) / 10 : 0,
            }))
            .sort((a, b) => b.volume - a.volume);
        return {
            treatments,
            total_volume: total,
            distinct_types: treatments.length,
            top_treatment: treatments[0]?.type ?? null,
            window_weeks: windowed ? null : (weeks ?? 52),
            since: sinceIso,
            until: untilIso,
        };
    },
};
