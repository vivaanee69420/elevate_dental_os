// ============================================================================
// Sheet repository — Call Reporting (Google Sheets) data access.
// Tenant isolation: serviceClient path, so EVERY query carries an explicit
// .eq('organisation_id', orgId) (rule 3). Multi-sheet v2: N sheet_sources per
// org (one per practice, keyed by practice_label), so per-source methods also
// scope by source id. No secrets live in these tables — OAuth tokens stay
// encrypted on the integrations row. Row values are never logged here or by
// callers (counts/status only).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const PAGE = 1000; // PostgREST db-max-rows — any larger read MUST paginate

export const sheetRepository = {
    // ---- sheet_sources (one per practice, N per org) -----------------------
    async listSources(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .select('*')
            .eq('organisation_id', orgId)
            .order('practice_label', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async getSourceById(orgId, sourceId) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('id', sourceId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data ?? null;
    },

    async createSource(orgId, { spreadsheet_id, spreadsheet_url, title, sheet_timezone, practice_label }) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .upsert({
                organisation_id: orgId,
                spreadsheet_id,
                spreadsheet_url: spreadsheet_url ?? null,
                title: title ?? null,
                sheet_timezone: sheet_timezone ?? null,
                practice_label: practice_label ?? null,
                status: 'pending',
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id,spreadsheet_id' })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async updateSource(orgId, sourceId, patch) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('organisation_id', orgId)
            .eq('id', sourceId);
        if (error) throw new Error(error.message);
    },

    async deleteSource(orgId, sourceId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .delete()
            .eq('organisation_id', orgId)
            .eq('id', sourceId);
        if (error) throw new Error(error.message);
    },

    async deleteAllSources(orgId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .delete()
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
    },

    // Worker fan-out: every source with a saved mapping, INCLUDING status
    // 'failed' (a transient failure must not freeze a source out of retries).
    async listConfiguredSources() {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .select('id, organisation_id, status')
            .not('column_mapping', 'is', null);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // ---- sheet_leads --------------------------------------------------------
    // sheet_row_index -> row_hash for the diff. Paginated with .range():
    // PostgREST silently caps un-ranged reads at 1000 rows (the
    // monthly_financials undercount lesson) and this table is expected to
    // grow far beyond that.
    async leadHashesBySource(orgId, sourceId) {
        const map = new Map();
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase_1.serviceClient
                .from('sheet_leads')
                .select('sheet_row_index, row_hash')
                .eq('organisation_id', orgId)
                .eq('source_id', sourceId)
                .order('sheet_row_index', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            for (const r of data ?? []) map.set(r.sheet_row_index, r.row_hash);
            if (!data || data.length < PAGE) break;
        }
        return map;
    },

    async upsertLeads(orgId, sourceId, rows) {
        if (!rows?.length) return;
        const now = new Date().toISOString();
        const payload = rows.map((r) => ({
            organisation_id: orgId,
            source_id: sourceId,
            created_at: r.created_at,
            called_3m: r.called_3m ?? false,
            called_10m: r.called_10m ?? false,
            pipeline_name: r.pipeline_name ?? null,
            sheet_row_index: r.sheet_row_index,
            row_hash: r.row_hash,
            synced_at: now,
        }));
        const { error } = await supabase_1.serviceClient
            .from('sheet_leads')
            .upsert(payload, { onConflict: 'source_id,sheet_row_index' });
        if (error) throw new Error(error.message);
    },

    async deleteLeadsBeyondRow(orgId, sourceId, lastRow) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_leads')
            .delete()
            .eq('organisation_id', orgId)
            .eq('source_id', sourceId)
            .gt('sheet_row_index', lastRow)
            .select('id');
        if (error) throw new Error(error.message);
        return data?.length ?? 0;
    },

    async deleteLeadsBySource(orgId, sourceId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_leads')
            .delete()
            .eq('organisation_id', orgId)
            .eq('source_id', sourceId);
        if (error) throw new Error(error.message);
    },

    async deleteAllLeads(orgId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_leads')
            .delete()
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
    },

    // ---- aggregates ---------------------------------------------------------
    async dashboard(orgId, { date, sourceId = null, tz = 'Europe/London' }) {
        const { data, error } = await supabase_1.serviceClient.rpc('sheet_leads_dashboard', {
            p_org: orgId,
            p_date: date,
            p_source: sourceId,
            p_tz: tz,
        });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return row ?? null;
    },
};
