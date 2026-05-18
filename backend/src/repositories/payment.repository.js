"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentRepository = void 0;
// ============================================================================
// Payment repository — all Supabase data access for the payments domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.paymentRepository = {
    async list(orgId, q) {
        let query = supabase_1.serviceClient
            .from('payments')
            .select('*, contact:contacts(id, first_name, last_name), practice:practices(id, name)')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false })
            .limit(200);
        if (q.status)
            query = query.eq('status', q.status);
        if (q.since)
            query = query.gte('created_at', q.since);
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        return data;
    },
    async insertPending(row) {
        return supabase_1.serviceClient.from('payments').insert(row);
    },
};
