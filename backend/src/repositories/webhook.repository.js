"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookRepository = void 0;
// ============================================================================
// Webhook repository — all Supabase data access for the webhooks domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.webhookRepository = {
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
