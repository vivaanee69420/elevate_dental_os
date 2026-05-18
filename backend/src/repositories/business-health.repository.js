"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessHealthRepository = void 0;
// ============================================================================
// Business Health repository — all Supabase data access for the domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.businessHealthRepository = {
    async getHealth(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('*')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async getExisting(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('id, baseline, targets')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async insertSnapshot(row) {
        return supabase_1.serviceClient.from('business_health_snapshots').insert(row);
    },
    async insertSnapshotReturning(row) {
        return supabase_1.serviceClient
            .from('business_health_snapshots')
            .insert(row)
            .select()
            .single();
    },
    async upsertHealth(payload) {
        return supabase_1.serviceClient
            .from('business_health')
            .upsert(payload, { onConflict: 'organisation_id' })
            .select()
            .single();
    },
    async getInsightsData(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline, targets')
            .eq('organisation_id', orgId)
            .single();
        return data;
    },
    async listSnapshots(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health_snapshots')
            .select('*')
            .eq('organisation_id', orgId)
            .order('snapshot_date', { ascending: true });
        return data;
    },
    async getProgressData(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline, targets, setup_completed_at')
            .eq('organisation_id', orgId)
            .single();
        return data;
    },
};
