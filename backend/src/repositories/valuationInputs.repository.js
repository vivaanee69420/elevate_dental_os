// ============================================================================
// Valuation inputs repository — Supabase data access for valuation_inputs
// (per-org persisted valuation drivers, Phase 3 / T12). One row per org.
// serviceClient bypasses RLS, so the explicit .eq('organisation_id', orgId) IS
// the tenant guard on this path (see CLAUDE.md). Queries in, rows out.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const COLS = 'id, reported_ebitda_pence, addbacks_pence, principal_salary_pence, ' +
    'principal_multiple, associate_multiple, dso_multiple, region_factor, ' +
    'growth_rate_pct, ui_state, updated_at, updated_by';

export const valuationInputsRepository = {
    // The saved row for an org, or null when never configured.
    async get(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('valuation_inputs')
            .select(COLS)
            .eq('organisation_id', orgId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },
    // Upsert the single per-org row (UNIQUE organisation_id). fields are the
    // already-validated numeric drivers; userId stamps updated_by.
    async upsert(orgId, fields, userId) {
        const row = { organisation_id: orgId, ...fields, updated_by: userId ?? null };
        const { error } = await supabase_1.serviceClient
            .from('valuation_inputs')
            .upsert(row, { onConflict: 'organisation_id' });
        if (error) throw new Error(error.message);
        return row;
    },
};
