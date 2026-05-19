// ============================================================================
// Analytics repository — Supabase reads for the analytics domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// Max rows we read for an in-Node aggregate. Realistic per-org practice +
// settled-payment counts sit far below this; if it ever trips, the service
// surfaces truncated:true rather than computing a silently-wrong total.
export const LIMIT_GUARD = 5000;

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
    // ------------------------------------------------------------------------
    // Per-practice scorecard sources. serviceClient bypasses RLS, so the
    // explicit .eq('organisation_id', orgId) IS the only tenant guard here
    // (see CLAUDE.md). LIMIT_GUARD: the Supabase client silently caps a
    // select; if we ever hit the cap the aggregate would be quietly wrong,
    // so we fetch up to the cap and let the service flag truncation.
    async practicesList(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    async settledPayments(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('payments')
            .select('practice_id, amount_pence')
            .eq('organisation_id', orgId)
            .eq('status', 'settled')
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // ------------------------------------------------------------------------
    // AI-Insights rolling-window sources. Same service-client tenant rule:
    // the explicit .eq('organisation_id', orgId) IS the only isolation.
    async leadsInWindow(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select('status, practice_id, source, estimated_value_pence')
            .eq('organisation_id', orgId)
            .gte('created_at', sinceISO)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    async settledPaymentsInWindow(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient
            .from('payments')
            .select('practice_id, amount_pence')
            .eq('organisation_id', orgId)
            .eq('status', 'settled')
            .gte('processed_at', sinceISO)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
};
