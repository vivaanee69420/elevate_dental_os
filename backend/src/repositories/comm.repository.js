// ============================================================================
// Comm repository — Supabase data access for the communications domain.
// Phase 6: visibility filtering. Rows have a `visibility` column:
//   'org' | 'role:owner' | 'role:practice_manager' | 'role:reception' |
//   'user:<uuid>'
// list() now accepts the caller's role + id to filter rows the caller is
// allowed to see. Owners always see everything in their org.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const commRepository = {
    async list(orgId, q, viewer = null) {
        let query = supabase_1.serviceClient
            .from('communications')
            .select('*, contact:contacts(id, first_name, last_name, email, integration_account_id), lead:leads(id, integration_account_id)')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false })
            .limit(200);
        if (q.contact_id) query = query.eq('contact_id', q.contact_id);
        if (q.lead_id)    query = query.eq('lead_id', q.lead_id);
        if (q.channel)    query = query.eq('channel', q.channel);
        if (q.integration_account_id) query = query.eq('integration_account_id', q.integration_account_id);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        // Visibility filter — happens app-side. Owner sees all.
        if (!viewer || viewer.role === 'owner') return data;
        const allowedVisibility = new Set(['org', `role:${viewer.role}`, `user:${viewer.id}`]);
        return (data ?? []).filter((row) => {
            const v = row.visibility ?? 'org';
            return allowedVisibility.has(v) || row.assigned_user_id === viewer.id;
        });
    },
    async create(row) {
        return supabase_1.serviceClient.from('communications').insert(row).select().single();
    },
};
