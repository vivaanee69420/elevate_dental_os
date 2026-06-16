// ============================================================================
// Treatment-accepted repository — Supabase data access for Emergent-sourced
// "treatment accepted" records. See treatmentaccepted.md.
//
// Tenant isolation: serviceClient path, so EVERY query carries an explicit
// .eq('organisation_id', orgId) (rule 3). Money is integer pence. `raw` (the
// full original payload) is never selected on list endpoints.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const SAFE_COLS =
  'id, organisation_id, source, external_id, business_id, patient_name, patient_external_id, ' +
  'contact_id, practice_id, practitioner_name, associate_id, treatment_name, ' +
  'value_pence, accepted_date, status, created_at, updated_at';

export const treatmentAcceptedRepository = {
    // Idempotent upsert on (organisation_id, source, external_id) — webhook and
    // scheduled pull can't double-count. `row` must already carry organisation_id.
    async upsert(row) {
        const { data, error } = await supabase_1.serviceClient
            .from('treatment_accepted')
            .upsert(row, { onConflict: 'organisation_id,source,external_id' })
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
    async listByOrg(orgId, { since = null, until = null, practiceId = null, limit = 500 } = {}) {
        let q = supabase_1.serviceClient
            .from('treatment_accepted')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .order('accepted_date', { ascending: false })
            .limit(limit);
        if (since) q = q.gte('accepted_date', since);
        if (until) q = q.lte('accepted_date', until);
        if (practiceId) q = q.eq('practice_id', practiceId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
    },
    // Totals via the aggregate RPC (no row cap), scoped to practice + window.
    async aggregate(orgId, { since = null, until = null, practiceId = null } = {}) {
        const { data, error } = await supabase_1.serviceClient.rpc('treatment_accepted_aggregate', {
            p_org: orgId, p_since: since ?? null, p_until: until ?? null, p_practice: practiceId ?? null,
        });
        if (error) throw new Error(error.message);
        const r = (Array.isArray(data) ? data[0] : data) || {};
        return { count: Number(r.accepted_count || 0), value_pence: Number(r.accepted_value_pence || 0) };
    },

    // Hard-delete one record by its derived external_id (treatment.deleted
    // webhook). Org-scoped (rule 3). Returns the number of rows removed.
    async deleteByExternalId(orgId, source, externalId) {
        const { data, error } = await supabase_1.serviceClient
            .from('treatment_accepted')
            .delete()
            .eq('organisation_id', orgId)
            .eq('source', source)
            .eq('external_id', externalId)
            .select('id');
        if (error) throw new Error(error.message);
        return data?.length ?? 0;
    },

    // Re-stamp practice_id on every existing row for one Emergent business
    // (called when an owner changes the mapping). Org-scoped (rule 3). Returns
    // the number of rows updated.
    async restampPractice(orgId, businessId, practiceId) {
        const { data, error } = await supabase_1.serviceClient
            .from('treatment_accepted')
            .update({ practice_id: practiceId ?? null })
            .eq('organisation_id', orgId)
            .eq('business_id', String(businessId))
            .select('id');
        if (error) throw new Error(error.message);
        return data?.length ?? 0;
    },
};
