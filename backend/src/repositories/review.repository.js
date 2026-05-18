"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewRepository = void 0;
// ============================================================================
// Review repository — all Supabase data access for the reviews domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.reviewRepository = {
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('reviews')
            .select('*')
            .eq('organisation_id', orgId)
            .order('published_at', { ascending: false })
            .limit(100);
        return data;
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
