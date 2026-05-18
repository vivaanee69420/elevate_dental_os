"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Webhooks routes — Express Router. Mounted at /webhooks and PUBLIC (no auth).
// Stripe raw body parser is applied to /webhooks/stripe in app.ts.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const webhook_controller_1 = require("../controllers/webhook.controller");
const router = (0, express_1.Router)();
router.post('/stripe', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.stripe));
router.post('/postmark/inbound', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.postmarkInbound));
router.post('/twilio/inbound', (0, async_handler_1.asyncHandler)(webhook_controller_1.webhookController.twilioInbound));
exports.default = router;
