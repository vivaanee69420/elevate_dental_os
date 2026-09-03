// ============================================================================
// Webhooks routes — Express Router. Mounted at /webhooks and PUBLIC (no auth).
// Stripe raw body parser is applied to /webhooks/stripe in app.ts.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as webhook_controller_1 from "../controllers/webhook.controller.js";
import * as ses_event_controller_1 from "../controllers/ses-event.controller.js";
const router = (0, express_1.Router)();
router.post('/stripe', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.stripe));
// Dentally real-time webhook. :token (signed) identifies the org; HMAC verified
// in the service. Raw body parser mounted on /webhooks/dentally in app.js.
router.post('/dentally/:token', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.dentally));
// GoHighLevel real-time webhook. :token routes to a subaccount (per-account
// webhook_token) or, for legacy URLs, the signed org token. JSON body (no raw mount).
router.post('/gohighlevel/:token', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.gohighlevel));
// Emergent (Treatments Accepted). Raw body (express.raw mounted on
// /webhooks/emergent in app.js) for HMAC-SHA256 signature verification. Token
// resolves the org; the service verifies X-Webhook-Signature and ingests.
router.post('/emergent/:token', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.emergent));
// CallRail real-time webhook. :token is the per-COMPANY random webhook_token
// (integration_accounts.webhook_token, minted by callrail.service.js) — the
// org resolves from THIS, never from anything in the payload. Raw body
// (express.raw mounted on /webhooks/callrail in app.js) for the optional
// HMAC-SHA1 Signature header. The handler is a TRIGGER, not the source of
// truth: it re-fetches the canonical call from CallRail's API rather than
// trusting the payload's own id shape — see callrail-webhook.js.
router.post('/callrail/:token', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.callrail));
router.post('/postmark/inbound', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.postmarkInbound));
router.post('/twilio/inbound', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.twilioInbound));
router.post('/ses-events', (0, async_handler_1.asyncHandler)(ses_event_controller_1.sesEventController.handle));
export default router;
