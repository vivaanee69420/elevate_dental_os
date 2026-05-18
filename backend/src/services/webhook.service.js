"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookService = void 0;
// ============================================================================
// Webhook service — business logic for the webhooks domain (PUBLIC, no auth).
// ============================================================================
const stripe_1 = __importDefault(require("stripe"));
const webhook_repository_1 = require("../repositories/webhook.repository");
const errors_1 = require("../middleware/errors");
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
exports.webhookService = {
    // body is the raw Buffer (express.raw applied to /webhooks/stripe in app.ts).
    async stripe(body, sig) {
        let event;
        try {
            event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        }
        catch (err) {
            throw new errors_1.AppError(`Webhook signature failed: ${err.message}`, 400);
        }
        switch (event.type) {
            case 'payment_intent.succeeded': {
                const pi = event.data.object;
                await webhook_repository_1.webhookRepository.settlePayment(pi.id);
                break;
            }
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                const plan = sub.status === 'active' ? 'group' : 'cancelled';
                await webhook_repository_1.webhookRepository.updateSubscription(sub.customer, plan, sub.id);
                break;
            }
        }
        return { received: true };
    },
    async postmarkInbound() {
        // Process inbound email → create communication record
        return { received: true };
    },
    async twilioInbound() {
        // Process inbound SMS → create communication record
        return { received: true };
    },
};
