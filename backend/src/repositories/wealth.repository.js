// ============================================================================
// Wealth inputs repository — Supabase data access for wealth_inputs (per-org
// persisted personal balance sheet + FIRE/sale assumptions, DentaCFO Phase 4).
// One row per org. serviceClient bypasses RLS, so the explicit
// .eq('organisation_id', orgId) IS the tenant guard on this path (see
// CLAUDE.md). Queries in, rows out — no logic.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const COLS = 'id, assets, liabilities, pensions, properties, fire, sale, updated_at, updated_by';

export const wealthRepository = {
    // The saved row for an org, or null when never configured.
    async get(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('wealth_inputs')
            .select(COLS)
            .eq('organisation_id', orgId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },
    // Upsert the single per-org row (UNIQUE organisation_id). fields are the
    // already-validated JSONB sections; userId stamps updated_by.
    async upsert(orgId, fields, userId) {
        const row = { organisation_id: orgId, ...fields, updated_by: userId ?? null };
        const { error } = await supabase_1.serviceClient
            .from('wealth_inputs')
            .upsert(row, { onConflict: 'organisation_id' });
        if (error) throw new Error(error.message);
        return row;
    },
};
