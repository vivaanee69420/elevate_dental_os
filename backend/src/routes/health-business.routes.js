"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Business Health routes — Express Router. Mounted at /api/health (auth
// applied upstream). Static paths registered before any param routes.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const business_health_controller_1 = require("../controllers/business-health.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.get));
router.put('/', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.update));
router.get('/insights', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.insights));
router.get('/snapshots', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.listSnapshots));
router.post('/snapshots', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.createSnapshot));
router.get('/progress', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.progress));
exports.default = router;
