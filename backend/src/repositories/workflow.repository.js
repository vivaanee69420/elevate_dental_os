"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowRepository = void 0;
// ============================================================================
// Workflow repository — all Supabase data access for the workflows domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.workflowRepository = {
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('workflows')
            .select('*')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false });
        return data;
    },
    async create(row) {
        return supabase_1.serviceClient.from('workflows').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('workflows')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
    async remove(orgId, id) {
        return supabase_1.serviceClient
            .from('workflows')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId);
    },
};
