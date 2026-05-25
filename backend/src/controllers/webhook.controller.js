import * as webhook_service_1 from "../services/webhook.service.js";
export const webhookController = {
    async stripe(req, res) {
        const sig = req.headers['stripe-signature'];
        // app.ts applies express.raw to /webhooks/stripe, so req.body is a Buffer.
        res.json(await webhook_service_1.webhookService.stripe(req.body, sig));
    },
    async dentally(req, res) {
        // app.js mounts express.raw on /webhooks/dentally, so req.body is a Buffer.
        const sig = req.headers['x-dentally-signature'] || req.headers['x-signature'];
        res.json(await webhook_service_1.webhookService.dentally(req.params.token, req.body, sig));
    },
    async postmarkInbound(_req, res) {
        res.json(await webhook_service_1.webhookService.postmarkInbound());
    },
    async twilioInbound(_req, res) {
        res.json(await webhook_service_1.webhookService.twilioInbound());
    },
};
