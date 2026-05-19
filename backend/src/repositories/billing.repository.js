// ============================================================================
// Billing repository — all Supabase data access for the billing domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const billingRepository = {
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
