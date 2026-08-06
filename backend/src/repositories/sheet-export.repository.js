// ============================================================================
// Sheet export queue repository — GHL→Dentally conversion export outbox.
// Tenant isolation: serviceClient path, so EVERY query carries an explicit
// .eq('organisation_id', orgId) (rule 3) with ONE deliberate exception:
// orgsWithWriter() is a worker-only fan-out read (selects organisation_id
// only, no secrets). "Queries in, rows out" — no business logic here beyond
// markRetry's attempts/backoff branch (spec-mandated, see task brief).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { WRITER_PROVIDER_ID } from "../lib/integrations/google-sheets-writer-provider.js";

// Escape ilike special chars (%, _, \) so an equality-style ilike (no
// wildcards added) still matches literally and case-insensitively.
function escapeIlike(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export const sheetExportRepository = {
    async enqueue(orgId, sinceIso) {
        const { data, error } = await supabase_1.serviceClient.rpc('sheet_export_enqueue', {
            p_org: orgId,
            p_since: sinceIso,
        });
        if (error) throw new Error(error.message);
        return data ?? 0;
    },

    async claim(orgId, { limit = 50, includeNoMatch = false, ignoreBackoff = false } = {}) {
        const { data, error } = await supabase_1.serviceClient.rpc('sheet_export_claim', {
            p_org: orgId,
            p_limit: limit,
            p_include_no_match: includeNoMatch,
            p_ignore_backoff: ignoreBackoff,
        });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async markExported(orgId, ids) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_export_queue')
            .update({
                status: 'exported',
                exported_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('organisation_id', orgId)
            .in('id', ids);
        if (error) throw new Error(error.message);
    },

    // Terminal exclusion (e.g. telephone consultations): never written to the
    // sheet, never revisited — distinct from no_match's 30-day retry window.
    async markSkipped(orgId, id, reason) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_export_queue')
            .update({
                status: 'skipped',
                last_error: reason ?? null,
                updated_at: new Date().toISOString(),
            })
            .eq('organisation_id', orgId)
            .eq('id', id);
        if (error) throw new Error(error.message);
    },

    async markNoMatch(orgId, id, reason) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_export_queue')
            .update({
                status: 'no_match',
                last_error: reason ?? null,
                updated_at: new Date().toISOString(),
            })
            .eq('organisation_id', orgId)
            .eq('id', id);
        if (error) throw new Error(error.message);
    },

    async markRetry(orgId, id, message) {
        const { data } = await supabase_1.serviceClient
            .from('sheet_export_queue')
            .select('attempts')
            .eq('organisation_id', orgId)
            .eq('id', id)
            .maybeSingle();
        const attempts = (data?.attempts ?? 0) + 1;
        const status = attempts >= 10 ? 'failed' : 'pending';
        await supabase_1.serviceClient
            .from('sheet_export_queue')
            .update({
                status,
                attempts,
                last_error: String(message ?? '').slice(0, 500),
                updated_at: new Date().toISOString(),
            })
            .eq('organisation_id', orgId)
            .eq('id', id);
        return { status, attempts };
    },

    async counts(orgId) {
        const statuses = ['pending', 'processing', 'exported', 'no_match', 'failed', 'skipped'];
        const result = {};
        for (const status of statuses) {
            const { count, error } = await supabase_1.serviceClient
                .from('sheet_export_queue')
                .select('id', { count: 'exact', head: true })
                .eq('organisation_id', orgId)
                .eq('status', status);
            if (error) throw new Error(error.message);
            result[status] = count || 0;
        }
        return result;
    },

    async getContact(orgId, contactId) {
        const { data, error } = await supabase_1.serviceClient
            .from('contacts')
            .select('id, first_name, last_name, email, phone, pms_external_id')
            .eq('organisation_id', orgId)
            .eq('id', contactId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data ?? null;
    },

    // Last-24h queue activity for the panel's "View activity" modal. Patient
    // name + practice resolved via PostgREST FK embedding; no PII beyond what
    // the owner/PM already sees on every CRM screen, and never any secrets.
    async recentActivity(orgId, sinceIso, limit = 100) {
        const { data, error } = await supabase_1.serviceClient
            .from('sheet_export_queue')
            .select('id, status, last_error, appointment_starts_at, updated_at, created_at, contacts:contact_id(first_name, last_name), practices:practice_id(name)')
            .eq('organisation_id', orgId)
            .gte('updated_at', sinceIso)
            .order('updated_at', { ascending: false })
            .limit(limit);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // Treatment for the sheet's Treatment column — the Dentally appointment's
    // type/reason free text. Null-safe: a missing appointment reads as null.
    async appointmentType(orgId, appointmentId) {
        if (!appointmentId) return null;
        const { data, error } = await supabase_1.serviceClient
            .from('appointments')
            .select('appointment_type')
            .eq('organisation_id', orgId)
            .eq('id', appointmentId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data?.appointment_type ?? null;
    },

    async ghlCandidatesByEmail(orgId, email) {
        const { data, error } = await supabase_1.serviceClient
            .from('contacts')
            .select('*')
            .eq('organisation_id', orgId)
            .not('ghl_contact_id', 'is', null)
            .ilike('email', escapeIlike(email));
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async ghlCandidatesByPhone(orgId, suffix9) {
        const { data, error } = await supabase_1.serviceClient.rpc('sheet_export_phone_candidates', {
            p_org: orgId,
            p_digits: suffix9,
        });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async pipelineLeads(orgId, contactIds) {
        const { data, error } = await supabase_1.serviceClient
            .from('leads')
            .select('id, contact_id, ghl_pipeline_id, integration_account_id, created_at')
            .eq('organisation_id', orgId)
            .not('ghl_pipeline_id', 'is', null)
            .in('contact_id', contactIds)
            .order('created_at', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async practices(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async recordMatch(orgId, id, matchedContactId, matchedLeadId) {
        const { error } = await supabase_1.serviceClient
            .from('sheet_export_queue')
            .update({
                matched_contact_id: matchedContactId,
                matched_lead_id: matchedLeadId,
                updated_at: new Date().toISOString(),
            })
            .eq('organisation_id', orgId)
            .eq('id', id);
        if (error) throw new Error(error.message);
    },

    // Worker-only fan-out: which orgs have an active google_sheets_writer
    // connection. Deliberately NOT org-scoped (rule 3 exception, documented
    // above) — selects organisation_id only, no secrets.
    async orgsWithWriter() {
        const { data, error } = await supabase_1.serviceClient
            .from('integrations')
            .select('organisation_id')
            .eq('provider', WRITER_PROVIDER_ID)
            .neq('status', 'revoked');
        if (error) throw new Error(error.message);
        return [...new Set((data ?? []).map((r) => r.organisation_id))];
    },
};
