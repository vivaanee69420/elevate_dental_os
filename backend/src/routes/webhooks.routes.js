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
// Emergent (Treatments Accepted). JSON body (no raw mount yet — HMAC verify is
// added with the Emergent contract). Token resolves the org; ingest is pending.
router.post('/emergent/:token', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.emergent));
router.post('/postmark/inbound', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.postmarkInbound));
router.post('/twilio/inbound', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.twilioInbound));
router.post('/ses-events', (0, async_handler_1.asyncHandler)(ses_event_controller_1.sesEventController.handle));
export default router;
