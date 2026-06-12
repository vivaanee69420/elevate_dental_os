// ============================================================================
// Webhook service — business logic for the webhooks domain (PUBLIC, no auth).
// ============================================================================
import crypto from "node:crypto";
import * as stripe_1 from "stripe";
import * as webhook_repository_1 from "../repositories/webhook.repository.js";
import * as errors_1 from "../middleware/errors.js";
import { verifyWebhookToken } from "../lib/webhook-token.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { applyWebhookEvent } from "../lib/integrations/dentally-sync.js";
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Resource keys, most specific first: 'invoice_item' contains 'invoice', and a
// treatment-plan event must not be eaten by 'payment'/etc.
const RESOURCE_KEYS = ['invoice_item', 'invoice', 'treatment_plan', 'appointment', 'payment', 'patient'];

function classifyResource(ev) {
    if (ev.includes('invoice_item') || ev.includes('invoice item')) return 'invoice_item';
    if (ev.includes('invoice')) return 'invoice';
    if (ev.includes('treatment_plan') || ev.includes('treatment plan')) return 'treatment_plan';
    if (ev.includes('appointment')) return 'appointment';
    if (ev.includes('payment')) return 'payment';
    if (ev.includes('patient')) return 'patient';
    return null;
}

// Map a Dentally webhook envelope -> { resourceType, action, records[] }.
// Dentally's exact shape is NOT contractually fixed (their docs omit payload
// examples), so parse tolerantly so we still CREATE records whatever the shape:
// the resource may sit under `data`/`payload`/`resource`/`record`, under its
// singular key (`{appointment:{...}}`), or the body may BE the resource. The
// event/action may be `event`/`topic`/`type`/`action`, or absent entirely (then
// infer the type from the body keys). `action` lets deletes remove rows instead
// of resurrecting them via upsert. invoice_item/treatment_plan feed REAL fee +
// production data the daily poll alone used to carry.
function parseDentallyEvent(body) {
    if (!body || typeof body !== 'object') return { resourceType: null, action: 'upsert', records: [] };
    const ev = String(body.event ?? body.topic ?? body.resource_type ?? body.type ?? body.action ?? '').toLowerCase();
    let resourceType = classifyResource(ev);
    // No usable event string -> infer the type from a nested resource key.
    if (!resourceType) {
        for (const k of RESOURCE_KEYS) {
            if (body[k] && typeof body[k] === 'object') { resourceType = k; break; }
        }
    }
    const action = /delet|destroy|remov/.test(ev) ? 'delete' : 'upsert';
    let data = body.data ?? body.payload ?? body.resource ?? body.record ?? null;
    if (data == null && resourceType && body[resourceType] != null) data = body[resourceType];
    // Bare resource: the body itself is the record (has an id, no envelope keys).
    if (data == null && body.id != null && body.data == null && body.event == null) data = body;
    const records = Array.isArray(data) ? data : data ? [data] : [];
    return { resourceType, action, records };
}

function timingSafeHexEqual(a, b) {
    const ab = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
export const webhookService = {
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
    // Dentally real-time webhook. orgToken (signed, in the URL) identifies the
    // tenant; the per-org secret in integrations.config.webhook_secret verifies
    // the HMAC signature over the raw body. body is the raw Buffer (express.raw
    // mounted on /webhooks/dentally). Each event upserts via the same row
    // builders the poller uses, so webhook + poll are consistent. The daily poll
    // remains the reconciliation backstop for any missed delivery.
    async dentally(orgToken, body, signature) {
        let orgId;
        try {
            orgId = verifyWebhookToken(orgToken);
        } catch {
            throw new errors_1.AppError('invalid webhook token', 401);
        }
        const integration = await integrationRepository.getByProvider(orgId, 'dentally');
        if (!integration || integration.status === 'revoked') {
            throw new errors_1.AppError('dentally not connected', 404);
        }
        const secret = integration.config?.webhook_secret;
        if (!secret) {
            throw new errors_1.AppError('webhook secret not configured', 401);
        }
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
        const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        // Accept a raw hex sig or an "sha256=" prefixed one.
        const got = String(signature ?? '').replace(/^sha256=/i, '');
        if (!timingSafeHexEqual(got, expected)) {
            throw new errors_1.AppError('invalid signature', 401);
        }
        let parsed;
        try {
            parsed = JSON.parse(raw.toString('utf8'));
        } catch {
            throw new errors_1.AppError('invalid JSON', 400);
        }
        const { resourceType, action, records } = parseDentallyEvent(parsed);
        if (!resourceType || records.length === 0) {
            return { received: true, ignored: true };
        }
        const results = [];
        for (const rec of records) {
            results.push(await applyWebhookEvent(orgId, resourceType, rec, action));
        }
        return { received: true, resourceType, action, count: results.length, results };
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
