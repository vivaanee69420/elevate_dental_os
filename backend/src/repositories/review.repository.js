// ============================================================================
// Review repository — all Supabase data access for the reviews domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const reviewRepository = {
    // Recent reviews, optionally filtered by source (google/facebook/…) and/or
    // practice. The feed is the individual reviews the providers returned (Places
    // caps at ~5/location); the dashboard volume totals come from review_sources.
    async list(orgId, { source = null, practiceId = null, limit = 100 } = {}) {
        let q = supabase_1.serviceClient
            .from('reviews')
            .select('id, source, external_id, author_name, rating, body, published_at, responded_at, response_body, flagged_for_recovery, practice_id, practice:practices(name)')
            .eq('organisation_id', orgId)
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(limit);
        if (source) q = q.eq('source', source);
        if (practiceId) q = q.eq('practice_id', practiceId);
        const { data } = await q;
        return (data ?? []).map((r) => ({
            ...r,
            practice_name: r.practice?.name ?? null,
            practice: undefined,
        }));
    },

    // Bulk upsert synced reviews. Dedup on (org, source, external_id) via the
    // partial unique index (migration 000070). Rows already carry organisation_id.
    async upsertMany(rows) {
        if (!rows || rows.length === 0) return 0;
        const { error } = await supabase_1.serviceClient
            .from('reviews')
            .upsert(rows, { onConflict: 'organisation_id,source,external_id', ignoreDuplicates: false });
        if (error) throw new Error(`reviews upsert: ${error.message}`);
        return rows.length;
    },

    async respond(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('reviews')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
