// ============================================================================
// Plan4Growth AI repository — Supabase context reads for the chat domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const p4gAiRepository = {
    async health(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline, targets')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async latestSnapshot(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health_snapshots')
            .select('*')
            .eq('organisation_id', orgId)
            .order('snapshot_date', { ascending: false })
            .limit(1);
        return data;
    },
};
