"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Analytics routes — Express Router. Mounted at /api/analytics (auth upstream).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const analytics_controller_1 = require("../controllers/analytics.controller");
const router = (0, express_1.Router)();
router.get('/dashboard', (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.dashboard));
router.get('/pl', (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.pl));
router.get('/valuation', (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.valuation));
router.get('/kpis', (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.kpis));
exports.default = router;
