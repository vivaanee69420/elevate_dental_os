"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commRepository = void 0;
// ============================================================================
// Comm repository — all Supabase data access for the communications domain.
// No business logic here: queries in, rows out (or thrown DB error).
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.commRepository = {
    async list(orgId, q) {
        let query = supabase_1.serviceClient
            .from('communications')
            .select('*')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false })
            .limit(200);
        if (q.contact_id)
            query = query.eq('contact_id', q.contact_id);
        if (q.lead_id)
            query = query.eq('lead_id', q.lead_id);
        if (q.channel)
            query = query.eq('channel', q.channel);
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        return data;
    },
    async create(row) {
        return supabase_1.serviceClient.from('communications').insert(row).select().single();
    },
};
