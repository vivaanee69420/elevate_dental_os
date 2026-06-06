// ============================================================================
// Chair config repository — Supabase data access for chair_config (per-org
// surgery-capacity assumptions, Phase 3 / T12). One row per org. serviceClient
// bypasses RLS, so the explicit .eq('organisation_id', orgId) IS the tenant
// guard on this path (see CLAUDE.md). Queries in, rows out.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const COLS = 'id, open_hrs, weeks_yr, days_wk, bench_occ_pct, bench_rev_hr_pence, ' +
    'updated_at, updated_by';

export const chairConfigRepository = {
    // The saved row for an org, or null when never configured (callers fall
    // back to the lib/formulas.js CHAIR_CONFIG code defaults).
    async get(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('chair_config')
            .select(COLS)
            .eq('organisation_id', orgId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },
    // Upsert the single per-org row (UNIQUE organisation_id).
    async upsert(orgId, fields, userId) {
        const row = { organisation_id: orgId, ...fields, updated_by: userId ?? null };
        const { error } = await supabase_1.serviceClient
            .from('chair_config')
            .upsert(row, { onConflict: 'organisation_id' });
        if (error) throw new Error(error.message);
        return row;
    },
};
