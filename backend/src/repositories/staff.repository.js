// ============================================================================
// Staff repository — roster rows. serviceClient bypasses RLS, so every query
// carries the explicit org filter.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const staffRepository = {
    async list(orgId, practiceId) {
        let query = supabase_1.serviceClient
            .from('staff')
            .select('id, full_name, role, pms_role, email, phone, title, last_login_at, active, source, practice:practices!staff_practice_id_fkey(name)')
            .eq('organisation_id', orgId)
            .order('full_name', { ascending: true });
        if (practiceId) query = query.eq('practice_id', practiceId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
