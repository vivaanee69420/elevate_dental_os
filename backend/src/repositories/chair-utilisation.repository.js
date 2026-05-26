// ============================================================================
// Chair utilisation repository — Supabase data access. serviceClient bypasses
// RLS, so every query carries the explicit organisation_id tenant filter.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const chairUtilisationRepository = {
    async list(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('chair_utilisation')
            .select('*')
            .eq('organisation_id', orgId)
            .order('chair_name', { ascending: true })
            .order('weekday', { ascending: true });
        if (practiceId) query = query.eq('practice_id', practiceId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async create(row) {
        return supabase_1.serviceClient.from('chair_utilisation').insert(row).select().single();
    },

    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('chair_utilisation')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .maybeSingle();
    },

    async remove(orgId, id) {
        return supabase_1.serviceClient
            .from('chair_utilisation')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select('id')
            .maybeSingle();
    },
};
