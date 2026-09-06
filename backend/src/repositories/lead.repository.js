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
