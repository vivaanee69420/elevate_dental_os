// ============================================================================
// Treatment repository — appointment volume grouped by appointment_type.
// serviceClient bypasses RLS, so every query carries the org filter. Prefers
// the treatment_mix_stats RPC and falls back to a paginated JS-side grouping
// if the RPC is absent (mirrors the associate_appointment_stats pattern).
//
// Appointments carry no price (documented Dentally data wall) -> this is a
// VOLUME mix only: { type, volume }. Revenue/margin are not sourced here.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const treatmentRepository = {
    async mixByType(orgId, { practiceId, since }) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('treatment_mix_stats', { p_org: orgId, p_practice: practiceId ?? null, p_since: since });
        if (!error && Array.isArray(data)) {
            return data.map((r) => ({ type: r.appointment_type ?? 'Unspecified', volume: Number(r.volume) }));
        }
        return this._mixFallback(orgId, { practiceId, since });
    },

    async _mixFallback(orgId, { practiceId, since }) {
        const counts = new Map();
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            let query = supabase_1.serviceClient
                .from('appointments')
                .select('appointment_type')
                .eq('organisation_id', orgId)
                .gte('starts_at', since);
            if (practiceId) query = query.eq('practice_id', practiceId);
            // Stable order is required: without it PostgREST gives no row-order
            // guarantee across .range() windows, so rows could be skipped or
            // double-counted between pages. .range() is terminal, so it must
            // come last (after any conditional filters).
            const { data, error } = await query
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            const rows = data ?? [];
            for (const r of rows) {
                const key = r.appointment_type ?? 'Unspecified';
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            if (rows.length < PAGE) break;
        }
        return [...counts.entries()].map(([type, volume]) => ({ type, volume }));
    },
};
