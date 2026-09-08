// ============================================================================
// Lead repository — all Supabase data access for the leads domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { crmHidden } from "../lib/integration-gating.js";

const EXPORT_PAGE = 1000; // PostgREST hard cap per request

export const leadRepository = {
    async list(orgId, q) {
        if (await crmHidden(orgId)) return [];
        let query = supabase_1.serviceClient
            .from('leads')
            .select(`
        *,
        contact:contacts(id, first_name, last_name, email, phone),
        practice:practices(id, name),
        assignee:users!leads_assigned_to_fkey(id, full_name, email)
      `)
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false })
            .limit(q.limit);
        if (q.status)
            query = query.eq('status', q.status);
        if (q.practice_id)
            query = query.eq('practice_id', q.practice_id);
        if (q.integration_account_id)
            query = query.eq('integration_account_id', q.integration_account_id);
        if (q.assigned_to)
            query = query.eq('assigned_to', q.assigned_to);
        if (q.ghl_pipeline_id)
            query = query.eq('ghl_pipeline_id', q.ghl_pipeline_id);
        if (q.since)
            query = query.gte('created_at', q.since);
        // INCLUSIVE of the end date. The caller sends the instant that ends
        // the window (the London end-of-day), so this is `lte`, matching the
        // aggregate's `<=` — a board whose cards used a half-open window while
        // its column counts used a closed one would disagree on the last day
        // of every range, silently.
        if (q.until)
            query = query.lte('created_at', q.until);
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        return data;
    },
    // CSV export — ALL matching leads, paged past PostgREST's 1000-row cap.
    //
    // `list()` above is the trap: it takes a caller-chosen `limit` and hands
    // back ONE page. An export must never do that — a pipeline holding more
    // than one page would silently lose the tail with no error, which reads
    // as a complete file. So this pages by `.range()` until a SHORT page
    // (fewer than EXPORT_PAGE rows) proves there is nothing left, ordered by
    // `id` (unique) so a page boundary can never skip or duplicate a row the
    // way ordering by a non-unique column could.
    //
    // `onBatch` receives each page's rows as they arrive so the controller can
    // stream them straight to the response instead of buffering the whole
    // export in memory. Returns `{ rows, reads }` — `reads` is the number of
    // `.range()` requests actually issued, which is what a test should assert
    // to prove paging happened (a single-page org would report rows correctly
    // even with a page-blind bug; `reads` cannot).
    async exportBatches(orgId, q, onBatch) {
        if (await crmHidden(orgId))
            return { rows: 0, reads: 0 };
        let offset = 0;
        let rows = 0;
        let reads = 0;
        for (;;) {
            let query = supabase_1.serviceClient
                .from('leads')
                .select(`
          id, created_at, status, treatment, estimated_value_pence,
          source, utm_source, utm_medium, utm_campaign,
          ghl_pipeline_id, ghl_pipeline_stage_id, ghl_stage_name,
          contact:contacts(first_name, last_name, email, phone),
          practice:practices(name),
          assignee:users!leads_assigned_to_fkey(full_name, email)
        `)
                .eq('organisation_id', orgId)
                .order('id', { ascending: true })
                .range(offset, offset + EXPORT_PAGE - 1);
            if (q.status)
                query = query.eq('status', q.status);
            if (q.practice_id)
                query = query.eq('practice_id', q.practice_id);
            if (q.integration_account_id)
                query = query.eq('integration_account_id', q.integration_account_id);
            if (q.assigned_to)
                query = query.eq('assigned_to', q.assigned_to);
            if (q.ghl_pipeline_id)
                query = query.eq('ghl_pipeline_id', q.ghl_pipeline_id);
            if (q.since)
                query = query.gte('created_at', q.since);
            // The export must carry the SAME window as the board it was
            // launched from. Accepting `until` in the schema but not applying
            // it here would hand back rows the screen never showed — a CSV
            // that quietly disagrees with the page that produced it.
            if (q.until)
                query = query.lte('created_at', q.until);
            const { data, error } = await query;
            reads += 1;
            if (error)
                throw new Error(error.message);
            const batch = data ?? [];
            if (batch.length) {
                onBatch(batch);
                rows += batch.length;
            }
            if (batch.length < EXPORT_PAGE)
                break;
            offset += EXPORT_PAGE;
        }
        return { rows, reads };
    },
    async getById(orgId, id) {
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select(`*, contact:contacts(*), communications:communications(*), tasks:tasks(*)`)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .single();
        return { data, error };
    },
    async createContact(orgId, practiceId, contact) {
        return supabase_1.serviceClient
            .from('contacts')
            .insert({ organisation_id: orgId, practice_id: practiceId, type: 'lead', ...contact })
            .select('id')
            .single();
    },
    async create(row) {
        return supabase_1.serviceClient.from('leads').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('leads')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
    async softDelete(orgId, id) {
        return supabase_1.serviceClient
            .from('leads')
            .update({ status: 'not_proceeding' })
            .eq('id', id)
            .eq('organisation_id', orgId);
    },
    // Lead count + value per GHL pipeline. RPC-aggregated, never a plain select:
    // an org can hold tens of thousands of leads and PostgREST caps reads at
    // 1000 rows, which would silently under-count. accountId null = all.
    async pipelineCounts(orgId, accountId = null) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('lead_pipeline_counts', { p_org: orgId, p_account: accountId });
        if (error)
            throw new Error(error.message);
        return data ?? [];
    },
    // Per-stage counts and value for ONE pipeline, aggregated in SQL.
    //
    // The board used to reduce over a `limit: 500` page of leads, so every
    // column header and the board total were computed from at most the newest
    // 500 rows. Measured on live data: pipeline r2preQuq… holds 2,092 leads
    // worth £1,421,317 and rendered "500 leads · £0.00", because every valued
    // lead in it was older than that page. One row per stage (a pipeline has
    // a handful) cannot be capped, however many leads accumulate.
    async pipelineStageSummary(orgId, pipelineId, accountId = null, since = null, until = null) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('crm_pipeline_stage_summary', {
                p_org: orgId, p_pipeline: pipelineId, p_account: accountId,
                p_since: since, p_until: until,
            });
        if (error)
            throw new Error(error.message);
        return data ?? [];
    },
    // The four Today counters in one round trip. `since` is an ISO instant or
    // null for all-time; it is passed in rather than derived here so the
    // counter and the list beneath it cannot disagree about the window.
    // One page of enquiries plus the full matching count, and the open-enquiry
    // headline figures. Both aggregate in SQL — the screen they replace was
    // built entirely on a hardcoded array of invented patients.
    async enquiries(orgId, q = {}) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('crm_enquiries', {
                p_org: orgId,
                p_account: q.integration_account_id ?? null,
                p_search: q.search ?? null,
                p_stage: q.stage ?? null,
                p_valued_only: q.valued_only ?? false,
                p_open_only: q.open_only ?? true,
                p_limit: q.limit ?? 50,
                p_offset: q.offset ?? 0,
            });
        if (error) throw new Error(error.message);
        return data ?? [];
    },
    async enquiriesSummary(orgId, accountId = null) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('crm_enquiries_summary', { p_org: orgId, p_account: accountId });
        if (error) throw new Error(error.message);
        return data?.[0] ?? null;
    },
    async todayCounters(orgId, since = null, accountId = null) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('crm_today_counters', {
                p_org: orgId, p_since: since, p_account: accountId,
            });
        if (error)
            throw new Error(error.message);
        return data?.[0] ?? null;
    },
    // Per-status lead counts for a window, aggregated IN SQL.
    //
    // This replaced a `.select('status, estimated_value_pence')` over the whole
    // table with no .limit(), which PostgREST silently capped at 1000 rows —
    // so on any org past 1000 leads the funnel was computed from an arbitrary
    // subset. An aggregate that returns one row per status (9 max) cannot be
    // capped, however many leads the tenant accumulates.
    // Every CRM Reports figure, aggregated IN SQL in one round trip: headline
    // totals plus the by-source and by-practice groupings. Replaces counting a
    // `limit: 1000` page of leads in the browser — 1000 is exactly PostgREST's
    // cap, so that bound was a ceiling dressed as a choice, and on 22,807 leads
    // it made "Leads received" read 1,000.
    async reportAggregate(orgId, { since = null, until = null, practiceId = null, accountId = null } = {}) {
        if (await crmHidden(orgId)) return [];
        const { data, error } = await supabase_1.serviceClient.rpc('lead_report_aggregate', {
            p_org: orgId,
            p_since: since ?? null,
            p_until: until ?? null,
            p_practice: practiceId ?? null,
            p_account: accountId ?? null,
        });
        if (error)
            throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
    async funnelCounts(orgId, { since = null, until = null, practiceId = null } = {}) {
        if (await crmHidden(orgId)) return [];
        const { data, error } = await supabase_1.serviceClient.rpc('lead_funnel_counts', {
            p_org: orgId,
            p_since: since ?? null,
            p_until: until ?? null,
            p_practice: practiceId ?? null,
        });
        if (error)
            throw new Error(error.message);
        return Array.isArray(data) ? data : [];
    },
};
