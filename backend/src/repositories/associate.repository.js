// ============================================================================
// Associate repository — roster rows + per-associate appointment stats.
// serviceClient bypasses RLS, so every query carries the org filter. The stats
// method prefers the associate_appointment_stats RPC and falls back to a
// JS-side grouping if the RPC is absent (mirrors the auth_bootstrap pattern).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { pmsHidden } from "../lib/integration-gating.js";

export const associateRepository = {
    async list(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('associates')
            .select('id, full_name, pay_pct, joined_date, active, pms_user_id, gdc_number, colour, dentally_role, uda_target, primary_practice_id, practice:practices!associates_primary_practice_id_fkey(name)')
            .eq('organisation_id', orgId)
            .order('full_name', { ascending: true });
        if (practiceId) query = query.eq('primary_practice_id', practiceId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async appointmentStatsByAssociate(orgId, since) {
        if (await pmsHidden(orgId)) return new Map();
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

    // Per-associate production (invoice_items) + UDA/conversion (treatment_plans)
    // over the window, in one RPC. Empty Map when PMS data is gated/absent. No JS
    // fallback: both source tables are Dentally-only, so a missing RPC -> no money
    // metrics rather than a wrong guess.
    async metricsByAssociate(orgId, since) {
        if (await pmsHidden(orgId)) return new Map();
        const { data, error } = await supabase_1.serviceClient
            .rpc('associate_metrics', { p_org: orgId, p_since: since });
        if (error || !Array.isArray(data)) return new Map();
        const map = new Map();
        for (const r of data) {
            map.set(r.associate_id, {
                production_pence: Number(r.production_pence) || 0,
                uda_delivered: Number(r.uda_delivered) || 0,
                plans_total: Number(r.plans_total) || 0,
                plans_completed: Number(r.plans_completed) || 0,
            });
        }
        return map;
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
                // Stable order is required: without it PostgREST gives no row-order
                // guarantee across .range() windows, so rows could be skipped or
                // double-counted between pages (silently wrong per-associate stats).
                .order('id', { ascending: true })
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
