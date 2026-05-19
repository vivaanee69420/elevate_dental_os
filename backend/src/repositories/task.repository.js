// ============================================================================
// Task repository — all Supabase data access for the tasks domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const taskRepository = {
    async list(orgId, q) {
        let query = supabase_1.serviceClient
            .from('tasks')
            .select('*, assignee:users!tasks_assigned_to_fkey(id, full_name)')
            .eq('organisation_id', orgId)
            .order('due_date', { ascending: true, nullsFirst: false });
        if (q.status)
            query = query.eq('status', q.status);
        if (q.assigned_to)
            query = query.eq('assigned_to', q.assigned_to);
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        return data;
    },
    async create(row) {
        return supabase_1.serviceClient.from('tasks').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('tasks')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
