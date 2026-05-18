"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingRepository = void 0;
// ============================================================================
// Billing repository — all Supabase data access for the billing domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.billingRepository = {
    async getOrg(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('organisations')
            .select('stripe_customer_id')
            .eq('id', orgId)
            .single();
        return data;
    },
    async setStripeCustomerId(orgId, customerId) {
        return supabase_1.serviceClient
            .from('organisations')
            .update({ stripe_customer_id: customerId })
            .eq('id', orgId);
    },
};
