// ============================================================================
// Analytics repository — Supabase reads for the analytics domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const analyticsRepository = {
    async baselineMaybe(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async baselineSingle(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline')
            .eq('organisation_id', orgId)
            .single();
        return data;
    },
};
