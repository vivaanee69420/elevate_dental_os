// ============================================================================
// Associate service — merges the roster with appointment stats and bands a
// status. Production / UDA / conversion are not in the Dentally feed -> null.
// ============================================================================
import { associateRepository } from "../repositories/associate.repository.js";
import { associateStatus } from "../lib/associate-status.js";

export const associateService = {
    async list(orgId, { practice_id, weeks }) {
        const since = new Date(Date.now() - (weeks ?? 52) * 7 * 86400000).toISOString();
        const [roster, stats] = await Promise.all([
            associateRepository.list(orgId, practice_id),
            associateRepository.appointmentStatsByAssociate(orgId, since),
        ]);
        return roster.map((a) => {
            const s = stats.get(a.id) ?? { total: 0, completed: 0, no_shows: 0 };
            const completion_pct = s.total ? Math.round((100 * s.completed) / s.total) : null;
            const no_show_pct = s.total ? Math.round((100 * s.no_shows) / s.total) : null;
            return {
                id: a.id,
                full_name: a.full_name,
                practice: a.practice?.name ?? null,
                pay_pct: a.pay_pct != null ? a.pay_pct / 100 : null,
                joined_date: a.joined_date ?? null,
                active: a.active !== false,
                treatments: s.completed,
                appointments_total: s.total,
                no_shows: s.no_shows,
                completion_pct,
                no_show_pct,
                status: associateStatus({ completionPct: completion_pct, total: s.total }),
                ttm_production: null,
                ttm_uda: null,
                conversion: null,
            };
        });
    },
};
