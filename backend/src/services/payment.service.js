// ============================================================================
// Payment service — business logic for the payments domain.
// ============================================================================
import * as stripe_1 from "stripe";
import * as payment_repository_1 from "../repositories/payment.repository.js";
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
export const paymentService = {
    async list(orgId, q) {
        const { rows, total } = await payment_repository_1.paymentRepository.list(orgId, q);
        const limit = q.limit ?? 25;
        const page = q.page ?? 1;
        return { payments: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
    },
    async summary(orgId, filters = {}) {
        return payment_repository_1.paymentRepository.summary(orgId, filters);
    },
    async createManual(orgId, input) {
        const row = {
            organisation_id: orgId,
            practice_id: input.practice_id,
            contact_id: input.contact_id ?? null,
            lead_id: input.lead_id ?? null,
            amount_pence: input.amount_pence,
            method: input.method ?? 'cash',
            status: input.status ?? 'settled',
            description: input.description ?? null,
            processed_at: input.processed_at ?? new Date().toISOString(),
            source: 'manual',
        };
        return payment_repository_1.paymentRepository.insertManual(row);
    },
    async sourceBreakdown(orgId, days = 30) {
        const since = new Date(Date.now() - days * 86400000).toISOString();
        return payment_repository_1.paymentRepository.sourceBreakdown(orgId, since);
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
