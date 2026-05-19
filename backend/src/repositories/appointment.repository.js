// ============================================================================
// Appointment repository — all Supabase data access for the appointments domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const appointmentRepository = {
    async list(orgId, q) {
        let query = supabase_1.serviceClient
            .from('appointments')
            .select('*, contact:contacts(id, first_name, last_name), associate:associates(id, full_name), practice:practices(id, name)')
            .eq('organisation_id', orgId)
            .order('starts_at', { ascending: true });
        if (q.from)
            query = query.gte('starts_at', q.from);
        if (q.to)
            query = query.lte('starts_at', q.to);
        if (q.practice_id)
            query = query.eq('practice_id', q.practice_id);
        if (q.associate_id)
            query = query.eq('associate_id', q.associate_id);
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        return data;
    },
    async create(row) {
        return supabase_1.serviceClient.from('appointments').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('appointments')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
