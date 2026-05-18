"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payRunRepository = void 0;
// ============================================================================
// Pay-run repository — all Supabase data access for the pay-runs domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.payRunRepository = {
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
