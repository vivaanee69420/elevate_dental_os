// ============================================================================
// CRM template repository — Supabase data access. serviceClient + explicit
// organisation_id filter on every query (tenant isolation). Soft-delete = set
// is_archived; list excludes archived.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const crmTemplateRepository = {
    async list(orgId, { channel } = {}) {
        let q = supabase_1.serviceClient
            .from('crm_templates')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('is_archived', false)
            .order('created_at', { ascending: false });
        if (channel) q = q.eq('channel', channel);
        const { data } = await q;
        return data;
    },
    async create(row) {
        return supabase_1.serviceClient.from('crm_templates').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('crm_templates')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
    // Soft delete.
    async archive(orgId, id) {
        return supabase_1.serviceClient
            .from('crm_templates')
            .update({ is_archived: true })
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
