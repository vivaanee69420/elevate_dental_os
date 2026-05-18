"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipRepository = void 0;
// ============================================================================
// Membership repository — all Supabase data access for memberships domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.membershipRepository = {
    async listPlans(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('membership_plans')
            .select('*')
            .eq('organisation_id', orgId);
        return data;
    },
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('memberships')
            .select('*, contact:contacts(first_name, last_name, email), plan:membership_plans(name, monthly_price_pence)')
            .eq('organisation_id', orgId)
            .order('started_at', { ascending: false });
        return data;
    },
    async create(row) {
        return supabase_1.serviceClient.from('memberships').insert(row).select().single();
    },
};
