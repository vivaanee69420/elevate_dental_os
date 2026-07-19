// ============================================================================
// Ad attribution repository — the reads behind /settings/ad-attribution and
// /ad-performance. Tenant isolation: serviceClient path, so EVERY query
// carries an explicit .eq('organisation_id', orgId) (rule 3).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// PostgREST caps a single response at db-max-rows (1000) and does it SILENTLY.
// A 12-month window of leads would come back truncated and every total
// downstream would quietly undercount. See the monthly_financials truncation
// incident.
const PAGE = 1000;
async function fetchAllPages(buildQuery) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await buildQuery().range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = data || [];
        out.push(...rows);
        if (rows.length < PAGE) return out;
    }
}

export const adAttributionRepository = {
    // GHL subaccounts with their pipelines flattened out of config JSON.
    // practice_id null is legitimate: the Plan4Growth academy and accounting
    // Locations live here too and must NOT be folded into practice numbers.
    async ghlAccounts(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('integration_accounts')
            .select('id, label, external_account_id, practice_id, status, config')
            .eq('organisation_id', orgId)
            .eq('provider', 'gohighlevel')
            .order('label', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
            id: r.id,
            label: r.label,
            external_account_id: r.external_account_id,
            practice_id: r.practice_id ?? null,
            status: r.status ?? null,
            pipelines: (r.config?.pipelines ?? []).map((p) => ({ id: p.id, name: p.name })),
        }));
    },

    async practiceOptions(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId)
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((p) => ({ id: p.id, name: p.name }));
    },

    async adAccounts(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_accounts')
            .select('id, provider, customer_id, name, practice_id')
            .eq('organisation_id', orgId)
            .order('provider', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async setAdAccountPractice(orgId, adAccountId, practiceId) {
        const { error } = await supabase_1.serviceClient
            .from('ad_accounts')
            .update({ practice_id: practiceId ?? null })
            .eq('organisation_id', orgId)
            .eq('id', adAccountId);
        if (error) throw new Error(error.message);
    },

    // Leads created in [since, until), with the contact fields the matcher needs.
    async leadsInWindow(orgId, since, until) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('leads')
            .select('id, contact_id, practice_id, integration_account_id, ghl_pipeline_id, created_at, estimated_value_pence, contacts(first_name, last_name, email, phone)')
            .eq('organisation_id', orgId)
            .gte('created_at', since)
            .lt('created_at', until)
            .order('id', { ascending: true }));
    },

    // Lead volume per pipeline, for the settings screen. Counted over all time
    // so the operator can tell a busy pipeline from a dormant one regardless of
    // the window they happen to be looking at.
    async leadCountsByPipeline(orgId) {
        const rows = await fetchAllPages(() => supabase_1.serviceClient
            .from('leads')
            .select('id, integration_account_id, ghl_pipeline_id')
            .eq('organisation_id', orgId)
            .order('id', { ascending: true }));
        const counts = new Map();
        for (const r of rows) {
            if (!r.integration_account_id || !r.ghl_pipeline_id) continue;
            const k = `${r.integration_account_id}|${r.ghl_pipeline_id}`;
            counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return counts;
    },

    async acceptedForMatching(orgId, since, until) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('treatment_accepted')
            .select('id, practice_id, patient_name, value_pence, treatment_name, accepted_date, raw')
            .eq('organisation_id', orgId)
            .gte('accepted_date', since)
            .lt('accepted_date', until)
            .order('id', { ascending: true }));
    },

    async adSpend(orgId, since, until) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('ad_metrics')
            .select('id, provider, practice_id, spend_pence, metric_date')
            .eq('organisation_id', orgId)
            .gte('metric_date', since)
            .lt('metric_date', until)
            .order('id', { ascending: true }));
    },
};
