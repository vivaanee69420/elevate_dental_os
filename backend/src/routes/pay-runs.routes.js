"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Pay-runs routes — Express Router. Mounted at /api/pay-runs (auth upstream).
// All routes are owner-only (enforced via requireRole).
// Static paths registered before the /:id param route.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const auth_1 = require("../middleware/auth");
const pay_run_controller_1 = require("../controllers/pay-run.controller");
const router = (0, express_1.Router)();
router.use((0, auth_1.requireRole)('owner'));
router.get('/', (0, async_handler_1.asyncHandler)(pay_run_controller_1.payRunController.list));
router.post('/calculate', (0, async_handler_1.asyncHandler)(pay_run_controller_1.payRunController.calculate));
router.post('/:id/approve', (0, async_handler_1.asyncHandler)(pay_run_controller_1.payRunController.approve));
exports.default = router;
