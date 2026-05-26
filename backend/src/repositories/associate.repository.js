// ============================================================================
// Associate repository — roster rows + per-associate appointment stats.
// serviceClient bypasses RLS, so every query carries the org filter. The stats
// method prefers the associate_appointment_stats RPC and falls back to a
// JS-side grouping if the RPC is absent (mirrors the auth_bootstrap pattern).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const associateRepository = {
    async list(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('associates')
            .select('id, full_name, pay_pct, joined_date, active, primary_practice_id, practice:practices!associates_primary_practice_id_fkey(name)')
            .eq('organisation_id', orgId)
            .order('full_name', { ascending: true });
        if (practiceId) query = query.eq('primary_practice_id', practiceId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async appointmentStatsByAssociate(orgId, since) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('associate_appointment_stats', { p_org: orgId, p_since: since });
        if (!error && Array.isArray(data)) {
            const map = new Map();
            for (const r of data) {
                map.set(r.associate_id, { total: Number(r.total), completed: Number(r.completed), no_shows: Number(r.no_shows) });
            }
            return map;
        }
        return this._statsFallback(orgId, since);
    },

    async _statsFallback(orgId, since) {
        const map = new Map();
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase_1.serviceClient
                .from('appointments')
                .select('associate_id, status')
                .eq('organisation_id', orgId)
                .not('associate_id', 'is', null)
                .gte('starts_at', since)
                .range(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            const rows = data ?? [];
            for (const r of rows) {
                const cur = map.get(r.associate_id) ?? { total: 0, completed: 0, no_shows: 0 };
                cur.total++;
                if (r.status === 'completed') cur.completed++;
                if (r.status === 'no_show') cur.no_shows++;
                map.set(r.associate_id, cur);
            }
            if (rows.length < PAGE) break;
        }
        return map;
    },
};
