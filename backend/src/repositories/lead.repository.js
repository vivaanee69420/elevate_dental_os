// ============================================================================
// Lead repository — all Supabase data access for the leads domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { crmHidden } from "../lib/integration-gating.js";
export const leadRepository = {
    async list(orgId, q) {
        if (await crmHidden(orgId)) return [];
        let query = supabase_1.serviceClient
            .from('leads')
            .select(`
        *,
        contact:contacts(id, first_name, last_name, email, phone),
        practice:practices(id, name),
        assignee:users!leads_assigned_to_fkey(id, full_name, email)
      `)
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false })
            .limit(q.limit);
        if (q.status)
            query = query.eq('status', q.status);
        if (q.practice_id)
            query = query.eq('practice_id', q.practice_id);
        if (q.integration_account_id)
            query = query.eq('integration_account_id', q.integration_account_id);
        if (q.assigned_to)
            query = query.eq('assigned_to', q.assigned_to);
        if (q.ghl_pipeline_id)
            query = query.eq('ghl_pipeline_id', q.ghl_pipeline_id);
        if (q.since)
            query = query.gte('created_at', q.since);
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        return data;
    },
    async getById(orgId, id) {
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select(`*, contact:contacts(*), communications:communications(*), tasks:tasks(*)`)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .single();
        return { data, error };
    },
    async createContact(orgId, practiceId, contact) {
        return supabase_1.serviceClient
            .from('contacts')
            .insert({ organisation_id: orgId, practice_id: practiceId, type: 'lead', ...contact })
            .select('id')
            .single();
    },
    async create(row) {
        return supabase_1.serviceClient.from('leads').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('leads')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
    async softDelete(orgId, id) {
        return supabase_1.serviceClient
            .from('leads')
            .update({ status: 'not_proceeding' })
            .eq('id', id)
            .eq('organisation_id', orgId);
    },
    // Lead count + value per GHL pipeline. RPC-aggregated, never a plain select:
    // an org can hold tens of thousands of leads and PostgREST caps reads at
    // 1000 rows, which would silently under-count. accountId null = all.
    async pipelineCounts(orgId, accountId = null) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('lead_pipeline_counts', { p_org: orgId, p_account: accountId });
        if (error)
            throw new Error(error.message);
        return data ?? [];
    },
    async funnelRows(orgId) {
        if (await crmHidden(orgId)) return [];
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select('status, estimated_value_pence')
            .eq('organisation_id', orgId);
        if (error)
            throw new Error(error.message);
        return data;
    },
};
