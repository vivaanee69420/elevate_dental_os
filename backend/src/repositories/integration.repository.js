"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.integrationRepository = void 0;
// ============================================================================
// Integration repository — all Supabase data access for integrations domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.integrationRepository = {
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('integrations')
            .select('id, provider, status, last_synced_at, last_error, config')
            .eq('organisation_id', orgId);
        return data;
    },
    async remove(orgId, id) {
        await supabase_1.serviceClient
            .from('integrations')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId);
    },
};
