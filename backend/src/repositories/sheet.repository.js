// ============================================================================
// Sheet repository — Call Reporting (Google Sheets) data access.
// Tenant isolation: serviceClient path, so EVERY query carries an explicit
// .eq('organisation_id', orgId) (rule 3). No secrets live in these tables —
// OAuth tokens stay encrypted on the integrations row. Row values are never
// logged here or by callers (counts/status only).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const PAGE = 1000; // PostgREST db-max-rows — any larger read MUST paginate

export const sheetRepository = {
    // ---- sheet_sources ----------------------------------------------------
    async getSource(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .select('*')
            .eq('organisation_id', orgId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data ?? null;
    },

    async createSource(orgId, { spreadsheet_id, spreadsheet_url, title, sheet_timezone }) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .upsert({
                organisation_id: orgId,
                spreadsheet_id,
                spreadsheet_url: spreadsheet_url ?? null,
                title: title ?? null,
                sheet_timezone: sheet_timezone ?? null,
                status: 'pending',
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id' })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async updateSource(orgId, patch) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_sources')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
    },

    async deleteSource(orgId) {
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

    // ---- sheet_practice_map ------------------------------------------------
    async listPracticeMap(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_practice_map')
            .select('sheet_value, practice_id, practices(name)')
            .eq('organisation_id', orgId)
            .order('sheet_value', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
            sheet_value: r.sheet_value,
            practice_id: r.practice_id,
            practice_name: r.practices?.name ?? null,
        }));
    },

    // Insert unseen sheet practice values. NEVER clobbers an existing row
    // (ignoreDuplicates) so a discovered value keeps its owner-set practice_id.
    async discoverPracticeValues(orgId, values) {
        const seen = new Set();
        const rows = [];
        for (const v of values ?? []) {
            const val = String(v ?? '').trim();
            if (!val || seen.has(val.toLowerCase())) continue;
            seen.add(val.toLowerCase());
            rows.push({ organisation_id: orgId, sheet_value: val });
        }
        if (rows.length === 0) return;
        const { error } = await supabase_1.serviceClient
            .from('sheet_practice_map')
            .upsert(rows, { onConflict: 'organisation_id,sheet_value', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
    },

    async setPracticeMapping(orgId, sheetValue, practiceId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_practice_map')
            .upsert({
                organisation_id: orgId,
                sheet_value: String(sheetValue).trim(),
                practice_id: practiceId ?? null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id,sheet_value' });
        if (error) throw new Error(error.message);
    },

    async deletePracticeMap(orgId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_practice_map')
            .delete()
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
    },

    // lower(trim(sheet_value)) -> practice_id|null. Key presence = explicit row.
    async practiceResolutionMap(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_practice_map')
            .select('sheet_value, practice_id')
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        const map = new Map();
        for (const r of data ?? []) {
            map.set(String(r.sheet_value).trim().toLowerCase(), r.practice_id ?? null);
        }
        return map;
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
            practice_id: r.practice_id ?? null,
            practice_value: r.practice_value ?? null,
            created_at: r.created_at,
            first_call_at: r.first_call_at ?? null,
            lead_source: r.lead_source ?? null,
            pipeline_status: r.pipeline_status ?? null,
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

    async deleteAllLeads(orgId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_leads')
            .delete()
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
    },

    // ---- aggregates ---------------------------------------------------------
    async dashboard(orgId, { date, practiceId = null, tz = 'Europe/London' }) {
        const { data, error } = await supabase_1.serviceClient.rpc('sheet_leads_dashboard', {
            p_org: orgId,
            p_date: date,
            p_practice: practiceId,
            p_tz: tz,
        });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return row ?? null;
    },

    async restampPractices(orgId) {
        const { data, error } = await supabase_1.serviceClient.rpc('restamp_sheet_lead_practices', {
            p_org: orgId,
        });
        if (error) throw new Error(error.message);
        return data ?? 0;
    },
};
