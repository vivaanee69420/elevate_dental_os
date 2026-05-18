"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingService = void 0;
// ============================================================================
// Billing service — business logic for the billing domain.
// ============================================================================
const stripe_1 = __importDefault(require("stripe"));
const billing_repository_1 = require("../repositories/billing.repository");
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
exports.billingService = {
    async portal(orgId, email) {
        const org = await billing_repository_1.billingRepository.getOrg(orgId);
        let customerId = org?.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email,
                metadata: { organisation_id: orgId },
            });
            customerId = customer.id;
            await billing_repository_1.billingRepository.setStripeCustomerId(orgId, customerId);
        }
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: process.env.APP_URL + '/settings/billing',
        });
        return { url: session.url };
    },
};
