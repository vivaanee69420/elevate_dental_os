"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Integrations routes — Express Router. Mounted at /api/integrations.
// All routes owner-only (requireRole('owner')). Static /connect before /:id.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const auth_1 = require("../middleware/auth");
const integration_controller_1 = require("../controllers/integration.controller");
const router = (0, express_1.Router)();
router.get('/', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.list));
router.post('/connect', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.connect));
router.delete('/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.remove));
exports.default = router;
