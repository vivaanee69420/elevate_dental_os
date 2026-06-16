// ============================================================================
// Emergent practice-map repository — explicit Emergent business_id -> practice
// mapping. Tenant isolation: serviceClient path, so EVERY query carries an
// explicit .eq('organisation_id', orgId) (rule 3).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const emergentPracticeMapRepository = {
    // All mapped businesses for an org, with the practice name embedded for the
    // UI. practice_id may be null (discovered-but-unmapped, or intentionally
    // unmapped). Ordered by business_name for a stable list.
    async list(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .select('business_id, business_name, practice_id, practices(name)')
            .eq('organisation_id', orgId)
            .order('business_name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
            business_id: r.business_id,
            business_name: r.business_name,
            practice_id: r.practice_id,
            practice_name: r.practices?.name ?? null,
        }));
    },

    // Insert any businesses we have not seen before. NEVER clobbers an existing
    // row (ignoreDuplicates) so a discovered business keeps its owner-set
    // practice_id. `businesses` = [{ business_id, business_name }].
    async discover(orgId, businesses) {
        const seen = new Map();
        for (const b of businesses ?? []) {
            const id = b?.business_id;
            if (id == null || String(id).trim() === '') continue;
            if (!seen.has(id)) seen.set(id, b.business_name ?? null);
        }
        if (seen.size === 0) return;
        const rows = [...seen.entries()].map(([business_id, business_name]) => ({
            organisation_id: orgId, business_id: String(business_id), business_name,
        }));
        const { error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .upsert(rows, { onConflict: 'organisation_id,business_id', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
    },

    // Set (or clear) the practice for one business. Upserts the row so it works
    // even if discovery has not run yet. practiceId null = intentionally unmapped.
    async setMapping(orgId, businessId, businessName, practiceId) {
        const row = {
            organisation_id: orgId,
            business_id: String(businessId),
            practice_id: practiceId ?? null,
            updated_at: new Date().toISOString(),
        };
        if (businessName != null) row.business_name = businessName;
        const { error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .upsert(row, { onConflict: 'organisation_id,business_id' });
        if (error) throw new Error(error.message);
    },

    // The org's practices, as dropdown options for the mapping UI.
    async practiceOptions(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('practices')
            .select('id, name')
            .eq('organisation_id', orgId)
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((p) => ({ id: p.id, name: p.name }));
    },

    // Resolution map for the connector: business_id -> practice_id (value may be
    // null = explicit unmapped). The KEY's presence means "explicit row exists".
    async resolutionMap(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .select('business_id, practice_id')
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        const m = new Map();
        for (const r of data ?? []) m.set(String(r.business_id), r.practice_id ?? null);
        return m;
    },
};
