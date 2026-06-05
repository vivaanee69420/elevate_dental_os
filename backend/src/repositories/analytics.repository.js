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
        // kind='practice' (T2): exclude academy/lab from clinical rollups.
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId)
            .eq('kind', 'practice')
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // Entities of a given kind ('practice'|'academy'|'lab') for scope resolution.
    async entitiesByKind(orgId, kind) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name, kind')
            .eq('organisation_id', orgId)
            .eq('kind', kind)
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
    // Cashflow sources. bankSummary: total balance + freshest sync (staleness
    // surfaced — a 6-month-old balance must not read as "current").
    async bankSummary(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('bank_accounts')
            .select('balance_pence, last_synced_at')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        const rows = data || [];
        const totalPence = rows.reduce((s, a) => s + (a.balance_pence || 0), 0);
        const lastSyncedAt = rows
            .map((a) => a.last_synced_at)
            .filter(Boolean)
            .sort()
            .pop() || null;
        return { totalPence, lastSyncedAt, count: rows.length };
    },
    // EXACT settled-payment revenue, summed in Postgres (RPC) so it is never
    // truncated by the 1000-row read cap. Returns [{ day:'YYYY-MM-DD', pence }]
    // for the window (<=366 rows); callers bucket days into months/weeks/TTM.
    // practiceId scopes to one practice. Real revenue source — no projection.
    async settledReceiptsByDay(orgId, sinceISO, practiceId = null, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('settled_receipts_by_day', {
            p_org: orgId,
            p_since: sinceISO,
            p_practice: practiceId ?? null,
            p_until: untilISO ?? null,
        });
        if (error)
            throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    // Exact per-practice rollups (Postgres GROUP BY via RPC — no 1000-row cap).
    // Manual chair-utilisation grid rows (the intentional, owner-maintained
    // occupancy source). Small table; aggregated per practice in the service.
    async chairUtilisationRows(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('chair_utilisation')
            .select('practice_id, booked_minutes, available_minutes')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return data || [];
    },
    async settledRevenueByPractice(orgId, sinceISO, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('settled_revenue_by_practice', {
            p_org: orgId, p_since: sinceISO, p_until: untilISO ?? null,
        });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    async appointmentsRollupByPractice(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient.rpc('appointments_rollup_by_practice', {
            p_org: orgId, p_since: sinceISO,
        });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    async leadsRollupByPractice(orgId) {
        const { data, error } = await supabase_1.serviceClient.rpc('leads_rollup_by_practice', { p_org: orgId });
        if (error) throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    // ------------------------------------------------------------------------
    // Business Hub sources — per-practice rollup across finance + ops + growth.
    async practicesFull(orgId) {
        // kind='practice' (T2): exclude academy/lab (no chairs) from chair/util rollups.
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name, chairs, assumed_util_pct')
            .eq('organisation_id', orgId)
            .eq('kind', 'practice')
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // Appointments in a rolling window for utilisation / DNA per practice.
    async appointmentsForHub(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient
            .from('appointments')
            .select('practice_id, status, starts_at')
            .eq('organisation_id', orgId)
            .gte('starts_at', sinceISO)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
    // All leads (any age) for conversion per practice.
    async leadsForHub(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select('practice_id, status')
            .eq('organisation_id', orgId)
            .limit(LIMIT_GUARD);
        if (error)
            throw new Error(error.message);
        return data || [];
    },
};
