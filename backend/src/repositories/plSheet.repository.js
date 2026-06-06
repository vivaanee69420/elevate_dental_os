// ============================================================================
// P&L sheet repository — Supabase data access for pl_sheets (per-org editable
// scenario/budget spreadsheets, Phase 3 / T13). serviceClient bypasses RLS, so
// the explicit .eq('organisation_id', orgId) on EVERY query IS the tenant guard
// on this path (see CLAUDE.md). Scenario overlay only — never feeds actuals.
// Queries in, rows out.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

const LIMIT_GUARD = 500;
const LIST_COLS = 'id, name, type, updated_at, updated_by';
const FULL_COLS = 'id, name, type, cols, lines, cells, created_at, updated_at, created_by, updated_by';

export const plSheetRepository = {
    // Lightweight list (no cell payload) for the sheet picker.
    async list(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('pl_sheets')
            .select(LIST_COLS)
            .eq('organisation_id', orgId)
            .order('updated_at', { ascending: false })
            .limit(LIMIT_GUARD);
        if (error) throw new Error(error.message);
        return data || [];
    },
    // One full sheet (with grid payload), org-scoped. null when not found.
    async get(orgId, id) {
        const { data, error } = await supabase_1.serviceClient
            .from('pl_sheets')
            .select(FULL_COLS)
            .eq('organisation_id', orgId)
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },
    async create(orgId, fields, userId) {
        const row = {
            organisation_id: orgId,
            ...fields,
            created_by: userId ?? null,
            updated_by: userId ?? null,
        };
        const { data, error } = await supabase_1.serviceClient
            .from('pl_sheets')
            .insert(row)
            .select(FULL_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
    // Partial update of name/type/cols/lines/cells, org-scoped. Returns the
    // updated row, or null when no org-matching row was touched.
    async update(orgId, id, fields, userId) {
        const { data, error } = await supabase_1.serviceClient
            .from('pl_sheets')
            .update({ ...fields, updated_by: userId ?? null })
            .eq('organisation_id', orgId)
            .eq('id', id)
            .select(FULL_COLS)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    },
    async remove(orgId, id) {
        const { error } = await supabase_1.serviceClient
            .from('pl_sheets')
            .delete()
            .eq('organisation_id', orgId)
            .eq('id', id);
        if (error) throw new Error(error.message);
    },
};
