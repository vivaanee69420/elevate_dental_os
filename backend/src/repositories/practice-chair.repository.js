// ============================================================================
// Chairs (surgeries) per practice. serviceClient bypasses RLS, so the explicit
// .eq('organisation_id', orgId) on every query IS the tenant isolation.
//
// These rows replace `DISTINCT chair_name` as the chair count. A rename now
// keeps the chair's history, and a stray space can no longer invent a second
// chair and double the practice's capacity.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { pageAll } from "../lib/paged-select.js";

const COLS = 'id, organisation_id, practice_id, name, display_order, active';

export const practiceChairRepository = {
    async listForPractice(orgId, practiceId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practice_chairs')
            .select(COLS)
            .eq('organisation_id', orgId)
            .eq('practice_id', practiceId)
            .order('display_order', { ascending: true })
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // Whole-org read for the analytics rollup. Paged: a 50-chair group is
    // already 1,400 grid rows, and this table grows with it.
    listAll(orgId) {
        return pageAll(() => supabase_1.serviceClient
            .from('practice_chairs')
            .select(COLS)
            .eq('organisation_id', orgId));
    },

    async create(orgId, input) {
        // The organisation is the caller's, never the payload's.
        const row = {
            practice_id: input.practice_id,
            name: input.name,
            display_order: input.display_order ?? 0,
            organisation_id: orgId,
        };
        return supabase_1.serviceClient.from('practice_chairs').insert(row).select(COLS).single();
    },

    update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('practice_chairs')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select(COLS)
            .maybeSingle();
    },

    remove(orgId, id) {
        return supabase_1.serviceClient
            .from('practice_chairs')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select('id, practice_id')
            .maybeSingle();
    },
};
