import * as webhook_service_1 from "../services/webhook.service.js";
import { verifyWebhookToken } from "../lib/webhook-token.js";
export const webhookController = {
    // Emergent (Treatments Accepted). The per-org token resolves the org so the
    // URL is live for the owner to paste into Emergent now. INGEST IS PENDING the
    // Emergent API contract (field names + HMAC signing secret) — we ack 202 and
    // do NOT yet persist (see treatmentaccepted.md). Once the contract lands: add
    // express.raw on this path, HMAC-verify, mapRecord -> upsert treatment_accepted.
    async emergent(req, res) {
        let orgId;
        try {
            orgId = verifyWebhookToken(req.params.token);
        } catch {
            return res.status(401).json({ error: 'invalid_token' });
        }
        console.warn(`[emergent] webhook received for org ${orgId} — ingest pending API contract, not persisted`);
        return res.status(202).json({ received: true, processed: false, reason: 'emergent_ingest_pending_contract' });
    },
    async stripe(req, res) {
        const sig = req.headers['stripe-signature'];
        // app.ts applies express.raw to /webhooks/stripe, so req.body is a Buffer.
        res.json(await webhook_service_1.webhookService.stripe(req.body, sig));
    },
    async dentally(req, res) {
        // app.js mounts express.raw on /webhooks/dentally, so req.body is a Buffer.
        const sig = req.headers['x-dentally-signature'] || req.headers['x-signature'];
        // Which header (if any) carried the signature — and, when none matched our
        // two known names, the signature-ish headers that DID arrive, so a header-
        // name drift on Dentally's side is self-diagnosing instead of a blind 401.
        const sigHeaderName = req.headers['x-dentally-signature']
            ? 'x-dentally-signature'
            : (req.headers['x-signature'] ? 'x-signature' : null);
        const otherSigHeaders = sigHeaderName
            ? undefined
            : Object.keys(req.headers).filter((h) => /sig|sign|hmac|dentally/i.test(h));
        res.json(await webhook_service_1.webhookService.dentally(req.params.token, req.body, sig, { sigHeaderName, otherSigHeaders }));
    },
    async gohighlevel(req, res) {
        // No raw mount on /webhooks/gohighlevel, so req.body is parsed JSON.
        // Optional shared secret may arrive as a header or a ?secret= query.
        const secret = req.headers['x-webhook-secret'] || req.headers['x-wh-secret'] || req.query.secret;
        res.json(await webhook_service_1.webhookService.gohighlevel(req.params.token, req.body, secret));
    },
    async postmarkInbound(_req, res) {
        res.json(await webhook_service_1.webhookService.postmarkInbound());
    },
    async twilioInbound(_req, res) {
        res.json(await webhook_service_1.webhookService.twilioInbound());
    },
};
