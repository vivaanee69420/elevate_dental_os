"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Health routes — Express Router. Mounted PUBLIC at /healthcheck (no auth).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const health_controller_1 = require("../controllers/health.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(health_controller_1.healthController.check));
exports.default = router;
