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
    async remove(orgId, id) {
        return supabase_1.serviceClient
            .from('tasks')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
    // One task with its assignee email — used by the reminder send path.
    async getWithAssignee(orgId, id) {
        return supabase_1.serviceClient
            .from('tasks')
            .select('*, assignee:users!tasks_assigned_to_fkey(id, full_name, email)')
            .eq('id', id)
            .eq('organisation_id', orgId)
            .single();
    },
    // Open/in-progress tasks past their due date, with assignee email. Used by
    // bulk-remind + the nightly cron. nullsFirst:false keeps undated tasks out.
    async listOverdue(orgId) {
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase_1.serviceClient
            .from('tasks')
            .select('*, assignee:users!tasks_assigned_to_fkey(id, full_name, email)')
            .eq('organisation_id', orgId)
            .in('status', ['open', 'in_progress'])
            .lt('due_date', today)
            .order('due_date', { ascending: true });
        if (error)
            throw new Error(error.message);
        return data;
    },
    // Increment reminder_count and stamp last_reminded_at in one round trip.
    async bumpReminder(orgId, id, currentCount) {
        return supabase_1.serviceClient
            .from('tasks')
            .update({
                reminder_count: (currentCount || 0) + 1,
                last_reminded_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
