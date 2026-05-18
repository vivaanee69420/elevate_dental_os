"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentService = void 0;
// ============================================================================
// Payment service — business logic for the payments domain.
// ============================================================================
const stripe_1 = __importDefault(require("stripe"));
const payment_repository_1 = require("../repositories/payment.repository");
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
exports.paymentService = {
    async list(orgId, q) {
        const data = await payment_repository_1.paymentRepository.list(orgId, q);
        return { payments: data };
    },
    async createPaymentLink(orgId, input) {
        // NOTE: inline price_data.
        // Stripe's typings only accept a pre-created `price` on payment links, so we
        // cast to keep the exact runtime payload the original sent.
        const paymentLink = await stripe.paymentLinks.create({
            line_items: [{
                    price_data: {
                        currency: 'gbp',
                        product_data: { name: input.description },
                        unit_amount: input.amount_pence,
                    },
                    quantity: 1,
                }],
            metadata: {
                organisation_id: orgId,
                contact_id: input.contact_id || '',
                lead_id: input.lead_id || '',
            },
        });
        // Record pending payment
        await payment_repository_1.paymentRepository.insertPending({
            organisation_id: orgId,
            contact_id: input.contact_id,
            lead_id: input.lead_id,
            amount_pence: input.amount_pence,
            method: 'pay_link',
            status: 'pending',
            description: input.description,
        });
        return { url: paymentLink.url };
    },
};
