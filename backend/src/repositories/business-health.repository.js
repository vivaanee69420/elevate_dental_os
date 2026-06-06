// ============================================================================
// Business Health repository — all Supabase data access for the domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const businessHealthRepository = {
    async getHealth(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('*')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async getExisting(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('id, baseline, targets, setup_completed_at')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async insertSnapshot(row) {
        return supabase_1.serviceClient.from('business_health_snapshots').insert(row);
    },
    async insertSnapshotReturning(row) {
        return supabase_1.serviceClient
            .from('business_health_snapshots')
            .insert(row)
            .select()
            .single();
    },
    async upsertHealth(payload) {
        return supabase_1.serviceClient
            .from('business_health')
            .upsert(payload, { onConflict: 'organisation_id' })
            .select()
            .single();
    },
    async getInsightsData(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline, targets')
            .eq('organisation_id', orgId)
            .single();
        return data;
    },
    // --- Manual-input history (000054) ---------------------------------------
    // Write/refresh today's point-in-time copy of the owner's manual inputs.
    // Lives in the `inputs` column so it never clobbers the cron's `metrics`
    // on the shared daily row (unique org+snapshot_date). Read-modify-write
    // rather than upsert because `metrics` is NOT NULL — a blind upsert would
    // either violate it on insert or wipe cron metrics on conflict.
    async upsertInputsSnapshot(orgId, dateStr, inputs) {
        const { data: existing } = await supabase_1.serviceClient
            .from('business_health_snapshots')
            .select('id')
            .eq('organisation_id', orgId)
            .eq('snapshot_date', dateStr)
            .maybeSingle();
        if (existing) {
            const { error } = await supabase_1.serviceClient
                .from('business_health_snapshots')
                .update({ inputs })
                .eq('id', existing.id)
                .eq('organisation_id', orgId);
            if (error) throw new Error(error.message);
        } else {
            const { error } = await supabase_1.serviceClient
                .from('business_health_snapshots')
                .insert({ organisation_id: orgId, snapshot_date: dateStr, label: 'inputs', metrics: {}, inputs });
            if (error) throw new Error(error.message);
        }
        return inputs;
    },
    // Latest manual-input blob effective on/before `dateStr` (as-of read).
    async getInputsAsOf(orgId, dateStr) {
        const { data } = await supabase_1.serviceClient
            .from('business_health_snapshots')
            .select('snapshot_date, inputs')
            .eq('organisation_id', orgId)
            .lte('snapshot_date', dateStr)
            .order('snapshot_date', { ascending: false });
        const row = (data || []).find((r) => r.inputs);
        return row?.inputs || null;
    },
    async listSnapshots(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health_snapshots')
            .select('*')
            .eq('organisation_id', orgId)
            .order('snapshot_date', { ascending: true });
        return data;
    },
    async getProgressData(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline, targets, setup_completed_at')
            .eq('organisation_id', orgId)
            .single();
        return data;
    },
    async getMetricsData(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline, targets, manual')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async setManualMetric(orgId, key, entry) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('manual')
            .eq('organisation_id', orgId)
            .maybeSingle();
        const manual = { ...(data?.manual || {}), [key]: entry };
        const { error } = await supabase_1.serviceClient
            .from('business_health')
            .update({ manual })
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        return manual[key];
    },
    async updateCadence(orgId, frequency) {
        const { error } = await supabase_1.serviceClient
            .from('business_health')
            .update({ snapshot_frequency: frequency })
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
    },
    // --- Live KPI actuals (000056) -------------------------------------------
    // Patient KPIs (new/active/retention/recall) computed in Postgres over the
    // appointments + contacts tables. Returns the RPC's JSON blob (keys may be
    // null when a source signal is absent). p_asof null = current date.
    async patientActuals(orgId, asof = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('health_patient_actuals', {
            p_org: orgId, p_asof: asof ?? null,
        });
        if (error) throw new Error(error.message);
        return data || {};
    },
    // Production KPIs (avg case value, production/associate) from invoice_items
    // within [sinceISO, untilISO). Money in pence; keys null when no source rows.
    async productionActuals(orgId, sinceISO, untilISO = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('health_production_actuals', {
            p_org: orgId, p_since: sinceISO, p_until: untilISO ?? null,
        });
        if (error) throw new Error(error.message);
        return data || {};
    },
    // Group chair utilisation % from the owner-maintained chair grid. Small
    // table; summed in Node. Returns null when no available minutes are set.
    async chairUtilisationSummary(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('chair_utilisation')
            .select('booked_minutes, available_minutes')
            .eq('organisation_id', orgId)
            .limit(5000);
        if (error) throw new Error(error.message);
        const rows = data || [];
        const booked = rows.reduce((s, r) => s + (r.booked_minutes || 0), 0);
        const avail = rows.reduce((s, r) => s + (r.available_minutes || 0), 0);
        return avail > 0 ? Math.round((booked / avail) * 1000) / 10 : null;
    },
    // Average first-response time (minutes) across leads created in the window.
    // GHL/CRM signal; null until lead_response_minutes is populated (e.g. GHL
    // conversations sync) -> the metric stays manual.
    async leadResponseActual(orgId, sinceISO) {
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select('last_response_minutes')
            .eq('organisation_id', orgId)
            .gte('created_at', sinceISO)
            .not('last_response_minutes', 'is', null)
            .limit(5000);
        if (error) throw new Error(error.message);
        const rows = data || [];
        if (!rows.length) return null;
        const sum = rows.reduce((s, r) => s + (r.last_response_minutes || 0), 0);
        return Math.round((sum / rows.length) * 10) / 10;
    },
};
