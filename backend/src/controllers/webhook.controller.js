import * as webhook_service_1 from "../services/webhook.service.js";
import { verifyWebhookToken } from "../lib/webhook-token.js";
export const webhookController = {
    // Emergent (Treatments Accepted). app.js mounts express.raw on
    // /webhooks/emergent, so req.body is a Buffer (needed for HMAC). The signed
    // URL token resolves the org; the secret verifies the payload.
    async emergent(req, res) {
        const sig = req.headers['x-webhook-signature'];
        const event = req.headers['x-webhook-event'];
        res.json(await webhook_service_1.webhookService.emergent(req.params.token, req.body, sig, event));
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
