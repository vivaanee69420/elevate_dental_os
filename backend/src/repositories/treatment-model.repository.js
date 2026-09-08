// ============================================================================
// treatment_models — queries in, rows out. No logic (see CLAUDE.md layering).
//
// MULTI-TENANT: every method takes an orgId and chains .eq('organisation_id').
// These run on serviceClient, which BYPASSES RLS, so that explicit filter is
// the isolation — not a belt-and-braces extra. A method added here without one
// is a cross-tenant read.
//
// The org on a WRITE comes from the caller, never from the payload. A record
// that can name its own tenant is a cross-org write waiting to happen; the
// service strips it and passes orgId separately for exactly that reason.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// Every column, named. `select('*')` on a tenant table is the pattern the
// isolation audit flagged: it silently picks up whatever a later migration adds.
const COLS = `id, organisation_id, key, label, unit,
  price_pence, cbct_pence, utilities_pence, surgery_run_cost_pence, lab_bill_pence,
  marketing_pct, lab_margin_pct, dentist_pct, target_margin_pct,
  surgeries, cases_per_surgery, implants_per_patient,
  components, is_custom, created_at, updated_at`;

export const treatmentModelRepository = {
    /** Every saved model for one organisation. Small by nature — a handful of rows. */
    async listForOrg(orgId) {
        if (!orgId) throw new Error('treatmentModelRepository.listForOrg: orgId required');
        const { data, error } = await supabase_1.serviceClient
            .from('treatment_models')
            .select(COLS)
            .eq('organisation_id', orgId)
            .order('key');
        if (error) throw new Error(error.message);
        return data || [];
    },

    /**
     * Create or replace one model. `patch` is already snake_cased and validated
     * by the service; orgId and key are applied HERE so neither can arrive from
     * a request body.
     */
    async upsert(orgId, key, patch) {
        if (!orgId) throw new Error('treatmentModelRepository.upsert: orgId required');
        if (!key) throw new Error('treatmentModelRepository.upsert: key required');
        const { data, error } = await supabase_1.serviceClient
            .from('treatment_models')
            .upsert({ ...patch, organisation_id: orgId, key }, { onConflict: 'organisation_id,key' })
            .select(COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    /**
     * Remove one model. For a built-in key this restores the default (there is
     * no row left to override it); for a custom one it removes the treatment.
     * Returns nothing — a delete of an absent row is not an error, because the
     * caller's intent ("this org should have no override") is already true.
     */
    async remove(orgId, key) {
        if (!orgId) throw new Error('treatmentModelRepository.remove: orgId required');
        const { error } = await supabase_1.serviceClient
            .from('treatment_models')
            .delete()
            .eq('organisation_id', orgId)
            .eq('key', key);
        if (error) throw new Error(error.message);
    },
};
