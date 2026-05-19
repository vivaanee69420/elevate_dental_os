// ============================================================================
// Webhooks routes — Express Router. Mounted at /webhooks and PUBLIC (no auth).
// Stripe raw body parser is applied to /webhooks/stripe in app.ts.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as webhook_controller_1 from "../controllers/webhook.controller.js";
const router = (0, express_1.Router)();
router.post('/stripe', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.stripe));
router.post('/postmark/inbound', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.postmarkInbound));
router.post('/twilio/inbound', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.twilioInbound));
export default router;
