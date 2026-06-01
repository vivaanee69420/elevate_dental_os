// ============================================================================
// Pay-run repository — all Supabase data access for the pay-runs domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const payRunRepository = {
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('pay_runs')
            .select('*, lines:pay_run_lines(*, associate:associates(full_name))')
            .eq('organisation_id', orgId)
            .order('period_end', { ascending: false });
        return data;
    },
    async listAssociates(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('associates')
            .select('id, full_name, pay_pct, lab_split_pct')
            .eq('organisation_id', orgId);
        return data;
    },

    // Active roster with practice name — for the draft preview rows.
    async rosterForDraft(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('associates')
            .select('id, full_name, pay_pct, lab_split_pct, active, practice:practices!associates_primary_practice_id_fkey(name)')
            .eq('organisation_id', orgId)
            .order('full_name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).filter((a) => a.active !== false);
    },

    // Per-associate completed private production (integer pence) for a period,
    // summed from treatment_plans. Prefers the associate_production RPC; falls
    // back to a paginated JS-side sum if the RPC is absent.
    async productionByAssociate(orgId, { start, end }) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('associate_production', { p_org: orgId, p_start: start, p_end: end });
        if (!error && Array.isArray(data)) {
            return new Map(data.map((r) => [r.associate_id, Number(r.production_pence)]));
        }
        return this._productionFallback(orgId, { start, end });
    },

    async _productionFallback(orgId, { start, end }) {
        const map = new Map();
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase_1.serviceClient
                .from('treatment_plans')
                .select('associate_id, private_value_pence')
                .eq('organisation_id', orgId)
                .eq('completed', true)
                .not('associate_id', 'is', null)
                .gte('completed_at', start)
                .lte('completed_at', end)
                // Stable order so .range() windows neither skip nor double-count.
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            const rows = data ?? [];
            for (const r of rows) {
                map.set(r.associate_id, (map.get(r.associate_id) ?? 0) + (r.private_value_pence ?? 0));
            }
            if (rows.length < PAGE) break;
        }
        return map;
    },
    async createPayRun(row) {
        return supabase_1.serviceClient.from('pay_runs').insert(row).select().single();
    },
    async insertLines(lines) {
        return supabase_1.serviceClient.from('pay_run_lines').insert(lines);
    },
    async updateTotals(id, totals) {
        return supabase_1.serviceClient.from('pay_runs').update(totals).eq('id', id);
    },
    async approve(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('pay_runs')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId);
    },
};
