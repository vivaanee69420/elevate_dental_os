// ============================================================================
// Board report repository — Supabase data access for board_report_schedules
// (per-org recurring delivery config, DentaCFO Phase 2). serviceClient bypasses
// RLS, so the explicit .eq('organisation_id', orgId) on EVERY tenant query IS
// the isolation guard on this path (CLAUDE.md rule 3). The worker's cross-org
// due-scan (dueAcrossOrgs) is the one path that intentionally spans orgs — it
// runs in the workers process, never on a tenant request. Queries in, rows out.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const COLS = 'id, organisation_id, frequency, recipient_email, report_type, active, last_sent_at, created_by, created_at';

export const boardReportRepository = {
    async list(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('board_report_schedules')
            .select(COLS)
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data || [];
    },
    async create(orgId, fields, userId) {
        const row = { organisation_id: orgId, ...fields, created_by: userId ?? null };
        const { data, error } = await supabase_1.serviceClient
            .from('board_report_schedules')
            .insert(row)
            .select(COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
    // Partial update (active toggle, recipient, cadence), org-scoped. null when
    // no org-matching row was touched.
    async update(orgId, id, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('board_report_schedules')
            .update(fields)
            .eq('organisation_id', orgId)
            .eq('id', id)
            .select(COLS)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },
    async remove(orgId, id) {
        const { error } = await supabase_1.serviceClient
            .from('board_report_schedules')
            .delete()
            .eq('organisation_id', orgId)
            .eq('id', id);
        if (error) throw new Error(error.message);
    },
    // Worker-only: all active schedules across every org (the cron tick filters
    // them by due-ness in code). No org filter by design — runs in the workers
    // process under serviceClient, never on a tenant request.
    async activeAcrossOrgs() {
        const { data, error } = await supabase_1.serviceClient
            .from('board_report_schedules')
            .select(COLS)
            .eq('active', true);
        if (error) throw new Error(error.message);
        return data || [];
    },
    async markSent(id, sentISO) {
        const { error } = await supabase_1.serviceClient
            .from('board_report_schedules')
            .update({ last_sent_at: sentISO })
            .eq('id', id);
        if (error) throw new Error(error.message);
    },
};

// Pure: is a schedule due to send at `now` given its cadence + last send?
// daily → a different calendar day; weekly → >7d; monthly → >28d. First send
// (no last_sent_at) is always due. Exported for the worker + unit tests.
export function isScheduleDue(frequency, lastSentAt, now = new Date()) {
    if (!lastSentAt) return true;
    const last = new Date(lastSentAt);
    if (Number.isNaN(last.getTime())) return true;
    const ms = now.getTime() - last.getTime();
    if (frequency === 'daily') return now.toISOString().slice(0, 10) !== last.toISOString().slice(0, 10);
    if (frequency === 'weekly') return ms >= 7 * 86400000;
    if (frequency === 'monthly') return ms >= 28 * 86400000;
    return false;
}
