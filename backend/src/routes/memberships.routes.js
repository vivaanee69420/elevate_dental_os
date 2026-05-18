"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Memberships routes — Express Router. Mounted at /api/memberships.
// Static /plans registered before / so it isn't shadowed.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const membership_controller_1 = require("../controllers/membership.controller");
const router = (0, express_1.Router)();
router.get('/plans', (0, async_handler_1.asyncHandler)(membership_controller_1.membershipController.listPlans));
router.get('/', (0, async_handler_1.asyncHandler)(membership_controller_1.membershipController.list));
router.post('/', (0, async_handler_1.asyncHandler)(membership_controller_1.membershipController.create));
exports.default = router;
