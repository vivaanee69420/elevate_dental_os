"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Payments routes — Express Router. Mounted at /api/payments (auth upstream).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const payment_controller_1 = require("../controllers/payment.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(payment_controller_1.paymentController.list));
router.post('/create-payment-link', (0, async_handler_1.asyncHandler)(payment_controller_1.paymentController.createPaymentLink));
exports.default = router;
