// ============================================================================
// Integration repository — all Supabase data access for integrations domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const integrationRepository = {
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('integrations')
            .select('id, provider, status, last_synced_at, last_error, config')
            .eq('organisation_id', orgId);
        return data;
    },
    async remove(orgId, id) {
        await supabase_1.serviceClient
            .from('integrations')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId);
    },
};
