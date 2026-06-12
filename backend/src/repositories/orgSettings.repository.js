// ============================================================================
// Org settings repository — Supabase data access for org_settings (one row per
// org; cross-cutting owner toggles, starting with turnover_source). serviceClient
// bypasses RLS, so the explicit .eq('organisation_id', orgId) IS the tenant guard
// on this path (see CLAUDE.md). Queries in, rows out.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const COLS = 'turnover_source, updated_at, updated_by';

export const orgSettingsRepository = {
    // The saved row for an org, or null when never configured.
    async get(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('org_settings')
            .select(COLS)
            .eq('organisation_id', orgId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },
    // Upsert the single per-org row (PK organisation_id). userId stamps updated_by.
    async upsert(orgId, fields, userId) {
        const row = { organisation_id: orgId, ...fields, updated_by: userId ?? null };
        const { error } = await supabase_1.serviceClient
            .from('org_settings')
            .upsert(row, { onConflict: 'organisation_id' });
        if (error) throw new Error(error.message);
        return row;
    },
};
