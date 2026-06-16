// ============================================================================
// Webhook service — business logic for the webhooks domain (PUBLIC, no auth).
// ============================================================================
import crypto from "node:crypto";
import * as stripe_1 from "stripe";
import * as webhook_repository_1 from "../repositories/webhook.repository.js";
import * as errors_1 from "../middleware/errors.js";
import { verifyWebhookToken } from "../lib/webhook-token.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { applyWebhookEvent } from "../lib/integrations/dentally-sync.js";
import { applyWebhookEvent as applyGhlWebhookEvent, mapWebhookEventType as mapGhlEventType } from "../lib/integrations/gohighlevel-sync.js";
import { treatmentAcceptedRepository } from "../repositories/treatment-accepted.repository.js";
import { emergentPracticeMapRepository } from "../repositories/emergent-practice-map.repository.js";
import { mapRecord as mapEmergentRecord, externalId as emergentExternalId, loadResolution as loadEmergentResolution } from "../lib/integrations/emergent-sync.js";
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

// Map a GoHighLevel webhook envelope -> { events: [{ eventType, record }] }. GHL
// ships two flavours: marketplace events ({ type:'ContactCreate', locationId,
// ...fields }) and workflow-action webhooks (user-shaped JSON). Parse tolerantly:
// the event label may be `type`/`event`/`eventType`; resource fields usually sit
// at root but may nest under `contact`/`opportunity`. When no label is present,
// infer from the keys (pipeline fields -> opportunity, else contact).
function parseGhlEvent(body) {
    if (!body || typeof body !== 'object') return { events: [] };
    const arr = Array.isArray(body) ? body : [body];
    const out = [];
    for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const rawType = item.type ?? item.event ?? item.eventType ?? item.webhookType ?? '';
        let eventType = mapGhlEventType(rawType);
        const record = item.opportunity ?? item.contact ?? item;
        if (!eventType) {
            if (item.pipelineId != null || item.pipelineStageId != null || item.opportunity != null) {
                eventType = 'opportunity';
            } else if (record && (record.email != null || record.firstName != null || record.phone != null || item.contact != null)) {
                eventType = 'contact';
            }
        }
        if (eventType && record) out.push({ eventType, record });
    }
    return { events: out };
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
    async dentally(orgToken, body, signature, diag = {}) {
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
            // Sanitized self-diagnostic so a real failed delivery tells us WHY
            // (header drift vs secret/body mismatch) instead of an opaque 401.
            // No full secret/body/signature logged — 8-char hex prefixes only.
            console.warn('[dentally-webhook] signature rejected', {
                orgId,
                sigHeader: diag.sigHeaderName ?? 'none',
                otherSigHeaders: diag.otherSigHeaders?.length ? diag.otherSigHeaders : undefined,
                sigPresent: !!signature,
                gotPrefix: got ? got.slice(0, 8) : null,
                expectedPrefix: expected.slice(0, 8),
                lenMatch: got.length === expected.length,
                rawLen: raw.length,
            });
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
            // Per-record fault isolation: an unstorable record or a transient DB
            // error must NOT 5xx the whole delivery — Dentally auto-disables a
            // webhook after sustained failures, so one bad row would silently
            // kill ALL future real-time updates. Log + skip; the nightly poll is
            // the reconciliation backstop for anything missed here. Auth, token
            // and signature failures (above) stay hard rejections by design.
            try {
                results.push(await applyWebhookEvent(orgId, resourceType, rec, action));
            } catch (err) {
                console.warn('[dentally-webhook] record skipped', {
                    orgId,
                    resourceType,
                    action,
                    recordId: rec?.id ?? null,
                    err: err?.message || String(err),
                });
                results.push({ error: true, recordId: rec?.id ?? null, reason: err?.message || 'apply_failed' });
            }
        }
        return { received: true, resourceType, action, count: results.length, results };
    },

    // Emergent (Treatments Accepted) real-time webhook. Mirrors `dentally`:
    // org from the signed URL token, HMAC-SHA256 of the raw body vs the per-org
    // config.webhook_secret, then route by event. Tenant isolation: the resolved
    // orgId scopes every downstream write; the body never chooses a tenant.
    async emergent(token, body, signature, eventHeader) {
        let orgId;
        try {
            orgId = verifyWebhookToken(token);
        } catch {
            throw new errors_1.AppError('invalid webhook token', 401);
        }
        const integration = await integrationRepository.getByProvider(orgId, 'emergent');
        if (!integration || integration.status === 'revoked') {
            throw new errors_1.AppError('emergent not connected', 404);
        }
        const secret = integration.config?.webhook_secret;
        if (!secret) {
            throw new errors_1.AppError('webhook secret not configured', 401);
        }
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
        const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        const got = String(signature ?? '').replace(/^sha256=/i, '');
        if (!timingSafeHexEqual(got, expected)) {
            console.warn('[emergent-webhook] signature rejected', {
                orgId,
                sigPresent: !!signature,
                gotPrefix: got ? got.slice(0, 8) : null,
                expectedPrefix: expected.slice(0, 8),
                lenMatch: got.length === expected.length,
                rawLen: raw.length,
            });
            throw new errors_1.AppError('invalid signature', 401);
        }
        let parsed;
        try {
            parsed = JSON.parse(raw.toString('utf8'));
        } catch {
            throw new errors_1.AppError('invalid JSON', 400);
        }
        const data = parsed?.data;
        // The event suffix may arrive in the body or the X-Webhook-Event header.
        const event = String(parsed?.event || eventHeader || '');
        const action = event.replace(/^treatment\./, '');
        if (!data || typeof data !== 'object' || data.business_id == null) {
            return { received: true, ignored: true, reason: 'no_data' };
        }

        // Fault isolation: a transient DB error (discover/upsert/delete) must NOT
        // 5xx the delivery — the provider auto-disables a webhook after sustained
        // failures, and the nightly sync is the reconciliation backstop. Log +
        // ack. Auth/token/signature failures (above) stay hard rejections.
        try {
            // Discover the business so it appears in the mapping UI immediately.
            await emergentPracticeMapRepository.discover(orgId, [
                { business_id: data.business_id, business_name: data.business_name },
            ]);

            if (action === 'deleted') {
                const deleted = await treatmentAcceptedRepository.deleteByExternalId(
                    orgId, 'emergent', emergentExternalId(data),
                );
                await integrationRepository.setSyncTime(orgId, 'emergent');
                return { received: true, action, deleted };
            }
            if (action === 'accepted' || action === 'updated') {
                // Same resolution as the nightly sync (explicit map first, fuzzy
                // business-name match as fallback) so a webhook for a not-yet-mapped
                // business still gets best-effort practice attribution.
                const maps = await loadEmergentResolution(orgId);
                await treatmentAcceptedRepository.upsert(mapEmergentRecord(data, orgId, maps));
                await integrationRepository.setSyncTime(orgId, 'emergent');
                return { received: true, action, processed: true };
            }
            return { received: true, ignored: true, event };
        } catch (err) {
            console.warn('[emergent-webhook] processing skipped', {
                orgId,
                action,
                businessId: data.business_id ?? null,
                err: err?.message || String(err),
            });
            return { received: true, error: true, reason: err?.message || 'apply_failed' };
        }
    },
    // GoHighLevel real-time webhook. orgToken (signed, in the URL) identifies the
    // tenant. GHL workflow webhooks don't HMAC the body, so the unguessable token
    // is the primary auth; an owner may additionally set a shared secret
    // (integrations.config.webhook_secret) that must arrive as the x-webhook-secret
    // header or ?secret= query. Each event upserts via the SAME row builders the
    // poller uses (applyWebhookEvent), so webhook + nightly poll stay consistent;
    // the poll remains the reconciliation backstop for any missed delivery.
    async gohighlevel(routeToken, body, providedSecret) {
        // Preferred: the route token is a per-account random webhook_token →
        // resolves org + practice in one lookup (multi-subaccount path).
        let account = await integrationAccountRepository.getByWebhookToken(routeToken);
        let orgId;
        if (account) {
            if (account.status === 'revoked') throw new errors_1.AppError('gohighlevel not connected', 404);
            orgId = account.organisation_id;
        } else {
            // Back-compat: a legacy signed-org token (pre-multi-account URLs).
            try {
                orgId = verifyWebhookToken(routeToken);
            } catch {
                throw new errors_1.AppError('invalid webhook token', 401);
            }
            // Resolve the account by the payload's locationId, else the org's sole account.
            const evtLoc = body && !Array.isArray(body) ? (body.locationId ?? body.location_id) : null;
            if (evtLoc) account = await integrationAccountRepository.getByLocation(orgId, 'gohighlevel', evtLoc);
            if (!account) {
                const accounts = await integrationAccountRepository.list(orgId, 'gohighlevel');
                const active = accounts.filter((a) => a.status === 'active');
                account = active.length === 1 ? active[0] : null;
            }
            if (!account || account.status === 'revoked') {
                throw new errors_1.AppError('gohighlevel not connected', 404);
            }
        }

        // Optional shared-secret hardening (per-account config.webhook_secret).
        const secret = account.config?.webhook_secret;
        if (secret) {
            if (!providedSecret || !timingSafeHexEqual(String(providedSecret), secret)) {
                throw new errors_1.AppError('invalid signature', 401);
            }
        }
        // Defensive tenant check: a payload locationId must match this account's.
        const evtLoc = body && !Array.isArray(body) ? (body.locationId ?? body.location_id) : null;
        if (account.external_account_id && evtLoc && String(evtLoc) !== String(account.external_account_id)) {
            return { received: true, ignored: 'location_mismatch' };
        }

        const { events } = parseGhlEvent(body);
        if (!events || events.length === 0) return { received: true, ignored: true };
        const results = [];
        for (const { eventType, record } of events) {
            results.push(await applyGhlWebhookEvent(orgId, eventType, record, account?.id || null));
        }
        return { received: true, count: results.length, results };
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
