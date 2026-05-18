"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Billing routes — Express Router. Mounted at /api/billing (auth upstream).
// POST /portal is owner-only (enforced via requireRole).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const auth_1 = require("../middleware/auth");
const billing_controller_1 = require("../controllers/billing.controller");
const router = (0, express_1.Router)();
router.post('/portal', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(billing_controller_1.billingController.portal));
exports.default = router;
