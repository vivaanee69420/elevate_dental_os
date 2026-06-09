// ============================================================================
// CRM settings repository — Supabase data access. serviceClient + explicit
// organisation_id filter (tenant isolation). One row per org (PK org_id).
// Aggregator counts read sibling CRM tables; the sequences table (B3) may not
// exist yet, so its count is defensive (0 on any error / missing table).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const crmSettingsRepository = {
    async get(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('crm_settings')
            .select('*')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async upsert(orgId, patch) {
        return supabase_1.serviceClient
            .from('crm_settings')
            .upsert({ organisation_id: orgId, ...patch }, { onConflict: 'organisation_id' })
            .select()
            .single();
    },
    // Non-archived templates for this org.
    async templateCount(orgId) {
        const { count } = await supabase_1.serviceClient
            .from('crm_templates')
            .select('id', { count: 'exact', head: true })
            .eq('organisation_id', orgId)
            .eq('is_archived', false);
        return count || 0;
    },
    // Active sequences (B3). Defensive: the table may not exist yet.
    async activeSequenceCount(orgId) {
        const { count, error } = await supabase_1.serviceClient
            .from('crm_sequences')
            .select('id', { count: 'exact', head: true })
            .eq('organisation_id', orgId)
            .eq('is_active', true);
        if (error) return 0;
        return count || 0;
    },
};
