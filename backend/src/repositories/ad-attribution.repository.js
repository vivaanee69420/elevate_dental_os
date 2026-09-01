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

    // Emergent businesses and the practice each is mapped to. Read here rather
    // than through emergent-practice-map.repository.js so this feature's reads
    // stay in one repository; the alternative couples two features'
    // repositories together for a single query.
    //
    // practice_id null is legitimate and means "intentionally unmapped" — it is
    // kept in the result, not filtered out, because the whole point of the
    // mapping-health endpoint is to show what is unmapped.
    async emergentBusinesses(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .select('business_id, business_name, practice_id')
            .eq('organisation_id', orgId)
            .order('business_name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
            businessId: r.business_id,
            businessName: r.business_name ?? null,
            practiceId: r.practice_id ?? null,
        }));
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

    // Carry an ad-account -> practice mapping change onto the spend rows.
    // ad_metrics.practice_id is a denormalised copy of ad_accounts.practice_id
    // (migration 000140); without this the Marketing and Intelligence screens
    // would keep scoping spend to the OLD practice until the nightly sync
    // happened to re-cut that window. Same instant-backfill contract as
    // Emergent's restampPractice. Returns the number of rows restamped.
    async restampAdMetricsPractices(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('restamp_ad_metrics_practices', { p_org: orgId });
        if (error) throw new Error(`restamp_ad_metrics_practices: ${error.message}`);
        return Number(data ?? 0);
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
    //
    // Aggregated in SQL (migration 000115). This used to page every lead row
    // through PostgREST and count in JS, which at 20,509 leads meant 21
    // sequential round trips on EVERY config load — including the refetch after
    // each single click, so a saved change appeared seconds later and the screen
    // read as broken. One RPC call replaces the whole scan.
    //
    // p_org is applied inside the function, so this stays org-scoped without an
    // explicit .eq() — the tenant guard moves into the RPC rather than
    // disappearing.
    async leadCountsByPipeline(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('ad_channel_pipeline_lead_counts', { p_org: orgId });
        if (error) throw new Error(error.message);
        const counts = new Map();
        for (const r of data ?? []) {
            counts.set(`${r.integration_account_id}|${r.ghl_pipeline_id}`, Number(r.lead_count) || 0);
        }
        return counts;
    },

    // Feed health per ad account — when each account's metric feed last delivered.
    //
    // Aggregated in SQL (migration 000116) rather than paged: ad_metrics is
    // campaign x day grain, so computing a handful of maxima in JS would mean
    // reading the whole table (10,675 rows today and growing daily) on every
    // call. Same reasoning as leadCountsByPipeline.
    //
    // p_org is applied inside the function, so this stays org-scoped without an
    // explicit .eq() — the tenant guard moves into the RPC rather than
    // disappearing.
    async adAccountFeedHealth(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('ad_account_feed_health', { p_org: orgId });
        if (error) throw new Error(error.message);
        const byAccount = new Map();
        for (const r of data ?? []) {
            byAccount.set(`${r.provider}|${r.customer_id}`, {
                lastMetricDate: r.last_metric_date ?? null,
                daysStale: r.days_stale === null || r.days_stale === undefined ? null : Number(r.days_stale),
                metricRows: Number(r.metric_rows) || 0,
                spendPence: Number(r.spend_pence) || 0,
            });
        }
        return byAccount;
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
            .select('id, provider, practice_id, customer_id, spend_pence, metric_date')
            .eq('organisation_id', orgId)
            .gte('metric_date', since)
            .lt('metric_date', until)
            .order('id', { ascending: true }));
    },

    // Spend at its real grain — org x provider x account (customer_id) x
    // CAMPAIGN x day — for the spend drill-down. adSpend deliberately keeps a
    // narrower select because the performance path only needs a total.
    //
    // reach/frequency are NOT selected: they cannot be summed across days (the
    // same person seen on three days is one person, not three). Any
    // window-level reach must come from ad_accounts.period_* instead.
    async adSpendDetailed(orgId, since, until) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('ad_metrics')
            .select('id, provider, customer_id, campaign_id, campaign_name, campaign_status, spend_pence, impressions, clicks, conversions, metric_date')
            .eq('organisation_id', orgId)
            .gte('metric_date', since)
            .lt('metric_date', until)
            .order('id', { ascending: true }));
    },
};
