// ============================================================================
// Review repository — all Supabase data access for the reviews domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const reviewRepository = {
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('reviews')
            .select('*')
            .eq('organisation_id', orgId)
            .order('published_at', { ascending: false })
            .limit(100);
        return data;
    },
    async respond(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('reviews')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
