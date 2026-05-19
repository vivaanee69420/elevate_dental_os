// ============================================================================
// Webhook repository — all Supabase data access for the webhooks domain.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const webhookRepository = {
    async settlePayment(paymentIntentId) {
        return supabase_1.serviceClient
            .from('payments')
            .update({
            status: 'settled',
            stripe_payment_intent_id: paymentIntentId,
            processed_at: new Date().toISOString(),
        })
            .eq('stripe_payment_intent_id', paymentIntentId);
    },
    async updateSubscription(customerId, plan, subscriptionId) {
        return supabase_1.serviceClient
            .from('organisations')
            .update({
            subscription_plan: plan,
            stripe_subscription_id: subscriptionId,
        })
            .eq('stripe_customer_id', customerId);
    },
};
